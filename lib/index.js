import { readFile, readdir, stat, writeFile, mkdir } from "node:fs/promises";
import { existsSync, statSync, readFileSync } from "node:fs";
import { basename, extname, join, resolve, isAbsolute, relative, sep, dirname, posix as posixPath } from "node:path";
import { homedir } from "node:os";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import figlet from "figlet";
import {
  loadCache,
  saveCache,
  hashFile,
  fileStats,
  estimateTokens,
  truncateByTokens
} from "./cache.js";

let analyzeProject;
let formatHealthReport;
let getChangedFiles;
let analyzeImpact;
let formatImpactReport;
try {
  ({ analyzeProject, formatHealthReport, getChangedFiles, analyzeImpact, formatImpactReport } = await import("../dist/index.js"));
} catch { analyzeProject = undefined; formatHealthReport = undefined; getChangedFiles = undefined; analyzeImpact = undefined; formatImpactReport = undefined; }

let defineTool;
let createUserMessage;
try {
  ({ defineTool } = await import("@deepseek-ai/dsh-tools"));
} catch { defineTool = undefined; }
try {
  ({ createUserMessage } = await import("@deepseek-ai/dsh-llm"));
} catch { createUserMessage = undefined; }

const name = "codebase-chat";
const inject = ["tools", "commands", "agents", "systemPrompt"];

const VERSION = "0.23.0";
const execAsync = promisify(exec);

const PROTECTED_PATHS = process.env.DSH_PROTECTED_PATHS
  ? process.env.DSH_PROTECTED_PATHS.split(/[;|]/).map((p) => p.trim()).filter(Boolean)
  : [];

// Per-project config: .codebase-chat.json at the project root.
const projectConfigCache = new Map();
function getProjectConfig(projectRoot) {
  if (projectConfigCache.has(projectRoot)) return projectConfigCache.get(projectRoot);
  let cfg = {};
  try {
    cfg = JSON.parse(readFileSync(join(projectRoot, ".codebase-chat.json"), "utf8"));
  } catch { /* no config file — defaults */ }
  if (!cfg || typeof cfg !== "object") cfg = {};
  projectConfigCache.set(projectRoot, cfg);
  return cfg;
}

function configProtectedPaths(projectRoot) {
  const list = getProjectConfig(projectRoot).protectedPaths;
  if (!Array.isArray(list)) return [];
  return list
    .filter((p) => typeof p === "string" && p.trim())
    .map((p) => resolve(projectRoot, p.trim()).toLowerCase());
}

// Minimal glob → RegExp: `**` spans directories, `*` one segment, `?` one char.
function globToRegExp(glob) {
  const src = glob.replace(/\\/g, "/").split("**")
    .map((s) => s.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]"))
    .join(".*");
  return new RegExp(`^${src}$`);
}

function strList(v) {
  return Array.isArray(v) ? v.filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim()) : [];
}

const walkRulesCache = new Map();
function getWalkRules(projectRoot) {
  if (walkRulesCache.has(projectRoot)) return walkRulesCache.get(projectRoot);
  const cfg = getProjectConfig(projectRoot);
  const rules = {
    dirs: new Set(strList(cfg.ignoreDirs)),
    files: new Set(strList(cfg.ignoreFiles)),
    // basenameOnly: a glob without "/" matches the file name at any depth
    globs: strList(cfg.ignoreGlobs).map((g) => ({ re: globToRegExp(g), base: !g.includes("/") }))
  };
  walkRulesCache.set(projectRoot, rules);
  return rules;
}

function matchIgnoreGlob(rules, rel) {
  const base = rel.split("/").pop() ?? rel;
  return rules.globs.some((g) => g.re.test(rel) || (g.base && g.re.test(base)));
}

const SOURCE_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".vue", ".svelte", ".py", ".rs", ".go", ".java", ".kt",
  ".swift", ".cs", ".cpp", ".c", ".h", ".hpp",
  ".css", ".scss", ".less", ".html", ".json", ".yaml", ".yml", ".md"
]);

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", ".output",
  "coverage", "tmp", "temp", ".cache", ".turbo", ".next",
  "target", "bin", "obj", "vendor", ".venv", "venv", "__pycache__",
  ".npm-cache", ".parcel-cache", ".gradle", ".mypy_cache", ".pytest_cache",
  "android", "ios", "e2e-shots", "playstore_screenshots",
  ".cursor", ".idea", ".memsearch", ".vscode",
  ".agents", ".claude", ".devin", ".playwright-mcp", ".windsurf",
  ".dsh-backups"
]);

function isSkippedDir(name) {
  return SKIP_DIRS.has(name) || name.startsWith(".dsh-backup-");
}

const MAX_FILE_BYTES = 16_000;
const MAX_TOTAL_BYTES = 200_000;
const MAX_CONTEXT_TOKENS = 60_000;
const MAX_TREE_LINES = 500;
const MAX_SEARCH_FILES = 80;

const progressStore = new Map();
let currentProgressSession = null;
let currentProgressRoot = null;
let lastFileReadAt = 0;

function setProgressSession(sessionId) {
  currentProgressSession = sessionId;
  currentProgressRoot = null;
  lastFileReadAt = 0;
  if (sessionId) progressStore.set(sessionId, []);
}

function clearProgressSession() {
  currentProgressSession = null;
  currentProgressRoot = null;
}

function setProgressRoot(root) {
  currentProgressRoot = root;
}

function reportProgress(message) {
  if (!currentProgressSession) return;
  const list = progressStore.get(currentProgressSession) || [];
  list.push({ t: Date.now(), message });
  if (list.length > 40) list.shift();
  progressStore.set(currentProgressSession, list);
  // Keep the store bounded: drop the oldest session entries.
  while (progressStore.size > 50) {
    const oldest = progressStore.keys().next().value;
    progressStore.delete(oldest);
  }
}

function reportFileRead(filePath) {
  if (!currentProgressSession || !currentProgressRoot) return;
  const now = Date.now();
  if (now - lastFileReadAt < 120) return;
  lastFileReadAt = now;
  const rel = relative(currentProgressRoot, filePath).split(sep).join("/");
  reportProgress(`Lecture : ${rel}`);
}

function isProtectedPath(input) {
  const normalized = input.toLowerCase().replace(/\//g, "\\");
  if (PROTECTED_PATHS.some((p) => normalized === p.toLowerCase() || normalized.startsWith(p.toLowerCase() + "\\"))) return true;
  // Project config can also protect the project root or one of its parents.
  return configProtectedPaths(input).some((p) => {
    const n = p.replace(/\//g, "\\");
    return normalized === n || normalized.startsWith(n + "\\");
  });
}

async function safeReadText(filePath) {
  try {
    const text = Buffer.from(await readFile(filePath)).toString("utf8");
    reportFileRead(filePath);
    return text;
  } catch {
    return void 0;
  }
}

async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

const FILE_LIST_TTL = 15_000;
const fileListCache = new Map();

/** List every file under startDir (all extensions), cached briefly so the
 * many collectors in one call share a single filesystem walk. */
async function listProjectFiles(startDir) {
  const cached = fileListCache.get(startDir);
  if (cached && Date.now() - cached.t < FILE_LIST_TTL) return cached.files;
  const rules = getWalkRules(startDir);
  const files = [];
  const queue = [startDir];
  while (queue.length > 0) {
    const dir = queue.shift();
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const rel = relative(startDir, fullPath).split(sep).join("/");
      if (entry.isDirectory()) {
        if (!isSkippedDir(entry.name) && !rules.dirs.has(entry.name) && !rules.dirs.has(rel) && !matchIgnoreGlob(rules, rel)) queue.push(fullPath);
        continue;
      }
      if (entry.isFile() && !rules.files.has(entry.name) && !matchIgnoreGlob(rules, rel)) files.push(fullPath);
    }
  }
  while (fileListCache.size > 20) {
    const oldest = fileListCache.keys().next().value;
    fileListCache.delete(oldest);
  }
  fileListCache.set(startDir, { t: Date.now(), files });
  return files;
}

function resolveAlias(projectPath) {
  const raw = (projectPath ?? "").trim().replace(/['"]/g, "");
  const lower = raw.toLowerCase();
  const aliases = { dako: process.env.DSH_DAKO_PROJECT || "D:\\Nouveau dossier" };
  // Extra aliases via env: DSH_PROJECT_ALIASES="name=C:\\Path;other=D:\\Path"
  const extra = process.env.DSH_PROJECT_ALIASES;
  if (extra) {
    for (const pair of extra.split(/[;|]/)) {
      const idx = pair.indexOf("=");
      if (idx > 0) aliases[pair.slice(0, idx).trim().toLowerCase()] = pair.slice(idx + 1).trim();
    }
  }
  return aliases[lower] ?? raw;
}

async function detectProjectRoot(startDir = process.cwd()) {
  const markers = ["package.json", ".git", "tsconfig.json"];
  const home = homedir();
  let current = resolve(startDir);
  const maxSteps = 20;
  for (let i = 0; i < maxSteps; i++) {
    if (isProtectedPath(current)) break;
    for (const m of markers) {
      try {
        const s = await stat(join(current, m));
        if (s.isFile() || s.isDirectory()) return current;
      } catch { /* ignore */ }
    }
    const parent = dirname(current);
    if (parent === current || current.toLowerCase() === home.toLowerCase()) break;
    current = parent;
  }
  return null;
}

async function resolveProjectPath(projectPath) {
  if (!projectPath || typeof projectPath !== "string" || projectPath.trim() === "." || projectPath.trim().toLowerCase() === "current") {
    reportProgress("Détection du projet dans le dossier courant...");
    const detected = await detectProjectRoot();
    if (detected) {
      reportProgress(`Projet détecté : ${detected}`);
      setProgressRoot(detected);
      reportProgress(`Projet prêt : ${detected}`);
      return detected;
    }
    throw new Error("Aucun projet detecte depuis le dossier courant. Fournis --project <chemin>.");
  }
  reportProgress(`Résolution du chemin : ${projectPath}`);
  const aliased = resolveAlias(projectPath);
  const absProject = isAbsolute(aliased) ? resolve(aliased) : resolve(process.cwd(), aliased);
  if (isProtectedPath(absProject)) throw new Error("Ce chemin est protege et ne peut pas etre lu.");
  if (!await isDirectory(absProject)) throw new Error(`Le chemin n'est pas un dossier : ${projectPath}`);
  setProgressRoot(absProject);
  reportProgress(`Projet prêt : ${absProject}`);
  return absProject;
}

async function findProjectRoot(absProject) {
  const srcDir = join(absProject, "src");
  return (await isDirectory(srcDir)) ? srcDir : absProject;
}

async function getProjectName(absProject) {
  let rawName = "";
  try {
    const text = await safeReadText(join(absProject, "package.json"));
    if (text) {
      const parsed = JSON.parse(text);
      rawName = parsed.name || "";
    }
  } catch {
    // ignore
  }
  const folder = basename(absProject).toLowerCase();
  if (folder.includes("nouveau dossier") || rawName.toLowerCase() === "dako-app" || rawName.toLowerCase().startsWith("dako")) return "Dako";
  return rawName || basename(absProject);
}

async function getPackageSummary(absProject) {
  const summary = { name: "", type: "", scripts: {}, dependencies: [], devDependencies: [], main: "" };
  try {
    const text = await safeReadText(join(absProject, "package.json"));
    if (!text) return summary;
    const parsed = JSON.parse(text);
    summary.name = parsed.name || "";
    summary.type = parsed.type || "commonjs";
    summary.scripts = parsed.scripts || {};
    summary.dependencies = Object.keys(parsed.dependencies || {});
    summary.devDependencies = Object.keys(parsed.devDependencies || {});
    summary.main = parsed.main || "";
  } catch {
    // ignore
  }
  return summary;
}

function parseImports(text, relPath) {
  const imports = [];
  const seen = new Set();
  const patterns = [
    /import\s+(?:(?:[\s\S]*?)\s+from\s+)?['"]([^'"]+)['"];?/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /export\s+(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"];?/g,
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  ];
  for (const pattern of patterns) {
    let m;
    while ((m = pattern.exec(text)) !== null) {
      const raw = m[1].trim();
      if (raw.startsWith(".")) {
        const resolved = posixPath.normalize(posixPath.join(posixPath.dirname(relPath), raw));
        if (!seen.has(resolved)) {
          seen.add(resolved);
          imports.push({ source: resolved, kind: "local" });
        }
      } else if (!raw.startsWith("node:") && !seen.has(raw)) {
        seen.add(raw);
        imports.push({ source: raw, kind: "package" });
      }
    }
  }
  return imports;
}

function parseExports(text) {
  const exports = [];
  const namedPattern = /export\s+(?:const|let|var|function|class|interface|type|enum)\s+([A-Za-z0-9_]+)/g;
  const fromPattern = /export\s+(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"];?/g;
  const defaultPattern = /export\s+default\s+(?:function\s+)?([A-Za-z0-9_]+)?/;
  let m;
  while ((m = namedPattern.exec(text)) !== null) exports.push(m[1]);
  while ((m = fromPattern.exec(text)) !== null) exports.push(`from:${m[1]}`);
  const d = text.match(defaultPattern);
  if (d) exports.push(d[1] ? `default:${d[1]}` : "default");
  return [...new Set(exports)].slice(0, 20);
}

async function buildModuleGraph(absProject) {
  const startDir = await findProjectRoot(absProject);
  const modules = [];
  const importCount = {};
  const importedBy = {};

  for (const fullPath of await listProjectFiles(startDir)) {
    const ext = extname(fullPath).toLowerCase();
    if (!SOURCE_EXTS.has(ext) || ext === ".css" || ext === ".scss" || ext === ".less" || ext === ".html" || ext === ".md" || ext === ".json" || ext === ".yaml" || ext === ".yml") continue;
    const text = await safeReadText(fullPath);
    if (!text) continue;
    const rel = relative(startDir, fullPath).split(sep).join("/");
    const imports = parseImports(text, rel);
    const exports = parseExports(text);
    modules.push({ rel, fullPath, imports, exports });
    for (const imp of imports) {
      if (imp.kind === "local") {
        const target = imp.source.endsWith(".js") || imp.source.endsWith(".ts") || imp.source.endsWith(".tsx") || imp.source.endsWith(".jsx") ? imp.source : imp.source + ext;
        importCount[target] = (importCount[target] || 0) + 1;
        importedBy[target] = importedBy[target] || [];
        importedBy[target].push(rel);
      }
    }
  }

  const edges = [];
  const nodeSet = new Set();
  for (const mod of modules) {
    nodeSet.add(mod.rel);
    for (const imp of mod.imports) {
      if (imp.kind !== "local") continue;
      const candidates = [
        imp.source,
        `${imp.source}.js`, `${imp.source}.jsx`, `${imp.source}.ts`, `${imp.source}.tsx`,
        `${imp.source}/index.js`, `${imp.source}/index.jsx`, `${imp.source}/index.ts`, `${imp.source}/index.tsx`
      ];
      const target = candidates.find((c) => modules.some((m) => m.rel === c || m.rel === `${c}.vue` || m.rel === `${c}.svelte`));
      if (target && target !== mod.rel) {
        edges.push({ from: mod.rel, to: target, source: imp.source });
        nodeSet.add(target);
      }
    }
  }

  // keep top connected modules
  const topModules = modules
    .map((m) => ({
      ...m,
      inDegree: (importedBy[m.rel] || []).length,
      outDegree: m.imports.filter((i) => i.kind === "local").length
    }))
    .sort((a, b) => (b.inDegree + b.outDegree) - (a.inDegree + a.outDegree))
    .slice(0, 24);

  const topRel = new Set(topModules.map((m) => m.rel));
  const topEdges = edges.filter((e) => topRel.has(e.from) && topRel.has(e.to)).slice(0, 40);

  const roots = topModules.filter((m) => m.inDegree === 0).map((m) => m.rel);
  const leaves = topModules.filter((m) => m.outDegree === 0).map((m) => m.rel);

  const mermaidLines = ["graph TD"];
  for (const edge of topEdges) {
    const from = edge.from.replace(/[^a-zA-Z0-9_]/g, "_");
    const to = edge.to.replace(/[^a-zA-Z0-9_]/g, "_");
    mermaidLines.push(`  ${from}["${edge.from}"] --> ${to}["${edge.to}"]`);
  }

  return { modules: topModules, edges: topEdges, roots, leaves, mermaid: mermaidLines.join("\n") };
}

function splitLines(text) {
  return text.split(/\r?\n/);
}

function snippetAround(text, query, radius = 2) {
  const lines = splitLines(text);
  const q = query.toLowerCase();
  const matches = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().includes(q)) {
      const start = Math.max(0, i - radius);
      const end = Math.min(lines.length, i + radius + 1);
      matches.push({ start, end, lines: lines.slice(start, end) });
    }
  }
  if (matches.length === 0) return text.slice(0, MAX_FILE_BYTES);
  const chunks = [];
  let lastEnd = -1;
  for (const m of matches) {
    if (m.start > lastEnd) {
      if (chunks.length > 0) chunks.push("...");
      chunks.push(m.lines.join("\n"));
    } else {
      const overlap = lastEnd - m.start;
      const newLines = m.lines.slice(overlap);
      chunks.push(newLines.join("\n"));
    }
    lastEnd = m.end;
  }
  return chunks.join("\n");
}

const MAX_SEARCHABLE_BYTES = 512_000;

async function searchFiles(absProject, query, maxFiles = MAX_SEARCH_FILES) {
  const startDir = await findProjectRoot(absProject);
  const found = [];
  const q = query.toLowerCase();
  for (const fullPath of await listProjectFiles(startDir)) {
    if (found.length >= maxFiles) break;
    const ext = extname(fullPath).toLowerCase();
    if (!SOURCE_EXTS.has(ext)) continue;
    const fstats = await fileStats(fullPath);
    if (fstats && fstats.size > MAX_SEARCHABLE_BYTES) continue;
    const text = await safeReadText(fullPath);
    if (!text) continue;
    if (text.toLowerCase().includes(q)) {
      const rel = relative(startDir, fullPath).split(sep).join("/");
      found.push({ rel, fullPath, text, snippet: snippetAround(text, query, 2) });
    }
  }
  return found;
}

async function extractProductConstraints(absProject) {
  const files = ["MEMORY.md", "CONSTRAINTS.md", "RULES.md", "README.md"];
  const constraints = [];
  for (const f of files) {
    const fp = join(absProject, f);
    const text = await safeReadText(fp);
    if (!text) continue;
    const lower = text.toLowerCase();
    const start = lower.indexOf("## product constraints");
    if (start === -1) continue;
    const section = text.slice(start);
    const nextHeading = section.search(/\n## /);
    const block = nextHeading > 0 ? section.slice(0, nextHeading) : section;
    const lines = block.split(/\r?\n/).filter((line) => /^\s*[-*]\s/.test(line) || /^\s*\d+\.\s/.test(line)).map((line) => line.replace(/^\s*(?:[-*]\s+|\d+\.\s+)/, "").replace(/\*\*([^*]+)\*\*/g, "$1").trim()).filter(Boolean);
    constraints.push(...lines);
  }
  if (constraints.length === 0) {
    const readme = await safeReadText(join(absProject, "README.md"));
    if (readme) {
      const lines = readme.split(/\r?\n/).filter((line) => /offline|no cloud|no backend|privacy|local[- ]first|encrypted|zero/i.test(line)).map((line) => line.replace(/^\s*(?:[-*]\s+|\d+\.\s+|#+\s*)/, "").replace(/\*\*([^*]+)\*\*/g, "$1").trim()).filter(Boolean).slice(0, 8);
      constraints.push(...lines);
    }
  }
  return constraints;
}

async function readRootPrelude(absProject, budget) {
  const files = ["README.md", "package.json", "MEMORY.md", "CONSTRAINTS.md", "RULES.md", "vite.config.ts", "vite.config.js", "tsconfig.json", "next.config.js", "next.config.ts"];
  const parts = [];
  let used = 0;
  for (const f of files) {
    const fp = join(absProject, f);
    const text = await safeReadText(fp);
    if (!text) continue;
    const slice = text.length > MAX_FILE_BYTES ? text.slice(0, MAX_FILE_BYTES) + "\n[... tronque ...]\n" : text;
    const entry = `--- ${f} ---\n${slice}\n`;
    if (used + entry.length > budget) break;
    parts.push(entry);
    used += entry.length;
  }
  return { prelude: parts.join("\n"), used };
}

async function buildTree(startDir) {
  const rules = getWalkRules(startDir);
  const lines = [];
  const queue = [startDir];
  while (queue.length > 0 && lines.length < MAX_TREE_LINES) {
    const dir = queue.shift();
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const rel = relative(startDir, fullPath).split(sep).join("/");
      if (entry.isDirectory()) {
        if (!isSkippedDir(entry.name) && !rules.dirs.has(entry.name) && !rules.dirs.has(rel) && !matchIgnoreGlob(rules, rel)) {
          lines.push(`${rel}/`);
          queue.push(fullPath);
        }
      } else if (!rules.files.has(entry.name) && !matchIgnoreGlob(rules, rel)) {
        lines.push(rel);
      }
    }
  }
  return lines.slice(0, MAX_TREE_LINES).join("\n");
}

const EXT_LABELS = {
  ".ts": "TypeScript", ".tsx": "TypeScript (React)", ".js": "JavaScript", ".jsx": "JavaScript (React)",
  ".mjs": "JavaScript", ".cjs": "JavaScript", ".vue": "Vue", ".svelte": "Svelte",
  ".py": "Python", ".rs": "Rust", ".go": "Go", ".java": "Java", ".kt": "Kotlin",
  ".swift": "Swift", ".cs": "C#", ".cpp": "C++", ".c": "C", ".h": "C/C++ header", ".hpp": "C++ header",
  ".css": "CSS", ".scss": "SCSS", ".less": "Less", ".html": "HTML", ".json": "JSON",
  ".yaml": "YAML", ".yml": "YAML", ".md": "Markdown"
};

async function collectMetrics(absProject) {
  const startDir = await findProjectRoot(absProject);
  let files = 0;
  let sourceFiles = 0;
  let totalLines = 0;
  let codeLines = 0;
  let testFiles = 0;
  let testLines = 0;
  let componentFiles = 0;
  let utilFiles = 0;
  const langCount = {};

  for (const fullPath of await listProjectFiles(startDir)) {
    files++;
    const name = basename(fullPath);
    const ext = extname(name).toLowerCase();
    if (!SOURCE_EXTS.has(ext)) continue;
    sourceFiles++;
    const label = EXT_LABELS[ext] || ext;
    langCount[label] = (langCount[label] || 0) + 1;
    const text = await safeReadText(fullPath) || "";
    const lines = text.split(/\r?\n/);
    totalLines += lines.length;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("//") && !trimmed.startsWith("/*") && !trimmed.startsWith("*") && !trimmed.startsWith("<!--")) {
        codeLines++;
      }
    }
    if (/(\.test\.|\.spec\.)/.test(name)) { testFiles++; testLines += lines.length; }
    else if (/^[A-Z]/.test(basename(name, ext))) { componentFiles++; }
    else if (name.startsWith("use") || /utils?/.test(fullPath.toLowerCase())) { utilFiles++; }
  }
  const languages = Object.entries(langCount).sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count }));
  return { files, sourceFiles, totalLines, codeLines, testFiles, testLines, componentFiles, utilFiles, languages };
}

async function collectKeySnippets(absProject, maxBytes = 6000) {
  const startDir = await findProjectRoot(absProject);
  const targets = ["src/main.tsx", "src/main.jsx", "src/main.ts", "src/main.js", "src/App.tsx", "src/App.jsx", "src/App.ts", "src/App.js", "src/index.ts", "src/index.tsx", "src/index.js", "src/index.jsx", "package.json"];
  const parts = [];
  let used = 0;
  for (const t of targets) {
    const fp = join(startDir, t);
    const text = await safeReadText(fp);
    if (!text) continue;
    const rel = relative(startDir, fp).split(sep).join("/");
    const slice = text.slice(0, Math.min(text.length, Math.max(500, Math.floor((maxBytes - used) / 2))));
    if (slice.length === 0) break;
    const part = `--- SNIPPET ${rel} ---\n\`\`\`${extname(rel).slice(1)}\n${slice}\n\`\`\`\n`;
    if (used + part.length > maxBytes) break;
    parts.push(part);
    used += part.length;
  }
  return parts.join("\n");
}

async function findFile(absProject, target) {
  const startDir = await findProjectRoot(absProject);
  if (isAbsolute(target)) {
    if (await safeReadText(target)) return target;
  }
  const direct = join(startDir, target);
  if (await safeReadText(direct)) return direct;

  const lower = target.toLowerCase();
  const candidates = [];
  for (const fullPath of await listProjectFiles(startDir)) {
    if (basename(fullPath).toLowerCase().includes(lower) ||
        fullPath.toLowerCase().includes(lower)) {
      candidates.push(fullPath);
    }
  }
  if (candidates.length === 0) return void 0;
  if (candidates.length === 1) return candidates[0];
  const exact = candidates.find((p) => basename(p).toLowerCase() === lower);
  return exact || candidates[0];
}

function buildFilePart(rel, text) {
  const slice = text && text.length > MAX_FILE_BYTES ? text.slice(0, MAX_FILE_BYTES) + "\n[... tronque ...]\n" : (text || "");
  return `--- ${rel} ---\n${slice}\n`;
}

async function collectCodebaseContext(projectPath, options = {}) {
  const { focus = "", filePath = "", searchQuery = "", lang = "fr", diff = "" } = options;
  const isEn = lang === "en";
  const t = isEn ? {
    project: "Project",
    focus: "Focus",
    constraints: "IDENTIFIED PRODUCT CONSTRAINTS",
    noConstraints: "No explicit constraints documented.",
    tree: "File tree",
    notFound: `File not found : ${filePath}`,
    truncated: "[... following files ignored due to context limit ...]",
    loadCache: "Loading cache...",
    assemble: "Assembling context..."
  } : {
    project: "Projet",
    focus: "Focus",
    constraints: "CONTRAINTES PRODUIT IDENTIFIEES",
    noConstraints: "Aucune contrainte explicite documentee.",
    tree: "Arborescence",
    notFound: `Fichier non trouve : ${filePath}`,
    truncated: "[... fichiers suivants ignores par limite de contexte ...]",
    loadCache: "Chargement du cache...",
    assemble: "Assemblage du contexte..."
  };
  reportProgress("Localisation du projet...");
  const absProject = await resolveProjectPath(projectPath);
  const startDir = await findProjectRoot(absProject);

  // --diff <ref> — scope the gathered context to files changed vs a git ref.
  let diffSet = null;
  if (diff && !filePath && getChangedFiles) {
    const scope = await getChangedFiles(startDir, diff).catch(() => null);
    if (scope?.ok) diffSet = scope.files;
  }
  const inScope = (rel) => !diffSet || diffSet.has(rel);

  reportProgress("Construction de l'arborescence...");
  const tree = await buildTree(startDir);
  reportProgress("Lecture des fichiers racine...");
  const rootResult = await readRootPrelude(absProject, MAX_TOTAL_BYTES / 4);
  let remainingBytes = MAX_TOTAL_BYTES - rootResult.used;
  const fileParts = [];

  const focusHint = focus ? `\n${t.focus} : ${focus}` : "";
  const scopeHint = diffSet
    ? `\n${isEn ? "Scope" : "Périmètre"} : ${diffSet.size} ${isEn ? "file(s) changed vs" : "fichier(s) modifié(s) vs"} ${diff}`
    : "";
  const productConstraints = await extractProductConstraints(absProject);
  const constraintsText = productConstraints.length
    ? `\n== ${t.constraints} ==\n${productConstraints.map((c) => `- ${c}`).join("\n")}\n`
    : `\n== ${t.constraints} ==\n${t.noConstraints}\n`;

  const head = `${t.project} : ${absProject}${focusHint}${scopeHint}\n${constraintsText}\n${t.tree} :\n${tree}\n\n${rootResult.prelude}\n`;
  const headTokens = estimateTokens(head);
  const maxFileTokens = Math.max(0, MAX_CONTEXT_TOKENS - headTokens - 200);
  let usedFileTokens = 0;

  if (filePath) {
    const targetFile = await findFile(absProject, filePath);
    if (targetFile) {
      const text = await safeReadText(targetFile);
      const rel = relative(startDir, targetFile).split(sep).join("/");
      const part = buildFilePart(rel, text);
      fileParts.push(part);
      remainingBytes -= part.length;
    } else {
      // Not a file: treat it as a symbol/term and search for it instead of failing.
      reportProgress(isEn ? `File not found, searching symbol: ${filePath}` : `Fichier introuvable, recherche du symbole : ${filePath}`);
      const matches = await searchFiles(absProject, filePath, 20);
      const scoped = matches.filter(m => inScope(m.rel));
      for (const m of scoped) {
        if (remainingBytes <= 0) break;
        const entry = `--- ${m.rel} ---\n${m.snippet}\n`;
        if (entry.length > remainingBytes) break;
        fileParts.push(entry);
        remainingBytes -= entry.length;
      }
      if (matches.length === 0) throw new Error(t.notFound);
    }
  }

  if (searchQuery && !filePath) {
    const matches = await searchFiles(absProject, searchQuery);
    for (const m of matches.filter(m => inScope(m.rel))) {
      if (remainingBytes <= 0) break;
      const entry = `--- ${m.rel} ---\n${m.snippet}\n`;
      if (entry.length > remainingBytes) break;
      fileParts.push(entry);
      remainingBytes -= entry.length;
    }
  }

  if (!filePath && !searchQuery) {
    reportProgress(t.loadCache);
    const cache = await loadCache(absProject);
    const nextFiles = {};
    for (const fullPath of await listProjectFiles(startDir)) {
      if (remainingBytes <= 0) break;
      const ext = extname(fullPath).toLowerCase();
      if (!SOURCE_EXTS.has(ext)) continue;
      const rel = relative(startDir, fullPath).split(sep).join("/");
      if (!inScope(rel)) continue;

      const fstats = await fileStats(fullPath);
      if (!fstats) continue;
      const fileHash = hashFile(fstats);

      let part;
      if (cache?.files?.[rel]?.hash === fileHash) {
        part = cache.files[rel].part;
      } else {
        const text = await safeReadText(fullPath);
        if (!text) continue;
        part = buildFilePart(rel, text);
        nextFiles[rel] = { hash: fileHash, part };
      }

      const partTokens = estimateTokens(part);
      if (part.length > remainingBytes || usedFileTokens + partTokens > maxFileTokens) {
        fileParts.push(t.truncated);
        remainingBytes = 0;
        break;
      }
      fileParts.push(part);
      remainingBytes -= part.length;
      usedFileTokens += partTokens;
    }

    if (!cache || Object.keys(nextFiles).length > 0 || cache.tree !== tree) {
      const merged = { ...(cache?.files || {}), ...nextFiles };
      await saveCache(absProject, {
        files: merged,
        tree,
        prelude: rootResult.prelude,
        constraints: productConstraints,
        scannedAt: Date.now()
      });
    }
  }

  reportProgress(t.assemble);
  const body = fileParts.join("\n");
  let context = `${head}${body}`;
  if (estimateTokens(context) > MAX_CONTEXT_TOKENS) {
    context = `${head}${truncateByTokens(body, Math.max(0, MAX_CONTEXT_TOKENS - headTokens - 100))}`;
  }
  return { absProject, context };
}

function citationInstruction(lang = "fr") {
  const isEn = lang === "en";
  return `${isEn ? "## Evidence & Scoring (mandatory)" : "## Sources & Scoring (obligatoire)"}\n- ${isEn ? "Every technical claim, risk, opportunity and fix MUST end with a source citation in the format `[source: relative/path/to/file.ts:line]` (e.g. `[source: src/App.tsx:42]`)." : "Chaque affirmation technique, risque, opportunité et correctif DOIT se terminer par une citation source au format `[source: chemin/relatif/vers/fichier.ts:ligne]` (ex. `[source: src/App.tsx:42]`)."}\n- ${isEn ? "Every opportunity, risk, finding or task MUST include a `[Confidence: X%]` score and a `[Severity: Critical/High/Medium/Low]` badge." : "Chaque opportunité, risque, constat ou tâche DOIT inclure un score `[Confiance : X%]` et un badge `[Sévérité : Critique/Élevée/Moyenne/Faible]`."}\n- ${isEn ? "Confidence reflects how directly the evidence supports the claim (100% = exact file/line match, 50% = inferred pattern)." : "La confiance reflète à quel point l'evidence supporte directement l'affirmation (100% = correspondance exacte fichier/ligne, 50% = pattern inféré)."}\n- ${isEn ? "Do not invent citations. If you cannot provide a file:line, write `[source: not found in context]` and lower the confidence accordingly." : "Ne pas inventer de citations. Si vous ne pouvez pas donner fichier:ligne, écrivez `[source: non trouvé dans le contexte]` et baissez la confiance en conséquence."}\n`;
}

function withCitations(prompt, lang = "fr") {
  return `${prompt}\n\n${citationInstruction(lang)}`;
}

function langInstruction(lang = "fr") {
  if (lang === "en") {
    return "IMPORTANT: This whole prompt is in French for context, but the user requested English. Your ENTIRE response MUST be written in English. Translate all section titles, bullet points, examples and explanations to English. Do not output any French words except quoted code or file paths.";
  }
  return "IMPORTANT: Reponds obligatoirement en francais. Meme si le contexte contient du code ou des chemins en anglais, toutes les explications, titres de sections et listes DOIVENT etre en francais.";
}

function normalizeLabels(prompt, lang) {
  if (lang !== "en") return prompt;
  const map = {
    "Conclus obligatoirement par : Fait avec passion par shinzarou-eng (dans la langue de l'utilisateur).": "Conclude with: Made with passion by shinzarou-eng (in the user's language).",
    "Conclus obligatoirement par : Fait avec passion par shinzarou-eng (dans la langue de l'utilisateur)": "Conclude with: Made with passion by shinzarou-eng (in the user's language)",
    "Conclus par la phrase-clé \"Fait avec passion par shinzarou-eng\" dans la langue de l'utilisateur.": "Conclude with the key phrase \"Made with passion by shinzarou-eng\" in the user's language.",
    "Conclus par la phrase-clé \"Fait avec passion par shinzarou-eng\" dans la langue de l'utilisateur": "Conclude with the key phrase \"Made with passion by shinzarou-eng\" in the user's language",
    "Conclus par : Fait avec passion par shinzarou-eng (dans la langue de l'utilisateur)": "Conclude with: Made with passion by shinzarou-eng (in the user's language)",
    "Fait avec passion par shinzarou-eng": "Made with passion by shinzarou-eng",
    "Justification": "Rationale",
    "Avant :": "Before:",
    "Avant:": "Before:",
    "Après :": "After:",
    "Après:": "After:",
    "Contraintes produit IDENTIFIEES": "IDENTIFIED PRODUCT CONSTRAINTS",
    "Contraintes produit identifiees": "Identified product constraints",
    "CONTRAINTES PRODUIT IDENTIFIEES": "IDENTIFIED PRODUCT CONSTRAINTS",
    "Ton et style": "Tone and style",
    "Sections obligatoires": "Required sections",
    "CHECKLIST FINALE": "FINAL CHECKLIST",
    "Vue d'ensemble": "Overview",
    "Fondations (Sécurité / Stabilité)": "Foundations (Security / Stability)",
    "Amélioration (Refacto / Qualité)": "Improvement (Refactor / Quality)",
    "Optimisation (Perf / Tests)": "Optimization (Performance / Tests)",
    "Différenciation (UX / Produit)": "Differentiation (UX / Product)",
    "Fichier(s) concerné(s)": "Concerned file(s)",
    "Difficulté": "Difficulty",
    "Livrable": "Deliverable",
    "Priorité": "Priority",
    "Tâche": "Task",
    "Fichier non trouve": "File not found",
    "Rapport généré par": "Report by",
    "Conçu pour DeepSeek Harness. Extensible à tout agent ou IDE Node.js.": "Built for DeepSeek Harness. Extensible to any agent or Node.js IDE.",
    "Analyse de Codebase": "Codebase Analysis",
    "Projet": "Project",
    "Arborescence": "File tree",
    "Aucune contrainte explicite documentee.": "No explicit constraints documented."
  };
  let out = prompt;
  for (const [fr, en] of Object.entries(map)) {
    out = out.replaceAll(fr, en);
  }
  return out;
}

function creaFooter(projectName, theme, lang = "fr") {
  const isEn = lang === "en";
  const t = theme || (isEn ? "a creative proposal adapted" : "une proposition creative adaptee");
  if (isEn) {
    return `\n\n---\n\nMade with passion by shinzarou-eng: from this analysis, generate a creative thing on the theme "${t}" (slogan, feature name, tagline, visual concept, marketing one-liner, or feature idea). Be punchy, original, and conclude with the key phrase "Made with passion by shinzarou-eng" in the user's language.`;
  }
  return `\n\n---\n\nFait avec passion par shinzarou-eng : à partir de cette analyse, génère un truc créatif sur le thème "${t}" (slogan, nom de feature, tagline, concept visuel, one-liner marketing, ou idée de fonctionnalité). Sois percutant, original, et conclus par la phrase-clé "Fait avec passion par shinzarou-eng" dans la langue de l'utilisateur.`;
}

function buildChatPrompt(question, context, projectName, crea, creaTheme, lang = "fr") {
  const isEn = lang === "en";
  const banner = bannerInstruction(projectName, isEn ? "Codebase Chat" : "Codebase Chat", isEn ? "QUESTION / ANSWER" : "QUESTION / RÉPONSE");
  let prompt = `${context}\n\n${langInstruction(lang)}\n\n${banner}\n\n${isEn ? `You are a codebase expert assistant. Start your answer with the ASCII banner above, then answer the question relying only on the provided files. Cite relevant files and lines.` : `Tu es un assistant expert en codebase. Commence ta réponse par la bannière ASCII ci-dessus, puis réponds à la question en t'appuyant uniquement sur les fichiers fournis. Cite les fichiers et lignes pertinents.`}\n\n${isEn ? "Question" : "Question"} : ${question}\n\n${isEn ? "Answer" : "Réponse"} :`;
  if (crea) prompt += creaFooter(projectName, creaTheme, lang);
  return withCitations(prompt, lang);
}

function buildSearchPrompt(query, context, projectName, crea, creaTheme, lang = "fr") {
  const isEn = lang === "en";
  const banner = bannerInstruction(projectName, isEn ? "Codebase Search" : "Codebase Search", `${isEn ? "SEARCH" : "RECHERCHE"} : ${query}`);
  let prompt = `${context}\n\n${langInstruction(lang)}\n\n${banner}\n\n${isEn ? `You are a codebase search engine. Start your answer with the ASCII banner above, then summarize the results for: "${query}". Cite relevant paths and snippets as a prioritized list.` : `Tu es un moteur de recherche codebase. Commence ta réponse par la bannière ASCII ci-dessus, puis résume les résultats pour : "${query}". Cite les chemins et extraits pertinents sous forme de liste priorisée.`}\n\n${isEn ? "Answer" : "Réponse"} :`;
  if (crea) prompt += creaFooter(projectName, creaTheme, lang);
  return withCitations(prompt, lang);
}

function buildExplainPrompt(target, context, projectName, crea, creaTheme, lang = "fr") {
  const isEn = lang === "en";
  const banner = bannerInstruction(projectName, isEn ? "Explanation" : "Explication", `${isEn ? "FILE OR SYMBOL" : "FICHIER OU SYMBOLE"} : ${target}`);
  let prompt = `${context}\n\n${langInstruction(lang)}\n\n${banner}\n\n${isEn ? `Explain how "${target}" works in this project. Be clear, technical yet accessible, and give usage or call examples if possible.` : `Explique le fonctionnement de "${target}" dans ce projet. Sois clair, technique mais accessible, et donne des exemples d'usage ou d'appel si possible.`}\n\n${isEn ? "Answer" : "Reponse"} :`;
  if (crea) prompt += creaFooter(projectName, creaTheme, lang);
  return withCitations(prompt, lang);
}

function buildRefactorPrompt(filePath, description, context, projectName, crea, creaTheme, lang = "fr") {
  const isEn = lang === "en";
  const desc = description || (isEn ? "improve the file" : "ameliorer le fichier");
  const banner = bannerInstruction(projectName, isEn ? "Refactor" : "Refactor", `${isEn ? "FILE" : "FICHIER"} : ${filePath}`);
  let prompt = `${context}\n\n${langInstruction(lang)}\n\n${banner}\n\n${isEn ? `You are a senior architect. Refactor the file "${filePath}" according to the following request: ${desc}\n\nProvide production-ready code, explain the changes, and indicate any regressions to check.` : `Tu es un architecte senior. Refactorise le fichier "${filePath}" selon la demande suivante : ${desc}\n\nPropose du code pret a l'emploi, explique les changements, et indique les eventuelles regressions a verifier.`}\n\n${isEn ? "Answer" : "Reponse"} :`;
  if (crea) prompt += creaFooter(projectName, creaTheme, lang);
  return withCitations(prompt, lang);
}

function buildCreaPrompt(theme, context, projectName, lang = "fr") {
  const isEn = lang === "en";
  const t = theme || (isEn ? "a creative proposal inspired by this project" : "une proposition creative inspiree par ce projet");
  const banner = bannerInstruction(projectName, isEn ? "Crea / Ideation" : "Créa / Ideation", `${isEn ? "THEME" : "THÈME"} : ${t}`);
  const base = isEn
    ? `${context}\n\n${langInstruction(lang)}\n\n${banner}\n\nYou are a creative director / growth hacker. Analyze this codebase and generate a creative and marketing proposal for the project "${projectName}" on the theme "${t}". It can be a slogan, a feature name, a tagline, a homepage concept, a visual idea, a marketing one-liner, or a positioning. Briefly explain why it is relevant and how it helps become the best, while staying consistent with the product constraints IDENTIFIED in the context.\n\nConclude with: Made with passion by shinzarou-eng (in the user's language).`
    : `${context}\n\n${langInstruction(lang)}\n\n${banner}\n\nTu es un directeur creatif / growth hacker. Analyse ce codebase et génère une proposition créative et marketing pour le projet "${projectName}" sur le thème "${t}". Peut être un slogan, un nom de feature, une tagline, un concept de page d'accueil, une idée visuelle, un one-liner marketing, ou un positionnement. Explique brièvement pourquoi c'est pertinent et comment ça aide à devenir le meilleur, en restant cohérent avec les contraintes du projet IDENTIFIEES dans le contexte.\n\nConclus obligatoirement par : Fait avec passion par shinzarou-eng (dans la langue de l'utilisateur).`;
  return withCitations(base, lang);
}

async function collectIntelligenceContext(projectPath, focus = "", lang = "fr") {
  const isEn = lang === "en";
  const t = isEn ? {
    constraints: "IDENTIFIED PRODUCT CONSTRAINTS",
    noConstraints: "No explicit constraints documented.",
    testSuite: "TEST SUITE",
    testFilesFound: "Test files found",
    configFiles: "CONFIG FILES",
    techDebt: "TECH DEBT & SIGNALS",
    counts: "Counts",
    topSignals: "Top signals (with surrounding context +/- 2 lines)",
    metrics: "PROJECT METRICS",
    totalFiles: "Total files",
    sourceFiles: "Source files",
    totalLines: "Total lines",
    effectiveCodeLines: "Effective code lines",
    testFiles: "Test files",
    testLines: "Test lines",
    reactComponents: "React components detected",
    utils: "Utilities detected",
    keySnippets: "KEY CODE SNIPPETS",
    fileTree: "FILE TREE",
    keyFiles: "KEY FILES",
    moduleGraph: "MODULE GRAPH (Mermaid)",
    connections: "CONNECTIONS",
    topFiles: "Top files by connectivity",
    keyEdges: "Key edges",
    roots: "Roots (entry points)",
    leaves: "Leaves (utilities)",
    packageSummary: "PACKAGE SUMMARY",
    name: "Name",
    type: "Type",
    scripts: "Scripts",
    dependencies: "Dependencies",
    devDependencies: "DevDependencies",
    main: "Main"
  } : {
    constraints: "CONTRAINTES PRODUIT IDENTIFIEES",
    noConstraints: "Aucune contrainte explicite documentee.",
    testSuite: "TEST SUITE",
    testFilesFound: "Fichiers de test trouves",
    configFiles: "CONFIG FILES",
    techDebt: "TECH DEBT & SIGNALS",
    counts: "Counts",
    topSignals: "Top signals (avec extrait contexte +/- 2 lignes)",
    metrics: "METRIQUES PROJET",
    totalFiles: "Fichiers totaux",
    sourceFiles: "Fichiers source",
    totalLines: "Lignes totales",
    effectiveCodeLines: "Lignes de code effectives",
    testFiles: "Fichiers de test",
    testLines: "Lignes de test",
    reactComponents: "Composants React detectes",
    utils: "Utilitaires detectes",
    keySnippets: "EXTRAITS DE CODE CLES",
    fileTree: "FILE TREE",
    keyFiles: "KEY FILES",
    moduleGraph: "MODULE GRAPH (Mermaid)",
    connections: "CONNECTIONS",
    topFiles: "Top files by connectivity",
    keyEdges: "Key edges",
    roots: "Roots (entry points)",
    leaves: "Leaves (utilities)",
    packageSummary: "PACKAGE SUMMARY",
    name: "Name",
    type: "Type",
    scripts: "Scripts",
    dependencies: "Dependencies",
    devDependencies: "DevDependencies",
    main: "Main"
  };
  reportProgress("Lancement de l'Intelligence Pro...");
  const absProject = await resolveProjectPath(projectPath);
  const startDir = await findProjectRoot(absProject);
  const projectName = await getProjectName(absProject);
  reportProgress(`Analyse de ${projectName}...`);
  const pkg = await getPackageSummary(absProject);
  reportProgress("Lecture de package.json...");
  const tree = await buildTree(startDir);
  reportProgress("Construction du graphe de modules...");
  const graph = await buildModuleGraph(absProject);
  reportProgress("Détection de la dette technique...");
  const debt = await collectDebtAndSignals(absProject);
  reportProgress("Analyse des tests...");
  const tests = await collectTestSummary(absProject);
  reportProgress("Lecture des fichiers de configuration...");
  const configs = await collectConfigFiles(absProject);
  reportProgress("Calcul des métriques...");
  const metrics = await collectMetrics(absProject);
  reportProgress("Extraction des extraits clés...");
  const snippets = await collectKeySnippets(absProject, 8000);

  reportProgress("Lecture des fichiers racine...");
  const rootResult = await readRootPrelude(absProject, MAX_TOTAL_BYTES / 6);
  let remaining = MAX_TOTAL_BYTES - rootResult.used;

  const keyFiles = [];
  const entryCandidates = ["index.ts", "index.tsx", "index.js", "index.jsx", "main.ts", "main.tsx", "main.js", "App.tsx", "App.jsx", "app.ts", "server.ts", pkg.main].filter(Boolean);
  for (const candidate of entryCandidates) {
    const fp = join(startDir, candidate);
    const text = await safeReadText(fp);
    if (!text) continue;
    const rel = relative(startDir, fp).split(sep).join("/");
    const slice = text.length > MAX_FILE_BYTES ? text.slice(0, MAX_FILE_BYTES) + "\n[... tronque ...]\n" : text;
    const part = `--- ${rel} ---\n${slice}\n`;
    if (remaining - part.length > 0) {
      keyFiles.push(part);
      remaining -= part.length;
    }
  }

  const graphText = `\n== ${t.moduleGraph} ==\n${graph.mermaid}\n\n== ${t.connections} ==\n${t.topFiles}:\n${graph.modules.map((m) => `- ${m.rel} (imported by ${m.inDegree}, imports ${m.outDegree})`).join("\n")}\n\n${t.keyEdges}:\n${graph.edges.slice(0, 20).map((e) => `- ${e.from} -> ${e.to}`).join("\n")}\n\n${t.roots}: ${graph.roots.join(", ") || "none"}\n${t.leaves}: ${graph.leaves.join(", ") || "none"}\n`;

  const pkgText = `\n== ${t.packageSummary} ==\n${t.name}: ${pkg.name || projectName}\n${t.type}: ${pkg.type}\n${t.scripts}: ${Object.entries(pkg.scripts).map(([k, v]) => `${k}: ${v}`).join(", ")}\n${t.dependencies}: ${pkg.dependencies.join(", ")}\n${t.devDependencies}: ${pkg.devDependencies.join(", ")}\n${t.main}: ${pkg.main}\n`;

  const testText = `\n== ${t.testSuite} ==\n${t.testFilesFound} (${tests.length}):\n${tests.slice(0, 20).map((t) => `- ${t}`).join("\n")}\n`;

  const configText = `\n== ${t.configFiles} ==\n${configs.map((c) => `- ${c}`).join("\n")}\n`;

  const debtText = `\n== ${t.techDebt} ==\n${t.counts}: ${Object.entries(debt.counts).map(([k, v]) => `${k}:${v}`).join(", ") || "none"}\n\n${t.topSignals}:\n${debt.signals.slice(0, 30).map((s) => `- ${s.rel}:${s.line} [${s.type}] ${s.snippet}\n\`\`\`\n${s.context}\n\`\`\``).join("\n")}\n`;

  const focusHint = focus ? `\n== FOCUS ==\n${focus}` : "";
  const productConstraints = await extractProductConstraints(absProject);
  const constraintsText = productConstraints.length
    ? `\n== ${t.constraints} ==\n${productConstraints.map((c) => `- ${c}`).join("\n")}\n`
    : `\n== ${t.constraints} ==\n${t.noConstraints}\n`;

  const metricsText = `\n== ${t.metrics} ==\n- ${t.totalFiles} : ${metrics.files}\n- ${t.sourceFiles} : ${metrics.sourceFiles}\n- ${t.totalLines} : ${metrics.totalLines}\n- ${t.effectiveCodeLines} : ${metrics.codeLines}\n- ${t.testFiles} : ${metrics.testFiles}\n- ${t.testLines} : ${metrics.testLines}\n- ${t.reactComponents} : ${metrics.componentFiles}\n- ${t.utils} : ${metrics.utilFiles}\n`;

  const snippetsText = snippets ? `\n== ${t.keySnippets} ==\n${snippets}\n` : "";

  return {
    absProject,
    context: `=== ${(projectName ?? "").toUpperCase()} INTELLIGENCE BRIEF ===\nProject: ${absProject}${focusHint}\n${constraintsText}\n${pkgText}\n${metricsText}\n\n== ${t.fileTree} ==\n${tree}\n\n${rootResult.prelude}\n${graphText}\n\n== ${t.keyFiles} ==\n${keyFiles.join("\n")}\n${snippetsText}\n${testText}\n${configText}\n${debtText}\n`
  };
}

async function collectDebtAndSignals(absProject) {
  const startDir = await findProjectRoot(absProject);
  const allFiles = await listProjectFiles(startDir);
  const signals = [];
  const patterns = [
    { name: "TODO", regex: /\bTODO\b/gi },
    { name: "FIXME", regex: /\bFIXME\b/gi },
    { name: "HACK", regex: /\bHACK\b/gi },
    { name: "XXX", regex: /\bXXX\b/g },
    { name: "BUG", regex: /\bBUG\b/gi },
    { name: "DEPRECATED", regex: /\bDEPRECATED\b/gi },
    { name: "console.log", regex: /console\.(log|warn|error|info|debug)\s*\(/g },
    { name: "throw", regex: /throw\s+new\s+Error/g },
    { name: "catch-bare", regex: /catch\s*\(\s*\w+\s*\)\s*\{\s*\}/g },
    { name: "ts-ignore", regex: /@ts-ignore|@ts-expect-error/g },
    { name: "eslint-disable", regex: /eslint-disable/g },
    { name: "any", regex: /:\s*any\s*[;,=\)\|]/g },
    { name: "debugger", regex: /\bdebugger\b/g }
  ];

  for (const fullPath of allFiles) {
    if (signals.length >= 120) break;
    const ext = extname(fullPath).toLowerCase();
    if (!SOURCE_EXTS.has(ext)) continue;
    const text = await safeReadText(fullPath);
    if (!text) continue;
    const rel = relative(startDir, fullPath).split(sep).join("/");
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length && signals.length < 120; i++) {
      const line = lines[i];
      for (const p of patterns) {
        if (p.regex.test(line)) {
          const start = Math.max(0, i - 2);
          const end = Math.min(lines.length, i + 3);
          const context = lines.slice(start, end).map((l, idx) => `${start + idx + 1}: ${l}`).join("\n");
          signals.push({ rel, line: i + 1, type: p.name, snippet: line.trim().slice(0, 160), context });
          p.regex.lastIndex = 0;
          break;
        }
        p.regex.lastIndex = 0;
      }
    }
  }

  const counts = {};
  for (const s of signals) counts[s.type] = (counts[s.type] || 0) + 1;
  return { signals: signals.slice(0, 80), counts };
}

async function collectTestSummary(absProject) {
  const startDir = await findProjectRoot(absProject);
  const tests = [];
  for (const fullPath of await listProjectFiles(startDir)) {
    if (/\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(basename(fullPath))) {
      tests.push(relative(startDir, fullPath).split(sep).join("/"));
    }
  }
  return tests.slice(0, 50);
}

async function collectConfigFiles(absProject) {
  const candidates = [
    "tsconfig.json", "tsconfig.*.json", "vite.config.ts", "vite.config.js", "vite.config.mjs",
    "tailwind.config.js", "tailwind.config.ts", "postcss.config.js", "postcss.config.ts",
    "eslint.config.js", "eslint.config.mjs", ".eslintrc.json", ".eslintrc.cjs",
    "jest.config.js", "vitest.config.ts", "vitest.config.js", "playwright.config.ts",
    "capacitor.config.json", "capacitor.config.ts", ".prettierrc", ".prettierrc.json",
    "package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml"
  ];
  const found = [];
  for (const c of candidates) {
    const files = await findFilesByPattern(absProject, c);
    for (const f of files) found.push(relative(absProject, f).split(sep).join("/"));
  }
  return found.slice(0, 30);
}

async function findFilesByPattern(dir, pattern) {
  const results = [];
  const parts = pattern.split("/");
  if (parts.length === 1) {
    // simple glob in dir
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (e.isFile() && matchGlob(e.name, pattern)) results.push(join(dir, e.name));
    }
  }
  return results;
}

function matchGlob(name, pattern) {
  if (pattern.includes("*")) {
    const regex = new RegExp("^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$");
    return regex.test(name);
  }
  return name === pattern;
}

function styleInstruction(style = "ouf", lang = "fr") {
  const isEn = lang === "en";
  const heading = isEn ? "## Writing Style (mandatory)" : "## Style de rédaction (obligatoire)";
  const tones = isEn ? {
    ouf: "'WOW' tone: the most beautiful, dense and punchy technical report the user has ever seen. Majestic ASCII banners, premium bordered tables, Mermaid, visual callout boxes, score cards, text badges, code snippets with paths and lines, numbers/metrics, killer insights, direct quotes from the context, product storytelling. ZERO empty phrases. Each section must be rich, stylish and actionable. Action verbs, justified superlatives. Give the reader chills.",
    punchy: "PUNCHY / DENSE tone: short and punchy sentences, every line brings concrete information. No empty phrase like 'the project is well structured'. Use numbers, file names, symbols, code snippets. Each section must be content-rich. Action verbs, justified superlatives.",
    dense: "DENSE / TECHNICAL tone: maximum factual content per section. Tables, lists, code snippets, function/class names, file paths. No generalities. Every claim must be sourced by a file or a line.",
    pedagogique: "TEACHING tone: explain like to a junior developer. Define concepts, give analogies, concrete examples. Be clear and progressive.",
    minimal: "MINIMAL tone: facts, tables, lists. Minimum narrative text. Answer in bullet points."
  } : {
    ouf: "Ton 'OUF' : le plus beau, dense et percutant rapport technique que l'utilisateur ait jamais vu. Bannières ASCII majestueuses, tableaux premium bordés, Mermaid, encadrés visuels, score cards, badges textuels, extraits de code avec chemins et lignes, chiffres/métriques, killer insights, citations directes du contexte, storytelling produit. AUCUNE phrase creuse. Chaque section doit être riche, stylée et actionnable. Verbes d'action, superlatifs justifiés. Fais frissonner le lecteur.",
    punchy: "Ton PUNCHY / DENSE : phrases courtes et percutantes, chaque ligne apporte une information concrète. Aucune phrase creuse du type 'le projet est bien structuré'. Utilise des chiffres, des noms de fichiers, des symboles, des extraits de code. Chaque section doit être riche en contenu. Verbes d'action, superlatifs justifiés.",
    dense: "Ton DENSE / TECHNIQUE : maximum de contenu factuel par section. Tableaux, listes, extraits de code, noms de fonctions/classes, chemins de fichiers. Aucune généralité. Chaque affirmation doit être sourcée par un fichier ou une ligne.",
    pedagogique: "Ton PÉDAGOGIQUE : explique comme à un développeur junior. Définis les concepts, donne des analogies, des exemples concrets. Sois clair et progressif.",
    minimal: "Ton MINIMAL : faits, tableaux, listes. Minimum de texte narratif. Réponds en points."
  };
  return `${heading}\n${tones[style] || tones.ouf}\n\n`;
}

function buildIntelligencePrompt(context, projectName, focus = "", style = "punchy", lang = "fr") {
  const isEn = lang === "en";
  const f = focus ? (isEn ? `\nRequested focus: ${focus}` : `\nFocus demandé : ${focus}`) : "";
  const styleText = styleInstruction(style, lang);
  const banner = bannerInstruction(projectName, isEn ? "Intelligence Brief" : "Brief d'Intelligence Pro", isEn ? "TECHNICAL AUDIT, ARCHITECTURE & STRATEGY" : "AUDIT TECHNIQUE, ARCHITECTURE & STRATÉGIE");
  const fr = `${context}\n\n${langInstruction(lang)}\n\n${styleText}Tu es un **Senior Staff Engineer / CTO en free-lance** qui réalise un **Brief d'Intelligence Pro** sur le projet "${projectName}". Mission : lire le code comme un pro, écouter ce qu'il dit, et produire un rapport d'audit exceptionnel, ultra-stylé et actionnable. Exploite les == MÉTRIQUES PROJET == et == EXTRAITS DE CODE CLÉS == du contexte : cite les chiffres exacts et intègre des extraits de code quand c'est pertinent. Toutes les opportunités et recommandations doivent être cohérentes avec les contraintes produit IDENTIFIEES dans le contexte (README, MEMORY.md, package.json). Ne pas imposer de contraintes qui ne sont pas explicitement documentées.${f}\n\n## Ton et style (décomplexé, pro, haut de gamme)${banner}\n- Utilise des émojis pertinents pour chaque section\n- Des tableaux quand c'est pertinent (stack, dette, modules, concurrents, risques)\n- Des diagrammes Mermaid pour architecture, data flow et graphe de modules\n- Des admonitions / citations / encadrés pour les insights clés\n- Des badges textuels : [CRITIQUE], [HIGH-VALUE], [TECH-DEBT], [SECURITY], [RECOMMENDATION], [BEST-TECH], [PRO-TIP]\n- Des phrases percutantes, pas de remplissage\n\n## Sections obligatoires (sois exhaustif mais concis — NE SAUTE AUCUNE SECTION, numérote exactement de 1 à 11)\n1. **Executive Summary** : promesse produit + verdict technique en 4 lignes.\n2. **Stack & Architecture** : framework, runtime, storage, state, build, tests.\n3. **Tech Radar (Best Tech & Alternatives)** : pour chaque technologie clé, explique POURQUOI c'est le meilleur choix ici (argument massue lié au code), donne une alternative classique et un cas où elle ne serait pas aussi bonne. Sois un avocat de la stack.\n4. **Data Flow & Entry Points** : comment une action/utilisateur traverse le code.\n5. **Module Graph & Connexions** : qui appelle quoi, couches, hubs, feuilles.\n6. **Security & Privacy Posture** : chiffrement, stockage, permissions, vulnérabilités potentielles.\n7. **Errors, Debt & Smells** : TODO/FIXME/HACK, console.log, throws, @ts-ignore, any, catch vides, etc. Cite les fichiers et lignes.\n8. **Competitor Landscape** : 3-4 concurrents directs ou indirects de ce type d'app, points forts/différenciants de ${projectName} par rapport à eux.\n9. **Forces & Risks** : qualité, patterns propres, dette, fragilités.\n10. **Opportunités** : 3-5 actions concrètes priorisées (refacto, feature, test, perf, sécurité, product). Avant cette section, liste les "Contraintes produit identifiées" en début de contexte. Chaque action doit être suivie d'une phrase commençant par "> Justification :" qui explique pourquoi elle est cohérente avec les règles du projet. Si aucune contrainte, explique pourquoi elle est adaptée à la stack/architecture. Exemple : > Justification : Cette action respecte la règle "no cloud" en conservant toutes les données en local.\n11. **Fait avec passion par shinzarou-eng** : une idée créative originale (feature, slogan, concept visuel ou nom de module) inspirée par le code, avec un argument marketing gagnant — dans le respect des contraintes du projet IDENTIFIEES dans le contexte. Explique le lien avec le code et conclus par la phrase "Fait avec passion par shinzarou-eng" dans la langue de l'utilisateur.\n\nReste factuel, cible les fichiers et symboles par leur chemin relatif. Ne généralise pas hors du contexte fourni. Si aucune contrainte produit n'est documentée, écris simplement "Contraintes produit : aucune" et continue toutes les sections normalement. NE SAUTE AUCUNE SECTION ET NE PERDS AUCUNE QUESTION. Réponds dans la langue de l'utilisateur.\n\n## CHECKLIST FINALE (obligatoire, vérifie avant d'envoyer)\n- [ ] Sections numérotées de 1 à 11.\n- [ ] Au moins 3 métriques du contexte citées.\n- [ ] Au moins 2 extraits de code avec chemin + ligne.\n- [ ] Chaque opportunité a un "> Justification :".\n- [ ] Aucune section vide.\n- [ ] Pas de phrase du type "le code est bien structuré" sans preuve.`;
  const en = `${context}\n\n${langInstruction(lang)}\n\n${styleText}You are a **Senior Staff Engineer / freelance CTO** producing a **Pro Intelligence Brief** for the project "${projectName}". Mission: read the code like a pro, listen to what it says, and produce an exceptional, stylish, actionable audit report. Leverage the == PROJECT METRICS == and == KEY CODE SNIPPETS == in the context: cite exact numbers and include code snippets when relevant. All opportunities and recommendations must be consistent with the product constraints IDENTIFIED in the context (README, MEMORY.md, package.json). Do not impose constraints that are not explicitly documented.${f}\n\n## Tone & Style (confident, pro, premium)${banner}\n- Use relevant emojis for each section\n- Use tables where appropriate (stack, debt, modules, competitors, risks)\n- Mermaid diagrams for architecture, data flow and module graph\n- Admonitions / callouts / quote boxes for key insights\n- Text badges: [CRITICAL], [HIGH-VALUE], [TECH-DEBT], [SECURITY], [RECOMMENDATION], [BEST-TECH], [PRO-TIP]\n- Punchy sentences, no filler\n\n## Required Sections (be thorough but concise — DO NOT SKIP ANY SECTION, number them exactly 1 to 11)\n1. **Executive Summary**: product promise + technical verdict in 4 lines.\n2. **Stack & Architecture**: framework, runtime, storage, state, build, tests.\n3. **Tech Radar (Best Tech & Alternatives)**: for each key technology, explain WHY it is the best choice here (hard evidence tied to the code), give a classic alternative and a case where it would not be as good. Be an advocate of the stack.\n4. **Data Flow & Entry Points**: how an action/user traverses the code.\n5. **Module Graph & Connections**: who calls what, layers, hubs, leaves.\n6. **Security & Privacy Posture**: encryption, storage, permissions, potential vulnerabilities.\n7. **Errors, Debt & Smells**: TODO/FIXME/HACK, console.log, throws, @ts-ignore, any, empty catches, etc. Cite files and lines.\n8. **Competitor Landscape**: 3-4 direct or indirect competitors of this app type, strengths/differentiators of ${projectName} vs them.\n9. **Forces & Risks**: quality, unique patterns, debt, fragilities.\n10. **Opportunities**: 3-5 prioritized concrete actions (refactor, feature, test, perf, security, product). Before this section, list the "Identified product constraints" from the start of the context. Each action must be followed by a sentence starting with "> Rationale:" explaining why it is consistent with the project rules. If no constraints, explain why it fits the stack/architecture. Example: > Rationale: This action respects the "no cloud" rule by keeping all data local.\n11. **Made with passion by shinzarou-eng**: an original creative idea (feature, slogan, visual concept or module name) inspired by the code, with a winning marketing argument — respecting the product constraints IDENTIFIED in the context. Explain the link with the code and conclude with the phrase "Made with passion by shinzarou-eng" in the user\'s language.\n\nStay factual, target files and symbols by their relative path. Do not generalize beyond the provided context. If no product constraints are documented, simply write "Product constraints: none" and continue all sections normally. DO NOT SKIP ANY SECTION AND DO NOT LOSE ANY QUESTION. Respond in the user\'s language.\n\n## FINAL CHECKLIST (mandatory, verify before sending)\n- [ ] Sections numbered 1 to 11.\n- [ ] At least 3 metrics from the context cited.\n- [ ] At least 2 code snippets with path + line.\n- [ ] Each opportunity has a "> Rationale:".\n- [ ] No empty section.\n- [ ] No sentence like "the code is well structured" without proof.`;
  return withCitations(isEn ? en : fr, lang);
}

async function collectNonConformities(projectPath, focus = "", lang = "fr") {
  reportProgress(lang === "en" ? "Starting non-compliance audit..." : "Lancement de l'audit non-conformités...");
  const absProject = await resolveProjectPath(projectPath);
  const startDir = await findProjectRoot(absProject);
  const projectName = await getProjectName(absProject);
  reportProgress(lang === "en" ? "Scanning technical debt signals..." : "Scan des signaux de dette technique...");

  const patterns = [
    { name: "TODO", severity: "low", regex: /\bTODO\b/gi },
    { name: "FIXME", severity: "medium", regex: /\bFIXME\b/gi },
    { name: "HACK", severity: "medium", regex: /\bHACK\b/gi },
    { name: "XXX", severity: "medium", regex: /\bXXX\b/g },
    { name: "BUG", severity: "high", regex: /\bBUG\b/gi },
    { name: "DEPRECATED", severity: "medium", regex: /\bDEPRECATED\b/gi },
    { name: "console.log", severity: "low", regex: /console\.(log|warn|error|info|debug)\s*\(/g },
    { name: "throw", severity: "info", regex: /throw\s+new\s+Error/g },
    { name: "bare-catch", severity: "medium", regex: /catch\s*\(\s*\w+\s*\)\s*\{\s*\}/g },
    { name: "ts-ignore", severity: "high", regex: /@ts-ignore|@ts-expect-error/g },
    { name: "eslint-disable", severity: "medium", regex: /eslint-disable(?!-next-line|\s+@)/g },
    { name: "any", severity: "medium", regex: /:\s*any\s*[;,=\)\|\[\]]/g },
    { name: "as-any", severity: "medium", regex: /as\s+any\b/g },
    { name: "non-null-assert", severity: "medium", regex: /\w+!\./g },
    { name: "debugger", severity: "high", regex: /\bdebugger\b/g },
    { name: "eval", severity: "high", regex: /\beval\s*\(/g },
    { name: "innerHTML", severity: "high", regex: /\.innerHTML\s*=|dangerouslySetInnerHTML/g },
    { name: "raw-localStorage", severity: "medium", regex: /localStorage\.(getItem|setItem|removeItem)/g },
    { name: "no-await", severity: "medium", regex: /\b(async\s+function|const|let|var)\s+\w+\s*=\s*\w+\([^)]*\)\s*$/gm },
    { name: "secret-in-code", severity: "high", regex: /\b(api[_-]?key|apikey|auth[_-]?token|password|passwd|pwd|secret|private[_-]?key|client[_-]?secret|access[_-]?token)\s*[:=]\s*["'][^"'\s]{8,}["']/gi },
    { name: "secret-in-url", severity: "high", regex: /https?:\/\/[^"\s]+(password|token|key|secret)=[^"&\s]{8,}/gi },
    { name: "env-secret", severity: "high", regex: /^\s*(API_KEY|SECRET|TOKEN|PRIVATE_KEY|PASSWORD)\s*=\s*[^#\s].*$/gim },
    { name: "console-secret", severity: "medium", regex: /console\.(log|warn|error)\s*\(\s*[^)]*(token|key|secret|password)/gi }
  ];

  const findings = [];
  for (const fullPath of await listProjectFiles(startDir)) {
    if (findings.length >= 120) break;
    const ext = extname(fullPath).toLowerCase();
    if (!SOURCE_EXTS.has(ext)) continue;
    const text = await safeReadText(fullPath);
    if (!text) continue;
    const rel = relative(startDir, fullPath).split(sep).join("/");
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length && findings.length < 120; i++) {
      const line = lines[i];
      for (const p of patterns) {
        if (p.regex.test(line)) {
          const start = Math.max(0, i - 1);
          const end = Math.min(lines.length, i + 2);
          const snippet = lines.slice(start, end).map((l, idx) => `${start + idx + 1}: ${l}`).join("\n");
          findings.push({
            rel,
            line: i + 1,
            type: p.name,
            severity: p.severity,
            snippet: snippet.slice(0, 400)
          });
          p.regex.lastIndex = 0;
          break;
        }
        p.regex.lastIndex = 0;
      }
    }
  }

  const counts = {};
  for (const f of findings) counts[f.type] = (counts[f.type] || 0) + 1;
  reportProgress(lang === "en" ? "Extracting product constraints..." : "Extraction des contraintes produit...");
  const productConstraints = await extractProductConstraints(absProject);
  const isEn = lang === "en";
  const t = isEn ? {
    constraints: "IDENTIFIED PRODUCT CONSTRAINTS",
    noConstraints: "No explicit constraints documented.",
    signals: "DETECTED SIGNALS",
    counts: "COUNTS",
    signalsFound: "signals found."
  } : {
    constraints: "CONTRAINTES PRODUIT IDENTIFIEES",
    noConstraints: "Aucune contrainte explicite documentee.",
    signals: "SIGNAUX DÉTECTÉS",
    counts: "COUNTS",
    signalsFound: "signaux trouvés."
  };
  const constraintsText = productConstraints.length
    ? `\n== ${t.constraints} ==\n${productConstraints.map((c) => `- ${c}`).join("\n")}\n`
    : `\n== ${t.constraints} ==\n${t.noConstraints}\n`;

  return {
    absProject,
    projectName,
    focus,
    context: `=== ${isEn ? "NON-COMPLIANCE AUDIT" : "AUDIT NON-CONFORMITÉS"} — ${(projectName ?? "").toUpperCase()} ===\nProject: ${absProject}${focus ? `\nFocus: ${focus}` : ""}\n${constraintsText}\n== ${t.signals} ==\n${findings.length} ${t.signalsFound}\n\n${findings.map((f) => `---\n[${(f.severity ?? "info").toUpperCase()}] ${f.rel}:${f.line} — ${f.type}\n${f.snippet}\n`).join("")}\n== ${t.counts} ==\n${Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join("\n")}\n`,
    findings
  };
}

function deriveAfterFix(type, line, lang = "fr") {
  const isEn = lang === "en";
  const trimmedEnd = line.replace(/\s+$/, "");
  const leading = line.match(/^\s*/)?.[0] || "";
  const base = trimmedEnd.slice(leading.length);
  const comment = isEn
    ? ` // TODO: ${type === "any" ? "type properly" : type === "throw" ? "handle gracefully via appToast + return" : type === "localStorage" ? "encapsulate via secureStorage" : type === "non-null-assert" ? "remove non-null assertion" : type === "as-any" ? "type without any" : type === "debugger" ? "remove before release" : type === "console.log" ? "replace with local logger" : `fix this [${type}] signal`}`
    : ` // TODO: ${type === "any" ? "typer correctement" : type === "throw" ? "gerer gracieusement via appToast + return" : type === "localStorage" ? "encapsuler via secureStorage" : type === "non-null-assert" ? "supprimer assertion non-nulle" : type === "as-any" ? "typer sans any" : type === "debugger" ? "supprimer avant release" : type === "console.log" ? "remplacer par logger local" : `corriger ce signal [${type}]`}`;
  return leading + base + comment;
}

async function generateTasksFromFindings(projectRoot, startDir, findings, maxTasks = 12, lang = "fr") {
  const isEn = lang === "en";
  const titleMap = isEn ? {
    any: "Strictly type `any` usages",
    "console.log": "Clean up debug logs",
    "console.warn": "Clean up console warnings",
    "console.error": "Clean up console errors",
    "console.info": "Clean up console info",
    "console.debug": "Clean up console debug",
    debugger: "Remove `debugger` statements",
    throw: "Handle `throw new Error` in UI",
    "ts-ignore": "Fix `@ts-ignore` markers",
    "ts-expect-error": "Fix `@ts-expect-error` markers",
    "eslint-disable": "Fix ESLint suppressions",
    TODO: "Resolve TODO markers",
    FIXME: "Resolve FIXME markers",
    HACK: "Resolve HACK markers",
    XXX: "Resolve XXX markers",
    localStorage: "Migrate localStorage access to SecureStorage",
    "bare-catch": "Fill empty catch blocks"
  } : {
    any: "Typer strictement les usages de `any`",
    "console.log": "Nettoyer les logs de debug",
    "console.warn": "Nettoyer les avertissements console",
    "console.error": "Nettoyer les erreurs console",
    "console.info": "Nettoyer les infos console",
    "console.debug": "Nettoyer les debug console",
    debugger: "Supprimer les instructions `debugger`",
    throw: "Gérer les `throw new Error` en UI",
    "ts-ignore": "Corriger les `@ts-ignore`",
    "ts-expect-error": "Corriger les `@ts-expect-error`",
    "eslint-disable": "Corriger les suppressions ESLint",
    TODO: "Résoudre les marqueurs TODO",
    FIXME: "Résoudre les marqueurs FIXME",
    HACK: "Résoudre les marqueurs HACK",
    XXX: "Résoudre les marqueurs XXX",
    localStorage: "Migrer les accès localStorage vers SecureStorage",
    "bare-catch": "Remplir les blocs catch vides"
  };
  const tasks = [];
  for (const f of findings.slice(0, maxTasks)) {
    const fallback = isEn ? `Fix ${f.type} signal` : `Corriger le signal ${f.type}`;
    const fp = join(startDir, f.rel);
    const relPath = relative(projectRoot, fp).split(sep).join("/");
    const text = await safeReadText(fp);
    if (!text) continue;
    const lines = text.split(/\r?\n/);
    const start = Math.max(0, f.line - 3);
    const end = Math.min(lines.length, f.line + 2);
    const before = lines.slice(start, end).map((l, i) => `${start + i + 1}: ${l}`).join("\n");
    const afterLines = lines.slice(start, end).map((l, i) => {
      const lineNum = start + i + 1;
      if (lineNum === f.line) return `${lineNum}: ${deriveAfterFix(f.type, l, lang)}`;
      return `${lineNum}: ${l}`;
    });
    const after = afterLines.join("\n");
    const title = titleMap[f.type] || fallback;
    const priorityMap = { high: "🔴 P0", medium: "🟠 P1", low: "🟡 P2", info: "🔵 P3" };
    const prio = priorityMap[f.severity] || "🟡 P2";
    tasks.push({
      id: `TASK-${(tasks.length + 1).toString().padStart(3, "0")}`,
      title,
      file: relPath,
      line: f.line,
      priority: prio,
      before,
      after,
      justification: isEn ? `This action fixes the [${f.type}] signal in ${relPath}:${f.line}.` : `Cette action corrige le signal [${f.type}] dans ${relPath}:${f.line}.`
    });
  }
  return tasks;
}

function formatPreTasks(tasks, lang = "fr") {
  const isEn = lang === "en";
  if (tasks.length === 0) {
    return isEn
      ? "== TASKS GENERATED FROM SIGNALS ==\nNo tasks from signals."
      : "== TÂCHES GÉNÉRÉES DEPUIS LES SIGNAUX ==\nAucune tâche issue des signaux.";
  }
  const title = isEn ? "== TASKS GENERATED FROM SIGNALS" : "== TÂCHES GÉNÉRÉES DEPUIS LES SIGNAUX";
  const priorityLabel = isEn ? "Priority" : "Priorité";
  const fileLabel = isEn ? "File" : "Fichier";
  const beforeLabel = isEn ? "Before" : "Avant";
  const afterLabel = isEn ? "After" : "Après";
  const rationaleLabel = isEn ? "Rationale" : "Justification";
  return `${title} (${tasks.length}) ==\n${tasks.map((t) => `- [ ] **[${t.id}] ${t.title}**\n  - ${priorityLabel} : ${t.priority}\n  - ${fileLabel} : \`${t.file}:${t.line}\`\n  - ${beforeLabel} :\n~~~ts\n${t.before}\n~~~\n  - ${afterLabel} :\n~~~ts\n${t.after}\n~~~\n  > ${rationaleLabel} : ${t.justification}`).join("\n\n")}\n`;
}

function formatRawTasksMarkdown(projectName, metrics, constraints, tasks, lang = "fr") {
  const isEn = lang === "en";
  const constraintsHeader = isEn ? "Identified product constraints" : "Contraintes produit identifiées";
  const constraintsNone = isEn ? "- No documented constraints." : "- Aucune contrainte documentée.";
  const constraintsText = constraints.length ? constraints.map((c) => `- ${c}`).join("\n") : constraintsNone;
  const keyMetrics = isEn ? "Key metrics" : "Métriques clés";
  const indicator = isEn ? "Indicator" : "Indicateur";
  const value = isEn ? "Value" : "Valeur";
  const sourceFiles = isEn ? "Source files" : "Fichiers source";
  const codeLines = isEn ? "Code lines" : "Lignes de code";
  const testFiles = isEn ? "Test files" : "Fichiers de test";
  const reactComponents = isEn ? "React components" : "Composants React";
  const utils = isEn ? "Utilities" : "Utilitaires";
  const sprints = isEn ? "Sprints" : "Sprints";
  const sprintNames = isEn ? {
    "🔴 P0": "Sprint 1 — Foundations (Security / Stability)",
    "🟠 P1": "Sprint 2 — Improvement (Refactor / Quality)",
    "🟡 P2": "Sprint 3 — Optimization (Performance / Tests)",
    "🔵 P3": "Sprint 4 — Differentiation (UX / Product)"
  } : {
    "🔴 P0": "Sprint 1 — Fondations (Sécurité / Stabilité)",
    "🟠 P1": "Sprint 2 — Amélioration (Refacto / Qualité)",
    "🟡 P2": "Sprint 3 — Optimisation (Perf / Tests)",
    "🔵 P3": "Sprint 4 — Différenciation (UX / Produit)"
  };
  const fileLabel = isEn ? "File" : "Fichier";
  const beforeLabel = isEn ? "Before" : "Avant";
  const afterLabel = isEn ? "After" : "Après";
  const rationaleLabel = isEn ? "Rationale" : "Justification";
  const generatedFrom = isEn ? "Action plan generated automatically from detected debt signals." : "Plan d'action généré automatiquement depuis les signaux de dette détectés.";
  const header = `# TASKS.md — ${projectName}\n\n> ${generatedFrom}\n\n## ${constraintsHeader}\n${constraintsText}\n\n## ${keyMetrics}\n| ${indicator} | ${value} |\n| :--- | :--- |\n| ${sourceFiles} | ${metrics.sourceFiles} |\n| ${codeLines} | ${metrics.codeLines} |\n| ${testFiles} | ${metrics.testFiles} |\n| ${reactComponents} | ${metrics.componentFiles} |\n| ${utils} | ${metrics.utilFiles} |\n\n## ${sprints}\n`;
  const groups = { "🔴 P0": [], "🟠 P1": [], "🟡 P2": [], "🔵 P3": [] };
  for (const t of tasks) {
    (groups[t.priority] || groups["🟡 P2"]).push(t);
  }
  const body = Object.entries(groups).filter(([, arr]) => arr.length > 0).map(([prio, arr]) => `### ${sprintNames[prio]}\n\n${arr.map((t) => `- [ ] **[${t.id}] ${t.title}**\n  - ${fileLabel} : \`${t.file}:${t.line}\`\n  - ${beforeLabel} :\n~~~ts\n${t.before}\n~~~\n  - ${afterLabel} :\n~~~ts\n${t.after}\n~~~\n  > ${rationaleLabel} : ${t.justification}`).join("\n\n")}\n`).join("\n");
  const footer = isEn
    ? `\n---\n*Made with passion by shinzarou-eng — dsh-codebase-chat v${VERSION}*\n`
    : `\n---\n*Fait avec passion par shinzarou-eng — dsh-codebase-chat v${VERSION}*\n`;
  return header + body + footer;
}

function parseRawTasksMarkdown(markdown) {
  const tasks = [];
  const taskRegex = /- \[[ xX]?\s?\] ?\*\*\[(TASK-\d{3})\] ([^*]+)\*\*\s*\n\s*- (?:Fichier|File)\s*:\s*`([^`]+)`\s*\n\s*- (?:Avant|Before)\s*:\s*\n[~`]{3,}\w*\s*\n([\s\S]*?)\n[~`]{3,}\s*\n\s*- (?:Après|Apres|After)\s*:\s*\n[~`]{3,}\w*\s*\n([\s\S]*?)\n[~`]{3,}/g;
  let m;
  while ((m = taskRegex.exec(markdown)) !== null) {
    const [, id, title, file, before, after] = m;
    const fileMatch = file.match(/^(.+):(\d+)$/);
    const relPath = fileMatch ? fileMatch[1] : file;
    const lineNum = fileMatch ? parseInt(fileMatch[2], 10) : 0;
    tasks.push({ id, title: title.trim(), relPath, file, lineNum, before, after });
  }
  return tasks;
}

function splitCodeBlock(block) {
  const lines = block.split(/\r?\n/);
  return lines.map((line) => {
    const match = line.match(/^(\d+): (.*)$/);
    if (match) return { line: parseInt(match[1], 10), code: match[2] };
    return null;
  }).filter(Boolean);
}

function computePatch(beforeBlock, afterBlock) {
  const beforeLines = splitCodeBlock(beforeBlock);
  const afterLines = splitCodeBlock(afterBlock);
  const patches = [];
  const max = Math.max(beforeLines.length, afterLines.length);
  for (let i = 0; i < max; i++) {
    const b = beforeLines[i];
    const a = afterLines[i];
    if (!b || !a) continue;
    if (b.line !== a.line) continue;
    if (b.code === a.code) continue;
    patches.push({ line: b.line, oldCode: b.code, newCode: a.code });
  }
  return patches;
}

async function backupFiles(projectRoot, files, backupDir) {
  for (const f of files) {
    const src = join(projectRoot, f);
    const dest = join(backupDir, f);
    const text = await safeReadText(src);
    if (text == null) throw new Error(`Fichier introuvable: ${f}`);
    const parent = dirname(dest);
    await mkdir(parent, { recursive: true });
    await writeFile(dest, text, "utf8");
  }
}

async function applyTaskPatches(projectRoot, tasks, dryRun = false) {
  const results = [];
  const touchedFiles = new Set();
  const fileChanges = new Map();

  // compute patches and group by file
  for (const task of tasks) {
    const patches = computePatch(task.before, task.after);
    if (patches.length === 0) {
      results.push({ id: task.id, file: task.file, status: "no-op", message: "Aucune difference entre Avant et Apres." });
      continue;
    }
    if (!fileChanges.has(task.relPath)) fileChanges.set(task.relPath, []);
    fileChanges.get(task.relPath).push({ task, patches });
  }

  // read files
  const fileContents = new Map();
  for (const [relPath] of fileChanges) {
    const text = await safeReadText(join(projectRoot, relPath));
    if (text == null) throw new Error(`Fichier introuvable: ${relPath}`);
    fileContents.set(relPath, text);
  }

  // apply changes
  for (const [relPath, changes] of fileChanges) {
    const lines = fileContents.get(relPath).split(/\r?\n/);
    const applied = [];
    for (const { task, patches } of changes) {
      for (const patch of patches) {
        const idx = patch.line - 1;
        if (idx < 0 || idx >= lines.length) {
          applied.push({ id: task.id, line: patch.line, status: "out-of-range" });
          continue;
        }
        const current = lines[idx].trim();
        const expected = patch.oldCode.trim();
        if (current !== expected && !current.includes(expected) && !expected.includes(current)) {
          applied.push({ id: task.id, line: patch.line, status: "mismatch", expected: patch.oldCode, got: lines[idx] });
          continue;
        }
        if (!dryRun) {
          lines[idx] = patch.newCode;
        }
        applied.push({ id: task.id, line: patch.line, status: dryRun ? "dry-run" : "applied" });
      }
    }
    if (!dryRun) {
      await writeFile(join(projectRoot, relPath), lines.join("\n"), "utf8");
    }
    touchedFiles.add(relPath);
    results.push(...applied);
  }

  return { results, touchedFiles: Array.from(touchedFiles) };
}

async function runPostApplyVerification(projectRoot) {
  const pkg = await getPackageSummary(projectRoot);
  const checks = [];
  if (pkg.devDependencies.includes("typescript") || pkg.dependencies.includes("typescript")) {
    checks.push({ name: "tsc", cmd: "npx tsc --noEmit" });
  }
  if (pkg.devDependencies.includes("vitest") || pkg.dependencies.includes("vitest") || pkg.scripts.test) {
    checks.push({ name: "vitest", cmd: "npx vitest run" });
  }
  const summary = [];
  for (const c of checks) {
    const r = await runProjectCommand(projectRoot, c.cmd, 300_000);
    summary.push({ name: c.name, ok: r.ok, output: r.combined.slice(-500) });
  }
  return summary;
}

async function* walkFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walkFiles(p);
    else if (e.isFile()) yield p;
  }
}

async function restoreBackups(projectRoot, backupDir) {
  for await (const src of walkFiles(backupDir)) {
    const rel = relative(backupDir, src);
    const dest = join(projectRoot, rel);
    await writeFile(dest, await safeReadText(src), "utf8");
  }
}

async function runApplyTasks(projectRoot, markdown, dryRun = false) {
  if (isProtectedPath(projectRoot)) throw new Error("Ce chemin est protege. Application refusee.");
  const tasks = parseRawTasksMarkdown(markdown);
  if (tasks.length === 0) return { ok: false, message: "Aucune tache avec Avant/Apres trouvee dans le markdown." };

  const backupDir = join(projectRoot, `.dsh-backup-${Date.now()}`);
  const files = new Set(tasks.map((t) => t.relPath));
  const touched = [];

  if (!dryRun) {
    await backupFiles(projectRoot, Array.from(files), backupDir);
  }

  const apply = await applyTaskPatches(projectRoot, tasks, dryRun);

  if (dryRun) {
    return { ok: true, dryRun: true, message: `Dry-run termine. ${apply.results.length} patch(s) a appliquer.`, results: apply.results, touchedFiles: apply.touchedFiles };
  }

  const verification = await runPostApplyVerification(projectRoot);
  const allOk = verification.every((v) => v.ok);

  if (!allOk) {
    await restoreBackups(projectRoot, backupDir);
    return { ok: false, message: "Verification post-apply echouee. Restauration effectuee.", verification, results: apply.results, backupDir };
  }

  return { ok: true, message: "Patchs appliques et verification reussie.", verification, results: apply.results, touchedFiles: apply.touchedFiles };
}

async function runProjectCommand(projectRoot, command, timeoutMs = 120_000) {
  const cwd = projectRoot;
  try {
    const { stdout, stderr } = await execAsync(command, { cwd, timeout: timeoutMs, env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" } });
    return { ok: true, stdout: stdout.slice(0, 8000), stderr: stderr.slice(0, 4000), combined: (stdout + "\n" + stderr).slice(0, 10000) };
  } catch (err) {
    const stdout = (err.stdout || "").slice(0, 8000);
    const stderr = (err.stderr || "").slice(0, 4000);
    return { ok: false, code: err.code, stdout, stderr, combined: (stdout + "\n" + stderr).slice(0, 10000) };
  }
}

async function collectVerificationResults(projectRoot) {
  const pkg = await getPackageSummary(projectRoot);
  const commands = [];
  if (pkg.devDependencies.includes("typescript") || pkg.dependencies.includes("typescript")) {
    commands.push({ name: "Type Check (tsc --noEmit)", cmd: "npx tsc --noEmit" });
  }
  if (pkg.scripts.test) {
    commands.push({ name: "Tests (npm run test)", cmd: "npm run test" });
  } else if (pkg.devDependencies.includes("vitest") || pkg.dependencies.includes("vitest")) {
    commands.push({ name: "Tests (npx vitest run)", cmd: "npx vitest run" });
  }
  if (pkg.scripts.build) {
    commands.push({ name: "Build (npm run build)", cmd: "npm run build" });
  }

  const results = [];
  for (const item of commands) {
    const res = await runProjectCommand(projectRoot, item.cmd, 300_000);
    const summary = res.combined.split("\n").slice(-20).join("\n");
    results.push({ ...item, ...res, summary });
  }
  return results;
}

async function collectBuildBenchmark(projectRoot) {
  const pkg = await getPackageSummary(projectRoot);
  let buildCmd = pkg.scripts.build ? "npm run build" : "";
  if (!buildCmd) return { ran: false, reason: "Aucun script 'build' trouvé." };

  const start = Date.now();
  const res = await runProjectCommand(projectRoot, buildCmd, 300_000);
  const duration = Date.now() - start;

  const distDirs = ["dist", "build", "out"];
  let distInfo = { path: null, size: 0, files: [] };
  for (const d of distDirs) {
    const dir = join(projectRoot, d);
    try {
      const entries = await readdir(dir, { withFileTypes: true, recursive: true });
      let size = 0;
      const files = [];
      for (const e of entries) {
        if (!e.isFile()) continue;
        const p = join(e.path || dir, e.name);
        const s = await stat(p);
        size += s.size;
        files.push({ rel: relative(dir, p).split(sep).join("/"), size: s.size });
      }
      if (size > distInfo.size) distInfo = { path: d, size, files: files.slice(0, 30) };
    } catch { continue; }
  }

  return { ran: true, duration, ok: res.ok, summary: res.combined.split("\n").slice(-20).join("\n"), distInfo };
}

async function collectGitSummary(projectRoot) {
  const results = {};
  try {
    const log = await runProjectCommand(projectRoot, "git log --oneline -n 20", 30_000);
    results.log = log.ok ? log.stdout : log.combined;
  } catch { results.log = "Pas d'historique git."; }
  try {
    const diff = await runProjectCommand(projectRoot, "git diff --stat HEAD~1..HEAD", 30_000);
    if (!diff.ok && diff.code === 128) {
      const diffUncommitted = await runProjectCommand(projectRoot, "git diff --stat", 30_000);
      results.diff = diffUncommitted.ok ? diffUncommitted.stdout : diffUncommitted.combined;
    } else {
      results.diff = diff.ok ? diff.stdout : diff.combined;
    }
  } catch { results.diff = "Aucun diff disponible."; }
  try {
    const status = await runProjectCommand(projectRoot, "git status --short", 30_000);
    results.status = status.ok ? status.stdout : status.combined;
  } catch { results.status = ""; }
  return results;
}

async function applyFilePatch(projectRoot, filePath, newContent) {
  if (!isWithinProject(projectRoot, filePath)) throw new Error("Chemin cible invalide ou hors du projet.");
  const resolved = resolve(join(projectRoot, filePath));
  // Safety backup before overwriting an existing file.
  const previous = await safeReadText(resolved);
  if (previous != null) {
    const backupDir = join(projectRoot, ".dsh-backups");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = join(backupDir, `${stamp}-${basename(resolved)}`);
    await mkdir(dirname(backupPath), { recursive: true });
    await writeFile(backupPath, previous, "utf8");
  }
  await writeFile(resolved, newContent, "utf8");
  return { ok: true, file: relative(projectRoot, resolved).split(sep).join("/") };
}

function isWithinProject(projectRoot, filePath) {
  const resolved = resolve(join(projectRoot, filePath));
  const root = resolve(projectRoot);
  const protectedAll = PROTECTED_PATHS.map((p) => resolve(p).toLowerCase()).concat(configProtectedPaths(root));
  return resolved.startsWith(root) && !protectedAll.some((p) => resolved.toLowerCase().startsWith(p));
}

function buildAuditPrompt(context, projectName, focus = "", lang = "fr") {
  const isEn = lang === "en";
  const f = focus ? (isEn ? `\nRequested focus: ${focus}` : `\nFocus demandé : ${focus}`) : "";
  const banner = bannerInstruction(projectName, isEn ? "Non-Compliance Audit" : "Audit Non-Conformités", isEn ? "TECHNICAL DEBT AND RISK SCAN" : "SCAN DE LA DETTE TECHNIQUE ET DES RISQUES");
  const fr = `${context}\n\n${langInstruction(lang)}\n\nTu es un **QA Lead / Staff Engineer** en charge d'un **audit de non-conformités et de dette technique** sur le projet "${projectName}". Mission : analyser les signaux fournis, classifier chaque problème, expliquer le risque, et proposer un correctif concret (code ou action).${f}\n\n## Ton et style\n- Utilise des tableaux pour le récapitulatif\n- Des emojis sévérité : 🔴 Critique / 🟠 Moyen / 🟡 Faible / 🔵 Info\n- Des badges : [CRITIQUE], [DETTE], [BUG], [FIX], [RECOMMANDATION]\n- Des blocs de code pour les correctifs\n- Un encadré visuel de conclusion\n\n## Sections obligatoires (numérote exactement)\n1. **Vue d'ensemble** : nombre total de signaux, répartition par sévérité, verdict global (code sain, dette légère, dette modérée, risque élevé).\n2. **Tableau des non-conformités** : pour chaque signal, colonnes Fichier:Ligne, Sévérité, Type, Problème, Fix proposé (action immédiate ou code).\n3. **Top 5 priorités** : les 5 problèmes les plus risqués ou bloquants, avec un snippet de code actuel et un snippet de code corrigé.\n4. **Plan d'action** : 3-5 tâches concrètes pour nettoyer (par ordre de priorité).\n5. **Conclusion** : une phrase percutante dans un encadré visuel.\n\nReste factuel. Ne généralise pas hors du contexte fourni. Si aucune contrainte produit n'est documentée, écris simplement "Contraintes produit : aucune" et continue toutes les sections normalement. NE SAUTE AUCUNE SECTION ET NE PERDS AUCUNE QUESTION. Réponds dans la langue de l'utilisateur.${banner}`;
  const en = `${context}\n\n${langInstruction(lang)}\n\nYou are a **QA Lead / Staff Engineer** in charge of a **non-compliance and technical debt audit** for the project "${projectName}". Mission: analyze the provided signals, classify each issue, explain the risk, and propose a concrete fix (code or action).${f}\n\n## Tone & Style\n- Use tables for the summary\n- Severity emojis: 🔴 Critical / 🟠 Medium / 🟡 Low / 🔵 Info\n- Badges: [CRITICAL], [DEBT], [BUG], [FIX], [RECOMMENDATION]\n- Code blocks for fixes\n- A visual conclusion callout\n\n## Required Sections (number exactly)\n1. **Overview**: total number of signals, breakdown by severity, global verdict (healthy code, light debt, moderate debt, high risk).\n2. **Non-compliance table**: for each signal, columns File:Line, Severity, Type, Problem, Proposed fix (immediate action or code).\n3. **Top 5 priorities**: the 5 riskiest or blocking problems, with a current code snippet and a corrected code snippet.\n4. **Action plan**: 3-5 concrete cleanup tasks (in priority order).\n5. **Conclusion**: a punchy sentence in a visual callout.\n\nStay factual. Do not generalize beyond the provided context. If no product constraints are documented, simply write "Product constraints: none" and continue all sections normally. DO NOT SKIP ANY SECTION AND DO NOT LOSE ANY QUESTION. Respond in the user\'s language.${banner}`;
  return withCitations(isEn ? en : fr, lang);
}

function brandSignature(lang = "fr") {
  const d = new Date().toISOString().slice(0, 10);
  if (lang === "en") {
    return `\n\n---\n\n> ✨ *Report by **dsh-codebase-chat** v${VERSION} — Codebase Analysis — ${d}*\n> 🔗 *Built for DeepSeek Harness. Extensible to any agent or Node.js IDE.*`;
  }
  return `\n\n---\n\n> ✨ *Rapport par **dsh-codebase-chat** v${VERSION} — Analyse de Codebase — ${d}*\n> 🔗 *Conçu pour DeepSeek Harness. Extensible à tout agent ou IDE Node.js.*`;
}

function buildAsciiBanner(projectName, modeLabel, tagline = "") {
  const raw = (projectName ?? "").toUpperCase().replace(/[^A-Z0-9_\- ]/g, "").slice(0, 14);
  const title = raw || "PROJECT";
  const ascii = figlet.textSync(title, { font: "ANSI Shadow" });
  const lines = ascii.split("\n").filter((l) => l.trim() !== "");
  const subtitle1 = `${modeLabel.toUpperCase()} — ${projectName}`.slice(0, 80);
  const subtitle2 = tagline ? tagline.slice(0, 80) : "";
  const width = Math.max(...lines.map((l) => l.length), subtitle1.length, subtitle2.length || 0, 50);
  const pad = (s) => s.length < width ? s + " ".repeat(width - s.length) : s.slice(0, width);
  const h = "═".repeat(width + 2);
  const center = (s) => {
    const s2 = s.slice(0, width);
    const spaces = Math.max(0, width - s2.length);
    const left = Math.floor(spaces / 2);
    return pad(" ".repeat(left) + s2);
  };
  const centerArt = (s) => center(s);

  const blank = pad("");

  const body = [
    blank,
    ...lines.map((l) => centerArt(l)),
    blank,
    center(subtitle1),
    subtitle2 ? center(subtitle2) : null,
    blank
  ]
    .filter(Boolean)
    .map((l) => `║ ${l} ║`)
    .join("\n");

  return `╔${h}╗\n${body}\n╚${h}╝`;
}

function bannerInstruction(projectName, modeLabel, tagline = "") {
  const banner = buildAsciiBanner(projectName, modeLabel, tagline);
  return `\n\n${banner}\n\n`;
}

async function collectAssessmentContext(projectPath, focus = "", lang = "fr") {
  reportProgress(lang === "en" ? "Building strategic report..." : "Constitution du rapport stratégique...");
  const [intel, audit] = await Promise.all([
    collectIntelligenceContext(projectPath, focus || (lang === "en" ? "professional assessment" : "constat professionnel"), lang),
    collectNonConformities(projectPath, focus || "", lang)
  ]);
  reportProgress(lang === "en" ? "Running build/test checks..." : "Lancement des vérifications build/test...");

  const [verification, benchmark, git] = await Promise.all([
    collectVerificationResults(intel.absProject).catch((e) => [{ name: "Verification", ok: false, combined: `Erreur: ${e.message}` }]),
    collectBuildBenchmark(intel.absProject).catch((e) => ({ ran: false, reason: `Erreur: ${e.message}` })),
    collectGitSummary(intel.absProject).catch(() => ({ log: "", diff: "", status: "" }))
  ]);

  const isEn = lang === "en";
  const t = isEn ? {
    verify: "VERIFICATIONS & TESTS",
    build: "BUILD BENCHMARK",
    git: "GIT SUMMARY",
    duration: "Duration",
    ok: "OK",
    fail: "FAIL",
    folder: "Folder",
    size: "Total size",
    files: "Main files",
    lastLogs: "Last logs",
    recent: "Recent commits",
    diffStat: "Diff stat",
    workingTree: "Working tree",
    clean: "clean"
  } : {
    verify: "VÉRIFICATIONS & TESTS",
    build: "BUILD BENCHMARK",
    git: "GIT SUMMARY",
    duration: "Durée",
    ok: "OK",
    fail: "ÉCHEC",
    folder: "Dossier",
    size: "Taille totale",
    files: "Fichiers principaux",
    lastLogs: "Derniers logs",
    recent: "Derniers commits",
    diffStat: "Diff stat",
    workingTree: "Working tree",
    clean: "propre"
  };

  const verifyText = `\n== ${t.verify} ==\n${verification.map((v) => `- ${v.name}: ${v.ok ? t.ok : t.fail}\n${v.summary}`).join("\n---\n")}\n`;
  const benchText = `\n== ${t.build} ==\n${benchmark.ran ? `${t.duration}: ${benchmark.duration}ms\n${t.ok}: ${benchmark.ok}\n${t.folder}: ${benchmark.distInfo.path || "non trouvé"}\n${t.size}: ${benchmark.distInfo.size} octets\n${t.files}:\n${benchmark.distInfo.files.map((f) => `- ${f.rel} (${f.size} o)`).join("\n")}\n${t.lastLogs}:\n${benchmark.summary}` : benchmark.reason}\n`;
  const gitText = `\n== ${t.git} ==\n${t.recent}:\n${git.log}\n\n${t.diffStat}:\n${git.diff}\n\n${t.workingTree}:\n${git.status || t.clean}\n`;

  return {
    absProject: intel.absProject,
    projectName: intel.projectName,
    context: `${intel.context}\n\n${audit.context}\n\n${verifyText}\n\n${benchText}\n\n${gitText}`
  };
}

async function collectCeoContext(projectPath, focus = "", lang = "fr") {
  reportProgress(lang === "en" ? "Preparing CEO brief..." : "Préparation du brief CEO...");
  const absProject = await resolveProjectPath(projectPath);
  const startDir = await findProjectRoot(absProject);
  const projectName = await getProjectName(absProject);
  const pkg = await getPackageSummary(absProject);
  reportProgress(lang === "en" ? "Calculating CEO metrics..." : "Calcul des métriques CEO...");
  const metrics = await collectMetrics(absProject);
  const graph = await buildModuleGraph(absProject);
  const debt = await collectDebtAndSignals(absProject);
  const constraints = await extractProductConstraints(absProject);
  const testSummary = await collectTestSummary(absProject);
  const keySnippets = await collectKeySnippets(absProject, 4000);

  const isEn = lang === "en";
  const t = isEn ? {
    title: "CEO BRIEF",
    constraints: "PRODUCT CONSTRAINTS",
    noConstraints: "No documented constraints.",
    metrics: "METRICS",
    package: "PACKAGE",
    tests: "TESTS",
    moduleGraph: "MODULE GRAPH",
    topDebt: "TOP DEBT",
    keySnippets: "KEY SNIPPETS",
    focus: "FOCUS"
  } : {
    title: "CEO BRIEF",
    constraints: "CONTRAINTES PRODUIT",
    noConstraints: "Aucune contrainte documentee.",
    metrics: "MÉTRIQUES",
    package: "PACKAGE",
    tests: "TESTS",
    moduleGraph: "MODULE GRAPH",
    topDebt: "TOP DEBT",
    keySnippets: "EXTRAITS CLÉS",
    focus: "FOCUS"
  };
  const pkgText = `Name: ${pkg.name || projectName}, Type: ${pkg.type}, Main: ${pkg.main}, Scripts: ${Object.keys(pkg.scripts).join(", ")}`;
  const constraintsText = constraints.length ? constraints.join("\n") : t.noConstraints;
  const graphText = `Top modules:\n${graph.modules.slice(0, 5).map((m) => `- ${m.rel} (imported by ${m.inDegree}, imports ${m.outDegree})`).join("\n")}\nRoots: ${graph.roots.join(", ") || "none"}\nLeaves: ${graph.leaves.join(", ") || "none"}`;
  const debtText = `Top signals:\n${debt.signals.slice(0, 8).map((s) => `[${s.type}] ${s.rel}:${s.line}\n${s.context}`).join("\n---\n")}`;
  const testText = `Test files: ${testSummary.length}`;

  const context = `=== ${t.title} — ${(projectName ?? "").toUpperCase()} ===\nProject: ${absProject}${focus ? `\n${t.focus}: ${focus}` : ""}\n\n== ${t.constraints} ==\n${constraintsText}\n\n== ${t.metrics} ==\n- Files: ${metrics.files}\n- Source files: ${metrics.sourceFiles}\n- Code lines: ${metrics.codeLines}\n- Test files: ${metrics.testFiles}\n- React components: ${metrics.componentFiles}\n- Utilities: ${metrics.utilFiles}\n\n== ${t.package} ==\n${pkgText}\n\n== ${t.tests} ==\n${testText}\n\n== ${t.moduleGraph} ==\n${graphText}\n\n== ${t.topDebt} ==\n${debtText}\n\n== ${t.keySnippets} ==\n${keySnippets}\n`;
  return { absProject, projectName, context };
}

async function collectTasksContext(projectPath, focus = "", lang = "fr") {
  reportProgress(lang === "en" ? "Generating action plan..." : "Génération du plan d'action...");
  const absProject = await resolveProjectPath(projectPath);
  const startDir = await findProjectRoot(absProject);
  const projectName = await getProjectName(absProject);
  const pkg = await getPackageSummary(absProject);
  const audit = await collectNonConformities(absProject, focus || "", lang);
  const metrics = await collectMetrics(absProject);
  const constraints = await extractProductConstraints(absProject);
  const preTasks = await generateTasksFromFindings(absProject, startDir, audit.findings, 12, lang);

  const isEn = lang === "en";
  const t = isEn ? {
    title: "TASKS GENERATOR",
    constraints: "PRODUCT CONSTRAINTS",
    noConstraints: "No documented constraints.",
    metrics: "METRICS",
    package: "PACKAGE",
    generatedTasks: "TASKS GENERATED FROM SIGNALS"
  } : {
    title: "TASKS GENERATOR",
    constraints: "CONTRAINTES PRODUIT",
    noConstraints: "Aucune contrainte documentee.",
    metrics: "MÉTRIQUES",
    package: "PACKAGE",
    generatedTasks: "TÂCHES GÉNÉRÉES DEPUIS LES SIGNAUX"
  };
  const constraintsText = constraints.length ? constraints.join("\n") : t.noConstraints;
  const pkgText = `Name: ${pkg.name || projectName}, Type: ${pkg.type}, Main: ${pkg.main}, Scripts: ${Object.keys(pkg.scripts).join(", ")}`;

  const context = `=== ${t.title} — ${(projectName ?? "").toUpperCase()} ===\nProject: ${absProject}${focus ? `\nFocus: ${focus}` : ""}\n\n== ${t.constraints} ==\n${constraintsText}\n\n== ${t.metrics} ==\n- Files: ${metrics.files}\n- Source files: ${metrics.sourceFiles}\n- Code lines: ${metrics.codeLines}\n- Test files: ${metrics.testFiles}\n- React components: ${metrics.componentFiles}\n- Utilities: ${metrics.utilFiles}\n\n== ${t.package} ==\n${pkgText}\n\n== ${t.generatedTasks} ==\n${formatPreTasks(preTasks, lang)}\n`;
  return { absProject, projectName, context, preTasks, metrics, constraints };
}

function buildReportPrompt(context, projectName, focus = "", style = "punchy", lang = "fr") {
  const isEn = lang === "en";
  const f = focus ? (isEn ? `\nRequested focus: ${focus}` : `\nFocus demandé : ${focus}`) : "";
  const signature = brandSignature(lang);
  const styleText = styleInstruction(style, lang);
  const banner = bannerInstruction(projectName, isEn ? "Strategic Report" : "Rapport Stratégique", isEn ? "PROFESSIONAL BOARD-LEVEL ASSESSMENT / EXECUTIVE CTO" : "CONSTAT PROFESSIONNEL DE NIVEAU BOARD / EXECUTIVE CTO");
  const fr = `${context}\n\n${langInstruction(lang)}\n\n${styleText}Tu es un **CTO d'élite / Partner Technique** qui rédige le **Constat Professionnel ultime** sur le projet "${projectName}". Ce document doit être le plus beau, le plus percutant, le plus actionnable : un rapport de haut niveau prêt pour un board. Mission : fusionner architecture, dette, concurrence, résultats de tests/build, git, marketing ET respecter les contraintes produit IDENTIFIEES dans le contexte. Exploite les == MÉTRIQUES PROJET == et == EXTRAITS DE CODE CLÉS == pour citer des chiffres exacts et insérer des snippets de code. Ne jamais imposer de contraintes qui ne sont pas dans le contexte.${f}\n\n## Identité visuelle (obligatoire)${banner}\n- Utilise des émojis premium pour chaque section\n- Des tableaux professionnels bordés par des lignes Markdown\n- Des diagrammes Mermaid\n- Des encadrés avec > pour les insights et verdicts\n- Des "score cards" : Maturité, Sécurité, Maintenabilité, Performance, UX (notes sur 10 avec justification)\n- Des badges textuels : [CRITIQUE], [HIGH-VALUE], [SECURITY], [STRATEGY], [BEST-TECH], [MARKETING], [RECOMMANDATION].\n- Finis par le bloc signature ci-dessous :\n${signature}\n\n## Sections obligatoires (numérote exactement de 1 à 13)\n1. **Page de Garde** : bannière, date, projet, version, auteur (DSH Codebase Analysis).\n2. **Executive Summary** : promesse produit, verdict technique, 5 score cards sur 10, argument de pourquoi ce projet peut être le meilleur, et alignement avec les contraintes/produits IDENTIFIEES dans le contexte.\n3. **Constat Profond** : diagnostic synthétique en 3-5 phrases fortes.\n4. **SWOT Stratégique** : tableau 2x2 (Forces, Faiblesses, Opportunités, Menaces).\n5. **Architecture & Tech Radar (Best-of-Breed)** : pour chaque technologie clé, explique pourquoi c'est le meilleur choix ici, donne un argument massue, un contre-argument, et une alternative classique.\n6. **Module Graph & Connexions** : hubs, feuilles, Mermaid, points de fragilité.\n7. **Sécurité & Confidentialité** : posture, cryptographie, vulnérabilités.\n8. **Qualité du Code & Dette** : signaux, top risques, correctifs.\n9. **Produit & UX** : parcours utilisateur, points de friction, idées d'amélioration.\n10. **Paysage Concurrentiel** : positionnement vs 3-4 acteurs, avantages différenciants, règles du jeu du marché.\n11. **Marketing & Positionnement** : persona cible, promesse unique (USP), tagline, canaux d'acquisition, argumentaire "pourquoi on va gagner", et **Master Move** : la feature/stratégie dominante qui fait gagner, compatible avec les contraintes du projet IDENTIFIEES dans le contexte.\n11b. **Contraintes Produits du Projet** (avant la roadmap) : liste les contraintes explicites identifiées dans == CONTRAINTES PRODUIT IDENTIFIEES == en début de contexte. Si aucune, indique "Aucune contrainte documentée". Cette section sert de référence pour justifier chaque action.\n12. **Roadmap 90 Jours & Justifications** : 4-6 actions concrètes priorisées (semaines 1-4, 5-8, 9-12) pour devenir le meilleur. Chaque action DOIT être suivie d'une phrase commençant par "> Justification :" qui explique pourquoi elle est cohérente avec les règles du projet. Si aucune contrainte, explique pourquoi elle est adaptée à la stack/architecture. Exemple : > Justification : Cette action respecte la règle "100% offline" car elle n'utilise aucun backend cloud.\n13. **Fait avec passion par shinzarou-eng** : concept produit/visuel original, slogan percutant, et argumentaire marketing gagnant inspiré par le code — dans le respect des contraintes du projet IDENTIFIEES dans le contexte.\n\nReste factuel, cible les fichiers par leur chemin relatif. Ne généralise pas hors du contexte. Si aucune contrainte produit n'est documentée, écris simplement "Contraintes produit : aucune" et continue toutes les sections normalement. NE SAUTE AUCUNE SECTION ET NE PERDS AUCUNE QUESTION. Réponds dans la langue de l'utilisateur.\n\n## CHECKLIST FINALE (obligatoire, vérifie avant d'envoyer)\n- [ ] Sections numérotées de 1 à 13.\n- [ ] Bannière ASCII en haut.\n- [ ] 5 score cards avec notes /10.\n- [ ] 1 diagramme Mermaid (architecture, data flow ou module graph).\n- [ ] Chaque action roadmap a un "> Justification :".\n- [ ] Au moins 2 citations de fichiers exactes (ligne).\n- [ ] Conclusion "Fait avec passion par shinzarou-eng".`;
  const en = `${context}\n\n${langInstruction(lang)}\n\n${styleText}You are an **elite CTO / Technical Partner** writing the **ultimate Professional Assessment** for the project "${projectName}". This document must be the most beautiful, punchy and actionable: a board-ready high-level report. Mission: merge architecture, debt, competition, test/build results, git, marketing AND respect the product constraints IDENTIFIED in the context. Leverage the == PROJECT METRICS == and == KEY CODE SNIPPETS == to cite exact numbers and insert code snippets. Never impose constraints that are not in the context.${f}\n\n## Visual Identity (mandatory)${banner}\n- Use premium emojis for each section\n- Professional tables framed by Markdown lines\n- Mermaid diagrams\n- Quote boxes with > for insights and verdicts\n- "Score cards": Maturity, Security, Maintainability, Performance, UX (scores out of 10 with rationale)\n- Text badges: [CRITICAL], [HIGH-VALUE], [SECURITY], [STRATEGY], [BEST-TECH], [MARKETING], [RECOMMENDATION].\n- End with the signature block below:\n${signature}\n\n## Required Sections (number exactly 1 to 13)\n1. **Cover Page**: banner, date, project, version, author (DSH Codebase Analysis).\n2. **Executive Summary**: product promise, technical verdict, 5 score cards out of 10, argument for why this project can be the best, and alignment with the product constraints IDENTIFIED in the context.\n3. **Deep Diagnosis**: synthetic diagnosis in 3-5 strong sentences.\n4. **Strategic SWOT**: 2x2 table (Strengths, Weaknesses, Opportunities, Threats).\n5. **Architecture & Tech Radar (Best-of-Breed)**: for each key technology, explain why it is the best choice here, give a hard-hitting argument, a counter-argument, and a classic alternative.\n6. **Module Graph & Connections**: hubs, leaves, Mermaid, fragility points.\n7. **Security & Privacy**: posture, cryptography, vulnerabilities.\n8. **Code Quality & Debt**: signals, top risks, fixes.\n9. **Product & UX**: user journey, friction points, improvement ideas.\n10. **Competitive Landscape**: positioning vs 3-4 players, differentiating advantages, market rules.\n11. **Marketing & Positioning**: target persona, unique selling proposition (USP), tagline, acquisition channels, "why we will win" argument, and **Master Move**: the dominant feature/strategy that makes you win, compatible with the product constraints IDENTIFIED in the context.\n11b. **Product Constraints of the Project** (before the roadmap): list the explicit constraints identified in == IDENTIFIED PRODUCT CONSTRAINTS == at the start of the context. If none, indicate "No documented constraints". This section serves as a reference to justify each action.\n12. **90-Day Roadmap & Rationale**: 4-6 prioritized concrete actions (weeks 1-4, 5-8, 9-12) to become the best. Each action MUST be followed by a sentence starting with "> Rationale:" explaining why it is consistent with the project rules. If no constraints, explain why it fits the stack/architecture. Example: > Rationale: This action respects the "100% offline" rule by not using any cloud backend.\n13. **Made with passion by shinzarou-eng**: an original product/visual concept, a punchy slogan, and a winning marketing argument inspired by the code — respecting the product constraints IDENTIFIED in the context.\n\nStay factual, target files by their relative path. Do not generalize beyond the context. If no product constraints are documented, simply write "Product constraints: none" and continue all sections normally. DO NOT SKIP ANY SECTION AND DO NOT LOSE ANY QUESTION. Respond in the user\'s language.\n\n## FINAL CHECKLIST (mandatory, verify before sending)\n- [ ] Sections numbered 1 to 13.\n- [ ] ASCII banner at the top.\n- [ ] 5 score cards with scores out of 10.\n- [ ] 1 Mermaid diagram (architecture, data flow or module graph).\n- [ ] Each roadmap action has a "> Rationale:".\n- [ ] At least 2 exact file citations (line).\n- [ ] Conclusion "Made with passion by shinzarou-eng".`;
  return withCitations(isEn ? en : fr, lang);
}

function buildTasksPrompt(context, projectName, focus = "", style = "punchy", lang = "fr") {
  const isEn = lang === "en";
  const f = focus ? (isEn ? `\nRequested focus: ${focus}` : `\nFocus demandé : ${focus}`) : "";
  const styleText = styleInstruction(style, lang);
  const banner = bannerInstruction(projectName, isEn ? "TASKS Action Plan" : "Plan d'Action TASKS", isEn ? "EXECUTABLE ROADMAP AND PRIORITIZED SPRINTS" : "ROADMAP EXÉCUTABLE ET SPRINTS PRIORISÉS");
  const fr = `${context}\n\n${langInstruction(lang)}\n\n${styleText}Tu es un **Delivery Lead / CTO** qui transforme un rapport de codebase en **plan d'action exécutable** pour le projet "${projectName}". RÈGLE D'OR : la section == TÂCHES GÉNÉRÉES DEPUIS LES SIGNAUX == contient déjà les tâches avec leurs blocs Avant/Après. Tu DOIS les recopier TELLES QUELLES dans le TASKS.md final, les organiser en sprints (P0, P1, P2, P3), et conserver OBLIGATOIREMENT les blocs Avant et Après FOURNIS. Tu as le droit d'ajouter 2-3 tâches maximum si tu identifies un risque majeur absent, mais la majorité du plan doit venir des tâches pré-générées. Chaque tâche doit être compatible avec les contraintes produit IDENTIFIEES dans le contexte (README, MEMORY.md, package.json). Avant la liste des tâches, ajoute une section "Contraintes produit identifiées" pour servir de référence.${f}\n\n## Ton et style${banner}\n- Un titre clair :\n~~~markdown\n# TASKS.md — Plan d'action ${projectName}\n~~~\n- Des tableaux avec colonnes : Priorité, Tâche, Fichier(s) concerné(s), Difficulté (1-5), Impact, Livrable\n- Des checklists Markdown : '[ ]' / '[x]'\n- Des sprints : Sprint 1 (semaines 1-2), Sprint 2, Sprint 3\n- Des badges : [CRITIQUE], [RAPIDE], [STRATEGIQUE], [TECH-DEBT].\n- Conclus par : Fait avec passion par shinzarou-eng (dans la langue de l'utilisateur)\n\n## Sections obligatoires\n1. **Vue d'ensemble** : 3-5 tâches prioritaires dans un tableau.\n2. **Sprint 1 — Fondations** : sécurité, stabilité, tests.\n3. **Sprint 2 — Amélioration** : refacto, UX, performance.\n4. **Sprint 3 — Différenciation** : features gagnantes, marketing.\n5. **Checklist globale** : toutes les tâches avec '[ ]'.\n\nChaque tâche doit être actionnable, citer un chemin de fichier relatif quand c'est possible, et être suivie d'une phrase commençant par "> Justification :" qui explique pourquoi elle est cohérente avec les règles du projet.\n\n## Exigence AVANT / APRÈS\nPour CHAQUE tâche, ajoute obligatoirement deux blocs de code :\n- **Avant** : extrait du code actuel (max 10 lignes) depuis le contexte == TECH DEBT & SIGNALS == ou == EXTRAITS DE CODE CLÉS ==.\n- **Après** : extrait du code corrigé proposé (max 10 lignes).\n\nExemple de format :\n- [ ] **[TASK-01] Typer l'événement SpeechRecognition**\n  - Fichier : src/components/KodaAssistantModal.tsx:651\n  - Avant :\n    --- code ts ---\n    recognition.onresult = (event: any) => { ... };\n    ---\n  - Après :\n    --- code ts ---\n    recognition.onresult = (event: SpeechRecognitionEvent) => { ... };\n    ---\n  > Justification : ...\n\nSi tu ne peux pas extraire l'extrait, cite au minimum le fichier et la ligne.\n\n## CHECKLIST FINALE (obligatoire, vérifie avant d'envoyer)\n- [ ] 5 sections présentes (Vue d'ensemble, Sprint 1, Sprint 2, Sprint 3, Checklist globale).\n- [ ] Toutes les tâches ont un statut '[ ]'.\n- [ ] Chaque tâche a un bloc **Avant** (code actuel) et un bloc **Après** (code proposé), ou 'N/A' avec explication.\n- [ ] Chaque tâche a un Fichier:Ligne.\n- [ ] Chaque tâche a un "> Justification :".\n- [ ] Conclusion "Fait avec passion par shinzarou-eng".\n\nSi aucune contrainte n'est trouvée, écris "Contraintes produit : aucune" et continue toutes les sections normalement. NE SAUTE AUCUNE SECTION ET NE PERDS AUCUNE QUESTION.`;
  const en = `${context}\n\n${langInstruction(lang)}\n\n${styleText}You are a **Delivery Lead / CTO** turning a codebase report into an **executable action plan** for the project "${projectName}". GOLDEN RULE: the section == TASKS GENERATED FROM SIGNALS == already contains the tasks with their Before/After blocks. You MUST copy them AS-IS into the final TASKS.md, organize them into sprints (P0, P1, P2, P3), and OBLIGATORILY keep the provided Before and After blocks. You may add 2-3 extra tasks at most if you identify a major missing risk, but the majority of the plan must come from the pre-generated tasks. Each task must be compatible with the product constraints IDENTIFIED in the context (README, MEMORY.md, package.json). Before the task list, add an "Identified product constraints" section as a reference.${f}\n\n## Tone & Style${banner}\n- A clear title:\n~~~markdown\n# TASKS.md — Action Plan ${projectName}\n~~~\n- Tables with columns: Priority, Task, Concerned file(s), Difficulty (1-5), Impact, Deliverable\n- Markdown checklists: '[ ]' / '[x]'\n- Sprints: Sprint 1 (weeks 1-2), Sprint 2, Sprint 3\n- Badges: [CRITICAL], [QUICK], [STRATEGIC], [TECH-DEBT].\n- Conclude with: Made with passion by shinzarou-eng (in the user\'s language)\n\n## Required Sections\n1. **Overview**: 3-5 prioritized tasks in a table.\n2. **Sprint 1 — Foundations**: security, stability, tests.\n3. **Sprint 2 — Improvement**: refactor, UX, performance.\n4. **Sprint 3 — Differentiation**: winning features, marketing.\n5. **Global Checklist**: all tasks with '[ ]'.\n\nEach task must be actionable, cite a relative file path when possible, and be followed by a sentence starting with "> Rationale:" explaining why it is consistent with the project rules.\n\n## BEFORE / AFTER Requirement\nFor EACH task, you MUST add two code blocks:\n- **Before**: current code snippet (max 10 lines) from == TECH DEBT & SIGNALS == or == KEY CODE SNIPPETS == in the context.\n- **After**: proposed fixed code snippet (max 10 lines).\n\nExample format:\n- [ ] **[TASK-01] Type the SpeechRecognition event**\n  - File: src/components/KodaAssistantModal.tsx:651\n  - Before:\n    --- code ts ---\n    recognition.onresult = (event: any) => { ... };\n    ---\n  - After:\n    --- code ts ---\n    recognition.onresult = (event: SpeechRecognitionEvent) => { ... };\n    ---\n  > Rationale : ...\n\nIf you cannot extract the snippet, at least cite the file and line.\n\n## FINAL CHECKLIST (mandatory, verify before sending)\n- [ ] 5 sections present (Overview, Sprint 1, Sprint 2, Sprint 3, Global Checklist).\n- [ ] All tasks have status '[ ]'.\n- [ ] Each task has a **Before** (current code) and an **After** (proposed code) block, or 'N/A' with explanation.\n- [ ] Each task has a File:Line.\n- [ ] Each task has a "> Rationale:".\n- [ ] Conclusion "Made with passion by shinzarou-eng".\n\nIf no constraints are found, write "Product constraints: none" and continue all sections normally. DO NOT SKIP ANY SECTION AND DO NOT LOSE ANY QUESTION.`;
  return withCitations(isEn ? en : fr, lang);
}

function buildCeoPrompt(context, projectName, focus = "", lang = "fr") {
  const isEn = lang === "en";
  const f = focus ? (isEn ? `\nRequested focus: ${focus}` : `\nFocus demandé : ${focus}`) : "";
  const styleText = styleInstruction("ouf", lang);
  const signature = brandSignature(lang);
  const banner = bannerInstruction(projectName, isEn ? "One-Page CEO Brief" : "One-Page CEO Brief", isEn ? "EXECUTIVE SUMMARY FOR DECISION MAKERS" : "EXECUTIVE SUMMARY POUR DÉCIDEUR");
  const fr = `${context}\n\n${langInstruction(lang)}\n\n${styleText}Tu es un **CTO / CEO / Partner** qui rédige le **One-Page Executive Brief** ultime sur le projet "${projectName}". RÈGLE D'OR : ce document tient sur UNE SEULE PAGE A4. MAXIMUM 7 sections courtes. Pas de blabla, que des insights à fort impact, des chiffres, des verdicts, des actions. Chaque section max 5-8 lignes. Utilise tableaux et listes. Si tu dépasses une page, tu as échoué.${f}\n\n## Identité visuelle (obligatoire)${banner}\n- Tableau exécutif unique avec les metrics clés.\n- 5 score cards (sur 10) avec justification en UNE phrase.\n- Encadrés visuels pour les insights.\n- Badges : [CRITIQUE], [HIGH-VALUE], [STRATEGY], [BEST-TECH], [KILLER-MOVE], [MARKETING].\n- Conclus par le bloc signature ci-dessous :\n${signature}\n\n## Sections obligatoires (numérote de 1 à 7, STRICTEMENT 1 PAGE)\n1. **Bannière & Titre** : 1 ligne.\n2. **Executive Summary** : 3 phrases + 1 tableau 4 métriques.\n3. **Verdict du board** : 5 score cards, 1 ligne chacune (Domaine | Note | 5 mots de justification).\n4. **Top 3 risques / dette** : 1 ligne par risque (Fichier:Ligne - Problème - Impact).\n5. **Top 3 opportunités / Killer Moves** : 1 phrase par action + Justification en 1 phrase.\n6. **SWOT ultra-concis** : 4 cases, max 4 points de 3-5 mots chacun.\n7. **Fait avec passion par shinzarou-eng** : 1 concept + 1 slogan + 1 phrase marketing.\n\nReste factuel, cible les fichiers par leur chemin relatif. Exploite les == MÉTRIQUES PROJET == et == EXTRAITS DE CODE CLÉS ==. Réponds dans la langue de l'utilisateur.\n\n## CHECKLIST FINALE (obligatoire, vérifie avant d'envoyer)\n- [ ] Exactement 7 sections numérotées.\n- [ ] Le document tient sur une page (max 60-80 lignes au total).\n- [ ] 5 score cards, 1 ligne chacune.\n- [ ] Top 3 risques avec Fichier:Ligne.\n- [ ] Top 3 opportunités avec "> Justification :".\n- [ ] SWOT : 4 points de 3-5 mots par case.\n- [ ] Aucun Mermaid, aucun tableau géant, aucune explication longue.`;
  const en = `${context}\n\n${langInstruction(lang)}\n\n${styleText}You are a **CTO / CEO / Partner** writing the ultimate **One-Page Executive Brief** for the project "${projectName}". GOLDEN RULE: this document fits on a SINGLE A4 page. MAXIMUM 7 short sections. No filler, only high-impact insights, numbers, verdicts, actions. Each section max 5-8 lines. Use tables and lists. If you exceed one page, you failed.${f}\n\n## Visual Identity (mandatory)${banner}\n- Single executive table with key metrics.\n- 5 score cards (out of 10) with rationale in ONE sentence.\n- Visual callouts for insights.\n- Badges: [CRITICAL], [HIGH-VALUE], [STRATEGY], [BEST-TECH], [KILLER-MOVE], [MARKETING].\n- Conclude with the signature block below:\n${signature}\n\n## Required Sections (number 1 to 7, STRICTLY 1 PAGE)\n1. **Banner & Title**: 1 line.\n2. **Executive Summary**: 3 sentences + 1 table with 4 metrics.\n3. **Board verdict**: 5 score cards, 1 line each (Area | Score | 5-word rationale).\n4. **Top 3 risks / debt**: 1 line per risk (File:Line - Problem - Impact).\n5. **Top 3 opportunities / Killer Moves**: 1 sentence per action + Rationale in 1 sentence.\n6. **Ultra-concise SWOT**: 4 boxes, max 4 points of 3-5 words each.\n7. **Made with passion by shinzarou-eng**: 1 concept + 1 slogan + 1 marketing sentence.\n\nStay factual, target files by their relative path. Leverage == PROJECT METRICS == and == KEY CODE SNIPPETS ==. Respond in the user\'s language.\n\n## FINAL CHECKLIST (mandatory, verify before sending)\n- [ ] Exactly 7 numbered sections.\n- [ ] Document fits on one page (max 60-80 lines total).\n- [ ] 5 score cards, 1 line each.\n- [ ] Top 3 risks with File:Line.\n- [ ] Top 3 opportunities with "> Rationale:".\n- [ ] SWOT: 4 points of 3-5 words per box.\n- [ ] No Mermaid, no giant table, no long explanation.`;
  return withCitations(isEn ? en : fr, lang);
}

function buildBuildPrompt(context, projectName, focus = "", lang = "fr") {
  const isEn = lang === "en";
  const f = focus ? (isEn ? `\nRequested focus: ${focus}` : `\nFocus demandé : ${focus}`) : "";
  const banner = bannerInstruction(projectName, isEn ? "Build Benchmark" : "Build Benchmark", isEn ? "BUILD PERFORMANCE & BUNDLE" : "PERFORMANCE DE BUILD & BUNDLE");
  const fr = `${context}\n\n${langInstruction(lang)}\n\n${banner}\n\nTu es un **Staff Engineer / Build Performance Expert**. Analyse le résultat du build du projet "${projectName}". Produis un rapport ultra-concis et percutant.${f}\n\n## Format attendu\n- Bannière ASCII : "BUILD BENCHMARK — ${(projectName ?? "").toUpperCase()}"\n- 3 score cards : Vitesse, Taille du bundle, Stabilité (notes /10)\n- Tableau des fichiers de sortie (nom, taille)\n- Top 3 leviers d'optimisation\n- Conclusion : Fait avec passion par shinzarou-eng (langue utilisateur)`;
  const en = `${context}\n\n${langInstruction(lang)}\n\n${banner}\n\nYou are a **Staff Engineer / Build Performance Expert**. Analyze the build result of the project "${projectName}". Produce an ultra-concise, punchy report.${f}\n\n## Expected format\n- ASCII banner: "BUILD BENCHMARK — ${(projectName ?? "").toUpperCase()}"\n- 3 score cards: Speed, Bundle size, Stability (scores out of 10)\n- Output files table (name, size)\n- Top 3 optimization levers\n- Conclusion: Made with passion by shinzarou-eng (user language)`;
  return withCitations(isEn ? en : fr, lang);
}

function buildPlayerPrompt(context, projectName, focus = "", lang = "fr") {
  const isEn = lang === "en";
  const f = focus ? (isEn ? `\nRequested focus: ${focus}` : `\nFocus demandé : ${focus}`) : "";
  const banner = bannerInstruction(projectName, isEn ? "Player Brief" : "Player Brief", isEn ? "USER JOURNEY & EXPERIENCE" : "PARCOURS UTILISATEUR & EXPÉRIENCE");
  const fr = `${context}\n\n${langInstruction(lang)}\n\n${banner}\n\nTu es un **UX Researcher / Playtester / Product Hunter** qui réalise un **Player Brief** sur le projet "${projectName}". Tu ne regardes pas le code comme un dev, mais comme un vrai utilisateur final qui découvre l'app, clique, se frustre, se réjouit. Mission : décrire l'expérience vécue, identifier les moments clés, les frictions et les opportunités de 'wow'.${f}\n\n## Format attendu\n- Bannière ASCII : "PLAYER BRIEF — ${(projectName ?? "").toUpperCase()}"\n- Score cards : Onboarding, Clarté, Réactivité, Confiance, Plaisir (sur 10)\n- Tableau du parcours utilisateur : Étape, Action, Sentiment, Friction, Fix\n- Top 5 moments 'Wow' (ce qui impressionne)\n- Top 5 frictions bloquantes ou irritantes\n- Idées de gamification / engagement (si pertinent)\n- Roadmap UX 30 jours : 3 actions rapides d'impact utilisateur\n- Conclusion : Fait avec passion par shinzarou-eng (langue utilisateur)`;
  const en = `${context}\n\n${langInstruction(lang)}\n\n${banner}\n\nYou are a **UX Researcher / Playtester / Product Hunter** producing a **Player Brief** for the project "${projectName}". You do not look at the code like a dev, but like a real end user discovering the app, clicking, getting frustrated, getting delighted. Mission: describe the lived experience, identify key moments, frictions and 'wow' opportunities.${f}\n\n## Expected format\n- ASCII banner: "PLAYER BRIEF — ${(projectName ?? "").toUpperCase()}"\n- Score cards: Onboarding, Clarity, Responsiveness, Trust, Delight (out of 10)\n- User journey table: Step, Action, Sentiment, Friction, Fix\n- Top 5 'Wow' moments (what impresses)\n- Top 5 blocking or annoying frictions\n- Gamification / engagement ideas (if relevant)\n- 30-day UX roadmap: 3 quick high-impact actions\n- Conclusion: Made with passion by shinzarou-eng (user language)`;
  return withCitations(isEn ? en : fr, lang);
}

function buildGitPrompt(context, projectName, focus = "", lang = "fr") {
  const isEn = lang === "en";
  const f = focus ? (isEn ? `\nRequested focus: ${focus}` : `\nFocus demandé : ${focus}`) : "";
  const banner = bannerInstruction(projectName, isEn ? "Git Intelligence" : "Git Intelligence", isEn ? "HISTORY, HOTSPOTS & RISKS" : "HISTORIQUE, HOTSPOTS & RISQUES");
  const fr = `${context}\n\n${langInstruction(lang)}\n\n${banner}\n\nTu es un **Tech Lead** qui analyse l'historique git du projet "${projectName}". Résume l'activité, identifie les tendances, les hotspots de modification et les risques récents.${f}\n\n## Format attendu\n- Bannière ASCII : "GIT INTELLIGENCE — ${(projectName ?? "").toUpperCase()}"\n- Derniers commits synthétisés\n- Hotspots (fichiers qui bougent le plus)\n- Risques récents\n- Suggestions de prochaines actions\n- Conclusion : Fait avec passion par shinzarou-eng (langue utilisateur)`;
  const en = `${context}\n\n${langInstruction(lang)}\n\n${banner}\n\nYou are a **Tech Lead** analyzing the git history of the project "${projectName}". Summarize activity, identify trends, modification hotspots and recent risks.${f}\n\n## Expected format\n- ASCII banner: "GIT INTELLIGENCE — ${(projectName ?? "").toUpperCase()}"\n- Synthesized recent commits\n- Hotspots (files that change the most)\n- Recent risks\n- Suggested next actions\n- Conclusion: Made with passion by shinzarou-eng (user language)`;
  return withCitations(isEn ? en : fr, lang);
}

function buildApplyPrompt(filePath, newContent, projectName, lang = "fr") {
  const isEn = lang === "en";
  const fr = `Applique la mise à jour suivante au fichier "${filePath}" du projet "${projectName}".\n\n${langInstruction(lang)}\n\nTu es un **Staff Engineer**. Le contenu fourni est la nouvelle version complète du fichier. Réponds UNIQUEMENT par :\n\n- Si le patch semble correct : "Fichier ${filePath} mis à jour avec succès."\n- Si tu refuses : dis pourquoi en une phrase.\n\nFait avec passion par shinzarou-eng.\n\n---\n\nNouveau contenu :\n~~~\n${newContent.slice(0, 8000)}\n~~~`;
  const en = `Apply the following update to file "${filePath}" in project "${projectName}".\n\n${langInstruction(lang)}\n\nYou are a **Staff Engineer**. The provided content is the complete new version of the file. Respond ONLY with:\n\n- If the patch looks correct: "File ${filePath} updated successfully."\n- If you refuse: say why in one sentence.\n\nMade with passion by shinzarou-eng.\n\n---\n\nNew content:\n~~~\n${newContent.slice(0, 8000)}\n~~~`;
  return withCitations(isEn ? en : fr, lang);
}

function isDirectoryLike(value) {
  if (!value) return false;
  try {
    const expanded = value.replace(/^~/, homedir());
    const resolved = resolve(expanded);
    return existsSync(resolved) && statSync(resolved).isDirectory();
  } catch {
    return false;
  }
}

function pullLeadingPath(input) {
  const quoted = input.match(/^"([^"]+)"(?:\s+(.*))?$/s) || input.match(/^'([^']+)'(?:\s+(.*))?$/s);
  if (quoted) {
    const candidate = quoted[1];
    if (isDirectoryLike(candidate)) {
      return { path: candidate, rest: quoted[2] || "" };
    }
    return null;
  }

  const token = input.match(/^(\S+)(?:\s+(.*))?$/s);
  if (token && isDirectoryLike(token[1])) {
    return { path: token[1], rest: token[2] || "" };
  }
  return null;
}

function parseCodebaseInput(rawInput) {
  let input = rawInput.trim();
  const result = { projectPath: "", filePath: "", query: "", style: "ouf", crea: false, creaTheme: "", raw: false, apply: false, dryRun: false, content: "", lang: "" };

  const contentFlag = input.match(/--(?:content|contenu)\s+((?:"[^"]+")|(?:'[^']+')|(?:`[^`]+`))/is);
  if (contentFlag) {
    result.content = contentFlag[1].replace(/^["'`]|["'`]$/g, "");
    input = input.replace(contentFlag[0], "").trim();
  }

  const langFlag = input.match(/--(?:lang|l)\s+(en|fr|es|de|it|pt)\b/i);
  if (langFlag) {
    result.lang = langFlag[1].toLowerCase();
    input = input.replace(langFlag[0], "").trim();
  }

  // Le premier argument positionnel peut etre un chemin de projet (ex: /codebase "D:\\mon app")
  const leading = pullLeadingPath(input);
  if (leading) {
    result.projectPath = leading.path;
    input = leading.rest.trim();
  }

  const projectFlag = input.match(/--(?:project|projet|path|p)\s+((?:"[^"]+")|(?:'[^']+')|(?:\S+))/i);
  if (projectFlag) {
    result.projectPath = projectFlag[1].replace(/^["']|["']$/g, "");
    input = input.replace(projectFlag[0], "").trim();
  }

  const fileFlag = input.match(/--(?:file|fichier|f)\s+((?:"[^"]+")|(?:'[^']+')|(?:\S+))/i);
  if (fileFlag) {
    result.filePath = fileFlag[1].replace(/^["']|["']$/g, "");
    input = input.replace(fileFlag[0], "").trim();
  }

  const styleFlag = input.match(/--(?:style|s)\s+((?:"[^"]+")|(?:'[^']+')|(?:[^-\s][^\s]*))/i);
  if (styleFlag) {
    const rawStyle = styleFlag[1].replace(/^["']|["']$/g, "").toLowerCase().trim();
    result.style = { wow: "ouf", ouf: "ouf", best: "ouf" }[rawStyle] || rawStyle;
    input = input.replace(styleFlag[0], "").trim();
  }

  const creaThemeFlag = input.match(/--(?:crea-theme|theme|t)\s+((?:"[^"]+")|(?:'[^']+')|(?:[^-\s][^\s]*))/i);
  if (creaThemeFlag) {
    result.creaTheme = creaThemeFlag[1].replace(/^["']|["']$/g, "");
    input = input.replace(creaThemeFlag[0], "").trim();
  }

  const creaFlag = input.match(/--(?:crea|c)(?:\s|$)/i);
  if (creaFlag) {
    result.crea = true;
    input = input.replace(creaFlag[0], "").trim();
  }

  const rawFlag = input.match(/--(?:raw|r)(?:\s|$)/i);
  if (rawFlag) {
    result.raw = true;
    input = input.replace(rawFlag[0], "").trim();
  }

  const applyFlag = input.match(/--(?:apply|a)(?:\s|$)/i);
  if (applyFlag) {
    result.apply = true;
    input = input.replace(applyFlag[0], "").trim();
  }

  const dryRunFlag = input.match(/--(?:dry-run|dryrun|d)(?:\s|$)/i);
  if (dryRunFlag) {
    result.dryRun = true;
    input = input.replace(dryRunFlag[0], "").trim();
  }

  const quoted = input.match(/^"([^"]+)"(?:\s+(.*))?$/s) || input.match(/^'([^']+)'(?:\s+(.*))?$/s);
  if (quoted) {
    result.query = quoted[1];
  } else {
    result.query = input;
  }
  return result;
}

async function submitToAgent(ctx, sessionId, text, signal) {
  let agent;
  try {
    const agents = ctx.get("agents");
    agent = agents.get(sessionId);
  } catch { }
  if (agent === void 0) {
    try {
      const sessions = ctx.get("sessions");
      const session = sessions.get(sessionId);
      if (session !== void 0) {
        const agents = ctx.get("agents");
        for (const [id, a] of agents.entries()) {
          if (a?.sessionId === sessionId || a?.id === sessionId) {
            agent = a;
            break;
          }
        }
        if (agent === void 0) {
          if (typeof session.steer === "function") {
            agent = session;
          } else {
            throw new Error("Aucune session active. Ouvre ou cree une session DSH d'abord.");
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("Aucune session active")) throw err;
    }
  }
  if (agent === void 0) throw new Error("Aucune session active. Ouvre ou cree une session DSH d'abord.");
  agent.steer(createUserMessage({
    content: [{ type: "text", text }],
    source: { kind: "user" }
  }));
  return { ok: true };
}

function registerTool(tools, name, description, parameters, renderFn, executeFn) {
  tools.register(defineTool({
    name,
    description,
    parameters,
    output: {
      schema: {
        type: "object",
        properties: {
          context: { type: "string" },
          query: { type: "string" },
          description: { type: "string" },
          projectName: { type: "string" },
          crea: { type: "boolean" },
          creaTheme: { type: "string" },
          lang: { type: "string" },
          style: { type: "string" },
          markdown: { type: "string" },
          applyReport: { type: "string" },
          file: { type: "string" },
          newContent: { type: "string" }
        },
        additionalProperties: true
      },
      render(_args, value) {
        return [{ type: "text", text: renderFn(value) }];
      }
    },
    timeoutMs: 180_000,
    execute: executeFn
  }));
}

function apply(ctx) {
  const tools = ctx.get("tools");
  const commands = ctx.get("commands");
  const agents = ctx.get("agents");
  const systemPrompt = ctx.get("systemPrompt");

  registerTool(
    tools,
    "codebase_chat",
    "Answer a question about a local codebase by reading project files. Use when the user asks about code, architecture, how something works, or references a project folder. Supports any language and an optional creative footer. Set crea=true to append a creative idea at the end.",
    {
      projectPath: { type: "string", description: "Absolute local path to the project folder. If omitted, the project root is auto-detected from the current working directory." },
      question: { type: "string", description: "Question about the codebase." },
      filePath: { type: "string", description: "Optional specific file or symbol to focus on." },
      crea: { type: "boolean", description: "If true, append a creative 'Fait avec passion par shinzarou-eng <project>' footer." },
      creaTheme: { type: "string", description: "Optional creative theme for the footer." },
      lang: { type: "string", description: "Response language: 'fr' (default) or 'en'." },
      diff: { type: "string", description: "Git ref (e.g. 'main', 'HEAD~5'). Scopes the context to files changed vs that ref." }
    },
    (value) => buildChatPrompt(value.query, value.context, value.projectName, value.crea, value.creaTheme, value.lang),
    async (args, exec) => {
      const { absProject, context } = await collectCodebaseContext(args.projectPath, { focus: args.question, filePath: args.filePath, lang: args.lang, diff: args.diff });
      const projectName = await getProjectName(absProject);
      return { query: args.question, projectName, crea: args.crea || false, creaTheme: args.creaTheme || "", lang: args.lang || "fr", context };
    }
  );

  registerTool(
    tools,
    "codebase_search",
    "Search for a term, pattern, or concept across a local codebase and summarize where it is used. Use for 'where is X used', 'find references', or 'search for'. Answer in the user's language. Set crea=true to append a creative idea at the end.",
    {
      projectPath: { type: "string", description: "Absolute local path to the project folder. If omitted, the project root is auto-detected from the current working directory." },
      query: { type: "string", description: "Term, symbol, or pattern to search." },
      crea: { type: "boolean", description: "If true, append a creative 'Fait avec passion par shinzarou-eng <project>' footer." },
      creaTheme: { type: "string", description: "Optional creative theme for the footer." },
      lang: { type: "string", description: "Response language: 'fr' (default) or 'en'." },
      diff: { type: "string", description: "Git ref (e.g. 'main', 'HEAD~5'). Scopes the search to files changed vs that ref." }
    },
    (value) => buildSearchPrompt(value.query, value.context, value.projectName, value.crea, value.creaTheme, value.lang),
    async (args, exec) => {
      const { absProject, context } = await collectCodebaseContext(args.projectPath, { focus: args.query, searchQuery: args.query, lang: args.lang, diff: args.diff });
      const projectName = await getProjectName(absProject);
      return { query: args.query, projectName, crea: args.crea || false, creaTheme: args.creaTheme || "", lang: args.lang || "fr", context };
    }
  );

  registerTool(
    tools,
    "codebase_explain",
    "Explain a specific file, function, class, or symbol in a local codebase. Use when the user asks 'explain X' or 'what does Y do'. Answer in the user's language. Set crea=true to append a creative idea at the end.",
    {
      projectPath: { type: "string", description: "Absolute local path to the project folder. If omitted, the project root is auto-detected from the current working directory." },
      target: { type: "string", description: "File name, relative path, or symbol to explain." },
      crea: { type: "boolean", description: "If true, append a creative 'Fait avec passion par shinzarou-eng <project>' footer." },
      creaTheme: { type: "string", description: "Optional creative theme for the footer." },
      lang: { type: "string", description: "Response language: 'fr' (default) or 'en'." }
    },
    (value) => buildExplainPrompt(value.query, value.context, value.projectName, value.crea, value.creaTheme, value.lang),
    async (args, exec) => {
      const { absProject, context } = await collectCodebaseContext(args.projectPath, { focus: args.target, filePath: args.target, lang: args.lang });
      const projectName = await getProjectName(absProject);
      return { query: args.target, projectName, crea: args.crea || false, creaTheme: args.creaTheme || "", lang: args.lang || "fr", context };
    }
  );

  registerTool(
    tools,
    "codebase_refactor",
    "Propose a refactor for a specific file in a local codebase based on a description. Returns the suggested changes. Answer in the user's language. Set crea=true to append a creative idea at the end.",
    {
      projectPath: { type: "string", description: "Absolute local path to the project folder. If omitted, the project root is auto-detected from the current working directory." },
      filePath: { type: "string", description: "File name or relative path to refactor." },
      description: { type: "string", description: "What to change and why." },
      crea: { type: "boolean", description: "If true, append a creative 'Fait avec passion par shinzarou-eng <project>' footer." },
      creaTheme: { type: "string", description: "Optional creative theme for the footer." },
      lang: { type: "string", description: "Response language: 'fr' (default) or 'en'." }
    },
    (value) => buildRefactorPrompt(value.query, value.description, value.context, value.projectName, value.crea, value.creaTheme, value.lang),
    async (args, exec) => {
      const { absProject, context } = await collectCodebaseContext(args.projectPath, { focus: args.description, filePath: args.filePath, lang: args.lang });
      const projectName = await getProjectName(absProject);
      return { query: args.filePath, description: args.description || "", projectName, crea: args.crea || false, creaTheme: args.creaTheme || "", lang: args.lang || "fr", context };
    }
  );

  registerTool(
    tools,
    "codebase_crea",
    "Generate a creative output (slogan, feature name, tagline, visual concept, one-liner) based on the analyzed codebase. Useful for marketing, naming, or product ideation.",
    {
      projectPath: { type: "string", description: "Absolute local path to the project folder. If omitted, the project root is auto-detected from the current working directory." },
      theme: { type: "string", description: "Optional creative theme (e.g. 'slogan for onboarding', 'feature name for reminders')." },
      lang: { type: "string", description: "Response language: 'fr' (default) or 'en'." }
    },
    (value) => buildCreaPrompt(value.query, value.context, value.projectName, value.lang),
    async (args, exec) => {
      const { absProject, context } = await collectCodebaseContext(args.projectPath, { focus: args.theme || "creative output", lang: args.lang });
      const projectName = await getProjectName(absProject);
      return { query: args.theme || "creative", projectName, lang: args.lang || "fr", context };
    }
  );

  registerTool(
    tools,
    "codebase_health",
    "Run a deterministic static analysis of the codebase — circular dependencies, unused files and exports, duplicated code blocks, complexity hotspots, and a health score. Returns concrete findings directly, no LLM needed. Use for 'health', 'dead code', 'circular deps', 'duplication' or 'complexity' requests.",
    {
      projectPath: { type: "string", description: "Absolute local path to the project folder. If omitted, the project root is auto-detected from the current working directory." },
      lang: { type: "string", description: "Report language: 'fr' (default) or 'en'." },
      diff: { type: "string", description: "Git ref (e.g. 'main', 'HEAD~5'). Scopes the analysis to files changed vs that ref." }
    },
    (value) => value.markdown || "No report generated.",
    async (args, exec) => {
      if (!analyzeProject) throw new Error("Static analysis module not available.");
      const projectPath = await resolveProjectPath(args.projectPath);
      let scope;
      let scopeLine = "";
      if (args.diff && getChangedFiles) {
        const s = await getChangedFiles(await findProjectRoot(projectPath), String(args.diff)).catch(() => null);
        if (s?.ok) {
          scope = { files: s.files };
          scopeLine = (args.lang === "en"
            ? `Scope: ${s.files.size} file(s) changed vs ${args.diff}\n\n`
            : `Périmètre : ${s.files.size} fichier(s) modifié(s) vs ${args.diff}\n\n`);
        }
      }
      const report = await analyzeProject(projectPath, scope);
      return { projectName: basename(report.projectPath), lang: args.lang || "fr", markdown: scopeLine + formatHealthReport(report, args.lang === "en" ? "en" : "fr") };
    }
  );

  registerTool(
    tools,
    "codebase_impact",
    "Blast-radius analysis: which files transitively depend on a target file — what breaks if it changes. Deterministic, returns findings directly, no LLM needed. Use for 'impact', 'what breaks', 'dependents', 'who imports X' requests.",
    {
      projectPath: { type: "string", description: "Absolute local path to the project folder. If omitted, the project root is auto-detected from the current working directory." },
      file: { type: "string", description: "File to analyze — relative path or name (e.g. 'src/store.ts'). Required." },
      lang: { type: "string", description: "Report language: 'fr' (default) or 'en'." }
    },
    (value) => value.markdown || "No report generated.",
    async (args, exec) => {
      if (!analyzeImpact) throw new Error("Static analysis module not available.");
      const projectPath = await resolveProjectPath(args.projectPath);
      const file = String(args.file || "").trim();
      if (!file) throw new Error("Missing `file` argument (e.g. 'src/store.ts').");
      const r = await analyzeImpact(projectPath, file);
      if (!r.ok) {
        const msg = r.candidates.length
          ? `Cible ambiguë "${file}" — candidats : ${r.candidates.join(', ')}`
          : `Aucun fichier de code ne correspond à "${file}".`;
        return { projectName: basename(projectPath), lang: args.lang || "fr", markdown: msg };
      }
      return { projectName: basename(r.report.projectPath), lang: args.lang || "fr", markdown: formatImpactReport(r.report, args.lang === "en" ? "en" : "fr") };
    }
  );

  registerTool(
    tools,
    "codebase_intelligence",
    "Run a full professional intelligence brief on a codebase: architecture, module graph, data flow, risks, opportunities, and a creative idea. Use when the user wants an overview, audit, architect view, or just clicks the Codebase button. Answer in the user's language.",
    {
      projectPath: { type: "string", description: "Absolute local path to the project folder. If omitted, the project root is auto-detected from the current working directory." },
      focus: { type: "string", description: "Optional focus for the intelligence brief." },
      style: { type: "string", description: "Output style: ouf, punchy, dense, pedagogique, minimal." },
      lang: { type: "string", description: "Response language: 'fr' (default) or 'en'." }
    },
    (value) => buildIntelligencePrompt(value.context, value.projectName, value.query, value.style, value.lang),
    async (args, exec) => {
      const { absProject, context } = await collectIntelligenceContext(args.projectPath, args.focus || "professional intelligence brief", args.lang);
      const projectName = await getProjectName(absProject);
      return { query: args.focus || "intelligence", projectName, style: args.style || "punchy", lang: args.lang || "fr", context };
    }
  );

  registerTool(
    tools,
    "codebase_audit",
    "Audit a codebase for non-conformities, technical debt, errors, TODO/FIXME, console.log, bare catch, ts-ignore, any types, eval, innerHTML, and debugger. Proposes concrete fixes and a prioritized action plan. Use when the user asks for an audit, errors, debt, cleanup, or non-conformites.",
    {
      projectPath: { type: "string", description: "Absolute local path to the project folder. If omitted, the project root is auto-detected from the current working directory." },
      focus: { type: "string", description: "Optional focus (e.g. security, types, console)." },
      lang: { type: "string", description: "Response language: 'fr' (default) or 'en'." }
    },
    (value) => buildAuditPrompt(value.context, value.projectName, value.query, value.lang),
    async (args, exec) => {
      const { context, projectName } = await collectNonConformities(args.projectPath, args.focus || "", args.lang);
      return { query: args.focus || "audit", projectName, lang: args.lang || "fr", context };
    }
  );

  registerTool(
    tools,
    "codebase_report",
    "Generate a deep professional strategic report (constat professionnel) combining architecture, audit, security, SWOT, score cards, competitor landscape, and a 90-day roadmap. Use when the user asks for a report, constat, strategic view, executive summary, or wants the most beautiful and complete output.",
    {
      projectPath: { type: "string", description: "Absolute local path to the project folder. If omitted, the project root is auto-detected from the current working directory." },
      focus: { type: "string", description: "Optional focus for the strategic report." },
      style: { type: "string", description: "Output style: ouf, punchy, dense, pedagogique, minimal." },
      lang: { type: "string", description: "Response language: 'fr' (default) or 'en'." }
    },
    (value) => buildReportPrompt(value.context, value.projectName, value.query, value.style, value.lang),
    async (args, exec) => {
      const { context, projectName } = await collectAssessmentContext(args.projectPath, args.focus || "rapport stratégique", args.lang);
      return { query: args.focus || "report", projectName, style: args.style || "punchy", lang: args.lang || "fr", context };
    }
  );

  registerTool(
    tools,
    "codebase_tasks",
    "Generate an actionable TASKS.md plan from a codebase assessment. Use when the user wants a sprint plan, roadmap, or task list.",
    {
      projectPath: { type: "string", description: "Absolute local path to the project folder. If omitted, the project root is auto-detected from the current working directory." },
      focus: { type: "string", description: "Optional focus (e.g. security, performance, product)." },
      raw: { type: "boolean", description: "If true, write a raw TASKS.md directly to the project and return the markdown without LLM rewriting." },
      apply: { type: "boolean", description: "If true and raw is true, apply the patches automatically." },
      dryRun: { type: "boolean", description: "If true and apply is true, show what would change without writing files." },
      lang: { type: "string", description: "Response language: 'fr' (default) or 'en'." }
    },
    (value) => {
      if (value.markdown) return value.markdown;
      if (value.applyReport) return value.applyReport;
      return buildTasksPrompt(value.context, value.projectName, value.query);
    },
    async (args, exec) => {
      const { absProject, context, projectName, preTasks, metrics, constraints } = await collectTasksContext(args.projectPath, args.focus || "plan d'action", args.lang);
      if (args.raw) {
        if (isProtectedPath(absProject)) throw new Error("Ce chemin est protege. TASKS.md n'a pas ete ecrit.");
        const markdown = formatRawTasksMarkdown(projectName, metrics, constraints, preTasks, args.lang);
        const tasksPath = join(absProject, "TASKS.md");
        await writeFile(tasksPath, markdown, "utf8");
        if (args.apply) {
          const result = await runApplyTasks(absProject, markdown, args.dryRun);
          const report = `Application des taches (dryRun=${args.dryRun}) :\n- ${result.message}\n- Fichiers touches : ${(result.touchedFiles || []).join(", ") || "aucun"}\n- Resultats detailles :\n${(result.results || []).map((r) => `  - ${r.id || r.file || ""} ligne ${r.line} : ${r.status}${r.status === "mismatch" ? ` (attendu: ${r.expected?.slice(0, 40)}..., trouve: ${r.got?.slice(0, 40)}...)` : ""}`).join("\n")}\n${result.verification ? `Verification post-apply :\n${result.verification.map((v) => `  - ${v.name} : ${v.ok ? "OK" : "KO"}\n${v.output.slice(-200)}`).join("\n")}` : ""}`;
          return { query: args.focus || "tasks", projectName, context, applyReport: report };
        }
        return { query: args.focus || "tasks", projectName, context, markdown: `${tasksPath}\n\n${markdown}` };
      }
      return { query: args.focus || "tasks", projectName, context };
    }
  );

  registerTool(
    tools,
    "codebase_apply_tasks",
    "Apply a previously generated TASKS.md to the project source code. Use when the user asks to apply tasks, execute the plan, or run the fixes. Supports dry-run to preview changes.",
    {
      projectPath: { type: "string", description: "Absolute local path to the project folder. If omitted, the project root is auto-detected from the current working directory." },
      dryRun: { type: "boolean", description: "If true, show planned changes without writing files." },
      tasksFile: { type: "string", description: "Path to the TASKS.md file (default: PROJECT/TASKS.md)." }
    },
    (value) => value.applyReport || "Rapport d'application des taches.",
    async (args, exec) => {
      const absProject = await resolveProjectPath(args.projectPath);
      const tasksPath = args.tasksFile ? resolve(absProject, args.tasksFile) : join(absProject, "TASKS.md");
      const markdown = await safeReadText(tasksPath);
      if (!markdown) throw new Error(`TASKS.md introuvable : ${tasksPath}. Generez-le d'abord avec codebase_tasks raw=true.`);
      const result = await runApplyTasks(absProject, markdown, args.dryRun);
      const report = `Application des taches (dryRun=${args.dryRun}) :\n- ${result.message}\n- Fichiers touches : ${(result.touchedFiles || []).join(", ") || "aucun"}\n- Resultats detailles :\n${(result.results || []).map((r) => `  - ${r.id || r.file || ""} ligne ${r.line} : ${r.status}${r.status === "mismatch" ? ` (attendu: ${r.expected?.slice(0, 40)}..., trouve: ${r.got?.slice(0, 40)}...)` : ""}`).join("\n")}\n${result.verification ? `Verification post-apply :\n${result.verification.map((v) => `  - ${v.name} : ${v.ok ? "OK" : "KO"}\n${v.output.slice(-200)}`).join("\n")}` : ""}`;
      return { query: "apply tasks", projectName: await getProjectName(absProject), applyReport: report };
    }
  );

  registerTool(
    tools,
    "codebase_build",
    "Run and benchmark the project build (npm run build). Returns build time, output size, and files. Use when the user wants build performance, bundle size, or build issues.",
    {
      projectPath: { type: "string", description: "Absolute local path to the project folder. If omitted, the project root is auto-detected from the current working directory." },
      focus: { type: "string", description: "Optional focus." },
      lang: { type: "string", description: "Response language: 'fr' (default) or 'en'." }
    },
    (value) => buildBuildPrompt(value.context, value.projectName, value.query, value.lang),
    async (args, exec) => {
      const absProject = await resolveProjectPath(args.projectPath);
      const projectName = await getProjectName(absProject);
      const benchmark = await collectBuildBenchmark(absProject);
      const context = `=== BUILD BENCHMARK — ${(projectName ?? "").toUpperCase()} ===\nProject: ${absProject}\n\n${benchmark.ran ? `Durée: ${benchmark.duration}ms\nOK: ${benchmark.ok}\nDossier: ${benchmark.distInfo.path || "n/a"}\nTaille: ${benchmark.distInfo.size} octets\nFichiers:\n${benchmark.distInfo.files.map((f) => `- ${f.rel} (${f.size} o)`).join("\n")}\n\nLogs:\n${benchmark.summary}` : benchmark.reason}\n`;
      return { query: args.focus || "build benchmark", projectName, lang: args.lang || "fr", context };
    }
  );

  registerTool(
    tools,
    "codebase_git",
    "Analyze the git history of a project: recent commits, diff stats, and working tree. Use when the user asks about recent changes, changelog, or git activity.",
    {
      projectPath: { type: "string", description: "Absolute local path to the project folder. If omitted, the project root is auto-detected from the current working directory." },
      focus: { type: "string", description: "Optional focus." },
      lang: { type: "string", description: "Response language: 'fr' (default) or 'en'." }
    },
    (value) => buildGitPrompt(value.context, value.projectName, value.query, value.lang),
    async (args, exec) => {
      const absProject = await resolveProjectPath(args.projectPath);
      const projectName = await getProjectName(absProject);
      const git = await collectGitSummary(absProject);
      const context = `=== GIT INTELLIGENCE — ${(projectName ?? "").toUpperCase()} ===\nProject: ${absProject}\n\n== DERNIER COMMITS ==\n${git.log}\n\n== DIFF STAT ==\n${git.diff}\n\n== WORKING TREE ==\n${git.status || "propre"}\n`;
      return { query: args.focus || "git summary", projectName, lang: args.lang || "fr", context };
    }
  );

  registerTool(
    tools,
    "codebase_apply",
    "Apply a code patch to a file in the project. Provide the relative file path and the new file content. The tool checks the file stays within the project and is not protected, then writes it. Use with caution.",
    {
      projectPath: { type: "string", description: "Absolute local path to the project folder. If omitted, the project root is auto-detected from the current working directory." },
      filePath: { type: "string", description: "Relative path to the file to update." },
      newContent: { type: "string", description: "Complete new content for the file." },
      lang: { type: "string", description: "Response language: 'fr' (default) or 'en'." }
    },
    (value) => buildApplyPrompt(value.filePath, value.newContent, value.projectName, value.lang),
    async (args, exec) => {
      const absProject = await resolveProjectPath(args.projectPath);
      const projectName = await getProjectName(absProject);
      const result = await applyFilePatch(absProject, args.filePath, args.newContent);
      return { query: `apply ${args.filePath}`, projectName, context: `Fichier ${result.file} mis à jour avec succès.`, file: result.file, filePath: result.file, newContent: args.newContent, lang: args.lang || "fr" };
    }
  );

  registerTool(
    tools,
    "codebase_player",
    "Run a Player / UX playthrough brief on a codebase. Analyses the user journey, onboarding, friction, wow moments, and gamification opportunities. Use when the user wants a user-centric review, player perspective, UX walkthrough, or playtest of the app.",
    {
      projectPath: { type: "string", description: "Absolute local path to the project folder. If omitted, the project root is auto-detected from the current working directory." },
      focus: { type: "string", description: "Optional focus for the player brief (e.g. onboarding, checkout, first-run)." },
      lang: { type: "string", description: "Response language: 'fr' (default) or 'en'." }
    },
    (value) => buildPlayerPrompt(value.context, value.projectName, value.query, value.lang),
    async (args, exec) => {
      const absProject = await resolveProjectPath(args.projectPath);
      const projectName = await getProjectName(absProject);
      const { context } = await collectCodebaseContext(absProject, { focus: args.focus || "user journey and playthrough", lang: args.lang });
      return { query: args.focus || "player brief", projectName, lang: args.lang || "fr", context };
    }
  );

  async function runCommand(invocation, buildPromptFn, requireQuery = true) {
    const { rawInput, agent, signal } = invocation;
    let { projectPath, filePath, query, crea, creaTheme, lang } = parseCodebaseInput(rawInput.trim());
    if (requireQuery && !query && !projectPath) return { kind: "error", text: "Fournis une question/terme/cible ou un chemin de projet." };

    if (!query && projectPath) {
      query = "présente-moi ce projet de manière concise";
    }

    const { absProject, context } = await collectCodebaseContext(projectPath, { focus: query, filePath, searchQuery: query, lang });
    const projectName = await getProjectName(absProject);
    const prompt = buildPromptFn(query, context, projectName, crea, creaTheme, lang || "fr");
    await submitToAgent(ctx, agent?.sessionId ?? agent?.id, prompt, signal);
    return { kind: "success", text: "Analyse codebase lancee." };
  }

  commands.register({
    name: "codebase",
    description: "Poser une question sur le code source d'un projet. Le chemin peut etre passe directement : /codebase \"<chemin>\" [question]. /codebase <question> --project <chemin> [--file <fichier>] [--crea] [--crea-theme <theme>]",
    input: { hint: "question, --project <chemin>, --file <fichier>, --crea, --crea-theme <theme>" },
    async handler(invocation) {
      return runCommand(invocation, buildChatPrompt, true);
    }
  });

  commands.register({
    name: "codebase-search",
    description: "Rechercher un terme dans le codebase. /codebase-search <terme> --project <chemin> [--crea] [--crea-theme <theme>]",
    input: { hint: "terme, --project <chemin>, --crea, --crea-theme <theme>" },
    async handler(invocation) {
      return runCommand(invocation, buildSearchPrompt, true);
    }
  });

  commands.register({
    name: "codebase-explain",
    description: "Expliquer un fichier ou symbole. /codebase-explain <cible> --project <chemin> [--crea] [--crea-theme <theme>]",
    input: { hint: "cible, --project <chemin>, --crea, --crea-theme <theme>" },
    async handler(invocation) {
      return runCommand(invocation, buildExplainPrompt, true);
    }
  });

  commands.register({
    name: "codebase-refactor",
    description: "Refactoriser un fichier. /codebase-refactor '<description>' --file <fichier> --project <chemin> [--crea] [--crea-theme <theme>]",
    input: { hint: "description, --file <fichier>, --project <chemin>, --crea, --crea-theme <theme>" },
    async handler(invocation) {
      const { rawInput, agent, signal } = invocation;
      const { projectPath, filePath, query, crea, creaTheme, lang } = parseCodebaseInput(rawInput.trim());
      if (!query) return { kind: "error", text: "Decris ce qu'il faut refactoriser." };
      if (!filePath) return { kind: "error", text: "Fournis le fichier avec --file <fichier>." };
  
      const { absProject, context } = await collectCodebaseContext(projectPath, { focus: query, filePath, lang });
      const projectName = await getProjectName(absProject);
      const prompt = buildRefactorPrompt(filePath, query, context, projectName, crea, creaTheme, lang || "fr");
      await submitToAgent(ctx, agent?.sessionId ?? agent?.id, prompt, signal);
      return { kind: "success", text: "Refactor propose." };
    }
  });

  commands.register({
    name: "codebase-crea",
    description: "Générer un truc créatif à partir du codebase. /codebase-crea --project <chemin> [theme]",
    input: { hint: "theme optionnel, --project <chemin>" },
    async handler(invocation) {
      const { rawInput, agent, signal } = invocation;
      const { projectPath, query, lang } = parseCodebaseInput(rawInput.trim());
  
      const { absProject, context } = await collectCodebaseContext(projectPath, { focus: query || "creative output", lang });
      const projectName = await getProjectName(absProject);
      const prompt = buildCreaPrompt(query, context, projectName, lang || "fr");
      await submitToAgent(ctx, agent?.sessionId ?? agent?.id, prompt, signal);
      return { kind: "success", text: "Créa lancee." };
    }
  });

  commands.register({
    name: "codebase-health",
    description: "Analyse statique déterministe : dépendances circulaires, code mort, duplication, complexité, score de santé. /codebase-health --project <chemin> [--lang en|fr]",
    input: { hint: "--project <chemin>, --lang <en|fr>" },
    async handler(invocation) {
      if (!analyzeProject) return { kind: "error", text: "Module d'analyse statique indisponible (build dist manquant)." };
      const { rawInput } = invocation;
      const { projectPath, lang } = parseCodebaseInput(rawInput.trim());
      const absProject = await resolveProjectPath(projectPath);
      const report = await analyzeProject(absProject);
      return { kind: "success", text: formatHealthReport(report, lang === "en" ? "en" : "fr") };
    }
  });

  commands.register({
    name: "codebase-impact",
    description: "Analyse d'impact : quels fichiers dépendent de X (rayon d'impact). /codebase-impact <fichier> --project <chemin> [--lang en|fr]",
    input: { hint: "<fichier>, --project <chemin>, --lang <en|fr>" },
    async handler(invocation) {
      if (!analyzeImpact) return { kind: "error", text: "Module d'analyse statique indisponible (build dist manquant)." };
      const { rawInput } = invocation;
      const { projectPath, query, filePath, lang } = parseCodebaseInput(rawInput.trim());
      const file = (filePath || query || "").trim();
      if (!file) return { kind: "error", text: "Précise un fichier : /codebase-impact src/store.ts" };
      const absProject = await resolveProjectPath(projectPath);
      const r = await analyzeImpact(absProject, file);
      if (!r.ok) {
        const msg = r.candidates.length
          ? `Cible ambiguë "${file}" — candidats :\n  ${r.candidates.join("\n  ")}`
          : `Aucun fichier de code ne correspond à "${file}".`;
        return { kind: "error", text: msg };
      }
      return { kind: "success", text: formatImpactReport(r.report, lang === "en" ? "en" : "fr") };
    }
  });

  commands.register({
    name: "codebase-intel",
    description: "Brief d'Intelligence Pro : architecture, graphe de modules, data flow, risques, opportunités et créa. /codebase-intel --project <chemin> [focus] [--style <ouf|punchy|dense|pedagogique|minimal>]",
    input: { hint: "focus optionnel, --project <chemin>, --style <ouf|punchy|dense|pedagogique|minimal>" },
    async handler(invocation) {
      const { rawInput, agent, signal } = invocation;
      const { projectPath, query, style, lang } = parseCodebaseInput(rawInput.trim());
  
      const { absProject, context } = await collectIntelligenceContext(projectPath, query || "professional intelligence brief", lang || "fr");
      const projectName = await getProjectName(absProject);
      const prompt = buildIntelligencePrompt(context, projectName, query, style, lang || "fr");
      await submitToAgent(ctx, agent?.sessionId ?? agent?.id, prompt, signal);
      return { kind: "success", text: "Brief d'intelligence codebase lance." };
    }
  });

  commands.register({
    name: "codebase-audit",
    description: "Auditer les non-conformites, dette technique et erreurs. /codebase-audit --project <chemin> [focus]",
    input: { hint: "focus optionnel (security, types, console), --project <chemin>" },
    async handler(invocation) {
      const { rawInput, agent, signal } = invocation;
      const { projectPath, query, lang } = parseCodebaseInput(rawInput.trim());
  
      const { context, projectName } = await collectNonConformities(projectPath, query || "audit non-conformites", lang || "fr");
      const prompt = buildAuditPrompt(context, projectName, query, lang || "fr");
      await submitToAgent(ctx, agent?.sessionId ?? agent?.id, prompt, signal);
      return { kind: "success", text: "Audit non-conformites lance." };
    }
  });

  commands.register({
    name: "codebase-report",
    description: "Rapport strategique et constat professionnel. /codebase-report --project <chemin> [focus] [--style <ouf|punchy|dense|pedagogique|minimal>]",
    input: { hint: "focus optionnel, --project <chemin>, --style <ouf|punchy|dense|pedagogique|minimal>" },
    async handler(invocation) {
      const { rawInput, agent, signal } = invocation;
      const { projectPath, query, style, lang } = parseCodebaseInput(rawInput.trim());
  
      const { context, projectName } = await collectAssessmentContext(projectPath, query || "rapport strategique", lang || "fr");
      const prompt = buildReportPrompt(context, projectName, query, style, lang || "fr");
      await submitToAgent(ctx, agent?.sessionId ?? agent?.id, prompt, signal);
      return { kind: "success", text: "Rapport strategique lance." };
    }
  });

  commands.register({
    name: "codebase-tasks",
    description: "Générer un plan d'action TASKS.md. /codebase-tasks --project <chemin> [focus] [--style <ouf|punchy|dense|pedagogique|minimal>] [--raw]",
    input: { hint: "focus optionnel, --project <chemin>, --style <ouf|punchy|dense|pedagogique|minimal>" },
    async handler(invocation) {
      const { rawInput, agent, signal } = invocation;
      const { projectPath, query, style, raw, apply, dryRun, lang } = parseCodebaseInput(rawInput.trim());
  
      const { absProject, context, projectName, preTasks, metrics, constraints } = await collectTasksContext(projectPath, query || "plan d'action", lang || "fr");
      if (raw) {
        if (isProtectedPath(absProject)) return { kind: "error", text: "Ce chemin est protege. TASKS.md n'a pas ete ecrit." };
        const markdown = formatRawTasksMarkdown(projectName, metrics, constraints, preTasks, lang || "fr");
        const tasksPath = join(absProject, "TASKS.md");
        if (apply) {
          const result = await runApplyTasks(absProject, markdown, dryRun);
          const report = `Application des taches (dryRun=${dryRun}) :\n- ${result.message}\n- Fichiers touches : ${(result.touchedFiles || []).join(", ") || "aucun"}\n- Resultats detailles :\n${(result.results || []).map((r) => `  - ${r.id || r.file || ""} ligne ${r.line} : ${r.status}${r.status === "mismatch" ? ` (attendu: ${r.expected?.slice(0, 40)}..., trouve: ${r.got?.slice(0, 40)}...)` : ""}`).join("\n")}\n${result.verification ? `Verification post-apply :\n${result.verification.map((v) => `  - ${v.name} : ${v.ok ? "OK" : "KO"}\n${v.output.slice(-200)}`).join("\n")}` : ""}`;
          await submitToAgent(ctx, agent?.sessionId ?? agent?.id, report, signal);
          return { kind: "success", text: dryRun ? "Dry-run des taches termine." : "Application des taches terminee." };
        }
        await writeFile(tasksPath, markdown, "utf8");
        return { kind: "success", text: `TASKS.md brut genere : ${tasksPath}\n\n${markdown.slice(0, 2000)}\n\n[... tronque si necessaire ...]` };
      }
      const prompt = buildTasksPrompt(context, projectName, query, style, lang || "fr");
      await submitToAgent(ctx, agent?.sessionId ?? agent?.id, prompt, signal);
      return { kind: "success", text: "Plan d'action TASKS lance." };
    }
  });

  commands.register({
    name: "codebase-apply-tasks",
    description: "Appliquer le plan TASKS.md au projet. /codebase-apply-tasks --project <chemin> [--file <TASKS.md>] [--dry-run]",
    input: { hint: "--project <chemin>, --file <TASKS.md>, --dry-run" },
    async handler(invocation) {
      const { rawInput, agent, signal } = invocation;
      const { projectPath, filePath, dryRun } = parseCodebaseInput(rawInput.trim());
  
      const absProject = await resolveProjectPath(projectPath);
      const tasksPath = filePath ? resolve(join(absProject, filePath)) : join(absProject, "TASKS.md");
      const markdown = await safeReadText(tasksPath);
      if (!markdown) return { kind: "error", text: `TASKS.md introuvable : ${tasksPath}` };
      const result = await runApplyTasks(absProject, markdown, dryRun);
      const report = `Application des taches (dryRun=${dryRun}) :\n- ${result.message}\n- Fichiers touches : ${(result.touchedFiles || []).join(", ") || "aucun"}\n- Resultats detailles :\n${(result.results || []).map((r) => `  - ${r.id || r.file || ""} ligne ${r.line} : ${r.status}${r.status === "mismatch" ? ` (attendu: ${r.expected?.slice(0, 40)}..., trouve: ${r.got?.slice(0, 40)}...)` : ""}`).join("\n")}\n${result.verification ? `Verification post-apply :\n${result.verification.map((v) => `  - ${v.name} : ${v.ok ? "OK" : "KO"}\n${v.output.slice(-200)}`).join("\n")}` : ""}`;
      await submitToAgent(ctx, agent?.sessionId ?? agent?.id, report, signal);
      return { kind: "success", text: dryRun ? "Dry-run des taches termine." : "Application des taches terminee." };
    }
  });

  commands.register({
    name: "codebase-ceo",
    description: "One-Page CEO Brief ultra-percutant. /codebase-ceo --project <chemin> [focus]",
    input: { hint: "focus optionnel, --project <chemin>" },
    async handler(invocation) {
      const { rawInput, agent, signal } = invocation;
      const { projectPath, query, lang } = parseCodebaseInput(rawInput.trim());
  
      const { context, projectName } = await collectCeoContext(projectPath, query || "one page executive brief", lang || "fr");
      const prompt = buildCeoPrompt(context, projectName, query, lang || "fr");
      await submitToAgent(ctx, agent?.sessionId ?? agent?.id, prompt, signal);
      return { kind: "success", text: "One-Page CEO Brief lance." };
    }
  });

  commands.register({
    name: "codebase-build",
    description: "Benchmark du build. /codebase-build --project <chemin>",
    input: { hint: "--project <chemin>" },
    async handler(invocation) {
      const { rawInput, agent, signal } = invocation;
      const { projectPath, lang } = parseCodebaseInput(rawInput.trim());
  
      const absProject = await resolveProjectPath(projectPath);
      const projectName = await getProjectName(absProject);
      const benchmark = await collectBuildBenchmark(absProject);
      const context = `=== BUILD BENCHMARK — ${(projectName ?? "").toUpperCase()} ===\nProject: ${absProject}\n\n${benchmark.ran ? `Durée: ${benchmark.duration}ms\nOK: ${benchmark.ok}\nDossier: ${benchmark.distInfo.path || "n/a"}\nTaille: ${benchmark.distInfo.size} octets\nFichiers:\n${benchmark.distInfo.files.map((f) => `- ${f.rel} (${f.size} o)`).join("\n")}\n\nLogs:\n${benchmark.summary}` : benchmark.reason}\n`;
      const prompt = buildBuildPrompt(context, projectName, "", lang || "fr");
      await submitToAgent(ctx, agent?.sessionId ?? agent?.id, prompt, signal);
      return { kind: "success", text: "Benchmark build lance." };
    }
  });

  commands.register({
    name: "codebase-git",
    description: "Analyse git (commits, diff, working tree). /codebase-git --project <chemin>",
    input: { hint: "--project <chemin>" },
    async handler(invocation) {
      const { rawInput, agent, signal } = invocation;
      const { projectPath, lang } = parseCodebaseInput(rawInput.trim());
  
      const absProject = await resolveProjectPath(projectPath);
      const projectName = await getProjectName(absProject);
      const git = await collectGitSummary(absProject);
      const context = `=== GIT INTELLIGENCE — ${(projectName ?? "").toUpperCase()} ===\nProject: ${absProject}\n\n== DERNIER COMMITS ==\n${git.log}\n\n== DIFF STAT ==\n${git.diff}\n\n== WORKING TREE ==\n${git.status || "propre"}\n`;
      const prompt = buildGitPrompt(context, projectName, "", lang || "fr");
      await submitToAgent(ctx, agent?.sessionId ?? agent?.id, prompt, signal);
      return { kind: "success", text: "Analyse git lancee." };
    }
  });

  commands.register({
    name: "codebase-apply",
    description: "Appliquer un patch a un fichier. /codebase-apply <fichier> --content '<contenu>' --project <chemin>",
    input: { hint: "fichier, --content <contenu>, --project <chemin>" },
    async handler(invocation) {
      const { rawInput, agent, signal } = invocation;
      const { projectPath, filePath, query, content, lang } = parseCodebaseInput(rawInput.trim());
  
      if (!filePath) return { kind: "error", text: "Fournis le fichier avec --file <fichier>." };
      const newContent = content || query;
      if (!newContent) return { kind: "error", text: "Fournis le nouveau contenu avec --content '<contenu>'." };
      const absProject = await resolveProjectPath(projectPath);
      const projectName = await getProjectName(absProject);
      const result = await applyFilePatch(absProject, filePath, newContent);
      const prompt = buildApplyPrompt(result.file, newContent, projectName, lang || "fr");
      await submitToAgent(ctx, agent?.sessionId ?? agent?.id, prompt, signal);
      return { kind: "success", text: `Fichier ${result.file} mis a jour.` };
    }
  });

  commands.register({
    name: "codebase-player",
    description: "Player / UX playthrough brief. /codebase-player --project <chemin> [focus]",
    input: { hint: "focus optionnel (onboarding, checkout...), --project <chemin>" },
    async handler(invocation) {
      const { rawInput, agent, signal } = invocation;
      const { projectPath, query, lang } = parseCodebaseInput(rawInput.trim());
  
      const absProject = await resolveProjectPath(projectPath);
      const projectName = await getProjectName(absProject);
      const { context } = await collectCodebaseContext(absProject, { focus: query || "user journey and playthrough", lang });
      const prompt = buildPlayerPrompt(context, projectName, query, lang || "fr");
      await submitToAgent(ctx, agent?.sessionId ?? agent?.id, prompt, signal);
      return { kind: "success", text: "Player brief lance." };
    }
  });

  systemPrompt?.section?.({
    name: "codebase-chat",
    order: 130,
    text: `You have access to a powerful codebase plugin (dsh-codebase-chat v${VERSION}). When the user asks about code, files, project structure, architecture, how something works, where something is, or wants to search/explain/refactor/audit/report on code, use the appropriate tool: codebase_chat, codebase_search, codebase_explain, codebase_refactor, codebase_crea, codebase_intelligence, codebase_audit, codebase_report, codebase_ceo, codebase_tasks, codebase_build, codebase_git, codebase_apply, codebase_health, codebase_impact, or codebase_player. codebase_health runs a deterministic static analysis (circular deps, dead code, duplication, complexity, health score) and returns findings directly. codebase_impact computes the blast radius of a file — which files transitively depend on it — deterministic, no LLM — prefer it when the user asks for measurable code quality. codebase_intelligence is the premium auto-mode: it builds a structured context and asks for a professional, stylish intelligence brief. codebase_ceo is the one-page executive brief: metrics, score cards, top risks, top opportunities, SWOT, killer move, perfect for a board or investor. codebase_audit is the dedicated non-conformity and tech-debt auditor. codebase_report is the executive strategic report: a beautiful, visual, deep assessment (SWOT, score cards, 90-day roadmap, marketing) perfect for boards or clients. codebase_player is the UX / playthrough / player perspective brief: user journey, onboarding, friction, wow moments, gamification, and score cards from a user's point of view.\n\nIf the user asks for raw tasks, a TASKS.md with Avant/Après code blocks, or uses --raw, call codebase_tasks with raw=true. It writes TASKS.md directly in the project and returns the path/content. If the user asks to apply the plan, run the fixes, or says 'apply tasks', call codebase_apply_tasks. Use dryRun=true only if the user asks for a simulation or dry-run. If the user confirms or says 'apply', 'execute', 'yes', or 'oui', call with dryRun=false and apply the patches.\n\nIf no project path is given, first attempt to auto-detect the project root from the current working directory (cwd). Auto-detection walks up the tree looking for package.json, .git or tsconfig.json. Do NOT fall back to any known project (including the 'Dako' alias) unless the user explicitly mentions it. The only recognized alias is 'Dako' for the path 'D:\\Nouveau dossier'; use it only when the user explicitly says 'Dako' or uses --project Dako. If auto-detection fails and no explicit path is provided, ask the user for the path. Always answer in the same language as the user's message. If the user wants a creative idea at the end, set crea=true or use codebase_crea. Users may also use slash commands /codebase, /codebase-search, /codebase-explain, /codebase-refactor, /codebase-crea, /codebase-intel, /codebase-audit, /codebase-report, /codebase-ceo, /codebase-tasks, /codebase-tasks-raw, /codebase-apply-tasks, /codebase-build, /codebase-git, /codebase-apply, /codebase-impact, /codebase-player.`
  });

  function sameOrigin(req) {
    const host = req.headers.host;
    if (!host) return false;
    let candidate = req.headers.origin;
    if (!candidate) {
      candidate = req.headers.referer;
    }
    if (!candidate) {
      const site = req.headers["sec-fetch-site"];
      if (site === "same-origin") return true;
      return false;
    }
    try {
      const url = new URL(candidate);
      return url.host === host && (url.protocol === "http:" || url.protocol === "https:");
    } catch {
      return false;
    }
  }

  async function readJson(req, limit = 64 * 1024 * 1024) {
    const chunks = [];
    let size = 0;
    for await (const value of req) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      size += chunk.byteLength;
      if (size > limit) throw new Error("Request body is too large.");
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }

  function writeJson(res, body, status = 200) {
    const text = JSON.stringify(body);
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(text),
      "X-Content-Type-Options": "nosniff"
    });
    res.end(text);
  }

  function sessionExists(sessionId) {
    try {
      const sessions = ctx.get("sessions");
      if (sessions?.get(sessionId) !== void 0) return true;
    } catch { }
    try {
      const agents = ctx.get("agents");
      if (agents?.get(sessionId) !== void 0) return true;
    } catch { }
    return false;
  }

  async function buildRoutePrompt(body) {
    setProgressSession(body.sessionId);
    reportProgress(`Préparation du brief ${body.mode || "codebase"}...`);
    const projectPath = body.projectPath || "";
    const query = typeof body.query === "string" ? body.query : "";
    const filePath = typeof body.filePath === "string" ? body.filePath : "";
    const rawMode = typeof body.mode === "string" ? body.mode.toLowerCase() : "chat";
    const mode = {
      rapport: "report",
      intelligence: "intel",
      inteligence: "intel",
      tache: "tasks",
      taches: "tasks",
      task: "tasks",
      "tasks-raw": "tasks-raw",
      playthrough: "player",
      ux: "player",
      executive: "ceo",
      board: "ceo"
    }[rawMode] || rawMode;
    const rawStyle = typeof body.style === "string" ? body.style.toLowerCase() : "ouf";
    const style = { wow: "ouf", ouf: "ouf", best: "ouf" }[rawStyle] || rawStyle;
    const crea = body.crea === true || body.crea === "true";
    const creaTheme = typeof body.creaTheme === "string" ? body.creaTheme : "";
    const lang = typeof body.lang === "string" ? body.lang.toLowerCase() : "fr";
    const langHint = lang === "en" ? "Respond strictly in English." : "Réponds obligatoirement en français.";
    const finalBlock = lang === "en"
      ? "\n\n---\n\nFINAL INSTRUCTION (overrides everything above): The entire response, including section titles, bullet points and conclusion, MUST be written in English. Do not output any French words except in quoted code or file paths."
      : "\n\n---\n\nINSTRUCTION FINALE (prime sur tout le reste): La reponse entiere, titres de sections inclus, DOIT etre en francais. Ne produis aucun mot anglais sauf dans du code ou des chemins de fichiers cites.";
    const wrap = (prompt) => {
      const p = normalizeLabels(prompt, lang);
      return `${langHint}\n\n${p}${finalBlock}`;
    };

    if (mode === "intel") {
      const { absProject, context } = await collectIntelligenceContext(projectPath, query, lang);
      const projectName = await getProjectName(absProject);
      return wrap(buildIntelligencePrompt(context, projectName, query, style, lang));
    }
    if (mode === "report") {
      const { context, projectName } = await collectAssessmentContext(projectPath, query, lang);
      return wrap(buildReportPrompt(context, projectName, query, style, lang));
    }
    if (mode === "audit") {
      const { context, projectName } = await collectNonConformities(projectPath, query, lang);
      return wrap(buildAuditPrompt(context, projectName, query, lang));
    }
    if (mode === "tasks") {
      const { context, projectName } = await collectTasksContext(projectPath, query || "plan d'action", lang);
      return wrap(buildTasksPrompt(context, projectName, query, style, lang));
    }
    if (mode === "tasks-raw") {
      const { projectName, preTasks, metrics, constraints } = await collectTasksContext(projectPath, query || "plan d'action", lang);
      return wrap(formatRawTasksMarkdown(projectName, metrics, constraints, preTasks, lang));
    }
    if (mode === "ceo") {
      const { context, projectName } = await collectCeoContext(projectPath, query || "one page executive brief", lang);
      return wrap(buildCeoPrompt(context, projectName, query, lang));
    }
    if (mode === "player") {
      const absProject = await resolveProjectPath(projectPath);
      const projectName = await getProjectName(absProject);
      const { context } = await collectCodebaseContext(absProject, { focus: query || "user journey and playthrough", lang });
      return wrap(buildPlayerPrompt(context, projectName, query, lang));
    }
    const { absProject, context } = await collectCodebaseContext(projectPath, {
      focus: query,
      filePath: mode === "explain" || mode === "refactor" ? (query || filePath) : filePath,
      searchQuery: mode === "search" ? query : "",
      lang
    });
    const projectName = await getProjectName(absProject);

    if (mode === "crea") return wrap(buildCreaPrompt(query, context, projectName, lang));
    if (mode === "search") return wrap(buildSearchPrompt(query, context, projectName, crea, creaTheme, lang));
    if (mode === "explain") return wrap(buildExplainPrompt(query || filePath, context, projectName, crea, creaTheme, lang));
    if (mode === "refactor") return wrap(buildRefactorPrompt(filePath || query, query, context, projectName, crea, creaTheme, lang));
    reportProgress("Brief prêt, envoi à l'agent...");
    return wrap(buildChatPrompt(query, context, projectName, crea, creaTheme, lang));
  }

  async function buildPreview(projectPath) {
    const absProject = await resolveProjectPath(projectPath);
    const projectName = await getProjectName(absProject);
    const summary = await getPackageSummary(absProject);
    const metrics = await collectMetrics(absProject);
    return {
      name: projectName,
      path: absProject,
      summary,
      files: metrics.files,
      sourceFiles: metrics.sourceFiles,
      codeLines: metrics.codeLines,
      testFiles: metrics.testFiles,
      languages: metrics.languages
    };
  }

  function registerRoutes(webServer) {
    webServer.register({
      kind: "exact",
      path: "/codebase-chat/progress",
      async handler(req, res) {
        try {
          if (req.method !== "GET") {
            writeJson(res, { ok: false, error: "Method not allowed" }, 405);
            return;
          }
          if (!sameOrigin(req)) {
            writeJson(res, { ok: false, error: "Same-origin request required" }, 403);
            return;
          }
          const url = new URL(req.url, `http://${req.headers.host}`);
          const sessionId = url.searchParams.get("sessionId");
          if (!sessionId || !sessionExists(sessionId)) {
            writeJson(res, { ok: false, error: "Session not found" }, 404);
            return;
          }
          const messages = (progressStore.get(sessionId) || []).map((m) => m.message);
          writeJson(res, { ok: true, messages });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          writeJson(res, { ok: false, error: message }, 500);
        }
      }
    });
    webServer.register({
      kind: "exact",
      path: "/codebase-chat/ask",
      async handler(req, res) {
        try {
          if (req.method !== "POST") {
            writeJson(res, { ok: false, error: "Method not allowed" }, 405);
            return;
          }
          if (!sameOrigin(req)) {
            writeJson(res, { ok: false, error: "Same-origin request required" }, 403);
            return;
          }
          const body = await readJson(req);
          const sessionId = body.sessionId;
          if (!sessionId || !sessionExists(sessionId)) {
            writeJson(res, { ok: false, error: "Session not found" }, 404);
            return;
          }
          const prompt = await buildRoutePrompt(body);
          await submitToAgent(ctx, sessionId, prompt, void 0);
          writeJson(res, { ok: true });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (res.headersSent) return;
          const known = ["Session not found", "Aucune session active", "Ce chemin est protege", "Le chemin n'est pas un dossier", "Chemin du projet manquant", "Aucun projet detecte"];
          const status = known.some((k) => message.includes(k)) ? 400 : 500;
          writeJson(res, { ok: false, error: message }, status);
        }
      }
    });
    webServer.register({
      kind: "exact",
      path: "/codebase-chat/preview",
      async handler(req, res) {
        try {
          if (req.method !== "POST") {
            writeJson(res, { ok: false, error: "Method not allowed" }, 405);
            return;
          }
          if (!sameOrigin(req)) {
            writeJson(res, { ok: false, error: "Same-origin request required" }, 403);
            return;
          }
          const body = await readJson(req);
          if (!body.projectPath) {
            writeJson(res, { ok: true, empty: true });
            return;
          }
          const preview = await buildPreview(body.projectPath);
          writeJson(res, { ok: true, ...preview });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const known = ["Ce chemin est protege", "Le chemin n'est pas un dossier", "Aucun projet detecte"];
          const status = known.some((k) => message.includes(k)) ? 400 : 500;
          writeJson(res, { ok: false, error: message }, status);
        }
      }
    });
  }

  const webServer = ctx.get("webServer");
  if (webServer !== void 0) {
    registerRoutes(webServer);
  } else {
    ctx.inject(["webServer"], (scoped) => registerRoutes(scoped.webServer));
  }
}

export {
  apply,
  inject,
  name,
  normalizeLabels,
  resolveProjectPath,
  getProjectName,
  findProjectRoot,
  getPackageSummary,
  collectMetrics,
  collectCodebaseContext,
  collectIntelligenceContext,
  collectAssessmentContext,
  collectNonConformities,
  collectCeoContext,
  collectTasksContext,
  buildChatPrompt,
  buildSearchPrompt,
  buildExplainPrompt,
  buildRefactorPrompt,
  buildCreaPrompt,
  buildIntelligencePrompt,
  buildAuditPrompt,
  buildReportPrompt,
  buildTasksPrompt,
  buildCeoPrompt,
  buildBuildPrompt,
  buildPlayerPrompt,
  buildGitPrompt,
  buildApplyPrompt,
  formatRawTasksMarkdown,
  parseRawTasksMarkdown,
  computePatch,
  parseCodebaseInput,
  reportProgress,
  setProgressSession,
  langInstruction,
  styleInstruction,
  bannerInstruction,
  citationInstruction
};
