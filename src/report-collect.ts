// Code-shape / graph collectors + collectAudit orchestrator.
// All deterministic computations — no rendering, no language.
import { access, readFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { getIndex } from './indexer.js';
import { findProjectRoot, resolveProjectPath } from './project.js';
import { analyzeGraph, collectImportGraph, isSkippablePath, isTestPath, lineStartsInString, looksLikeEntry, projectSignature } from './analysis.js';
import { scanCode, SMELL_PATS, SEC_PATS } from './report-scan.js';
import { commitQuality, gitActivity } from './report-git.js';
import { brokenPkgEntries, configAudit, envAudit, importedPackages, lockfileDrift, missingDeps, readmeAudit, unusedDeps } from './report-deps.js';
import type { AuditData, Finding } from './report-types.js';

const EXT_LANG: Record<string, string> = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript (React)', '.js': 'JavaScript', '.jsx': 'JavaScript (React)',
  '.mjs': 'JavaScript (ESM)', '.cjs': 'JavaScript (CJS)', '.py': 'Python', '.rs': 'Rust',
  '.go': 'Go', '.java': 'Java', '.kt': 'Kotlin', '.rb': 'Ruby', '.php': 'PHP',
  '.c': 'C', '.h': 'C/C++', '.cpp': 'C++', '.cs': 'C#', '.swift': 'Swift',
  '.vue': 'Vue', '.svelte': 'Svelte', '.dart': 'Dart', '.lua': 'Lua',
};

/** Longest functions/methods from tree-sitter chunks. */
function functionHotspots(index: { files: Record<string, { relPath: string; chunks: { kind: string; name?: string; startLine: number; endLine: number }[] }> }) {
  const out: { file: string; name: string; lines: number }[] = [];
  for (const f of Object.values(index.files)) {
    if (isSkippablePath(f.relPath)) continue;
    for (const c of f.chunks) {
      if ((c.kind === 'function' || c.kind === 'method' || c.kind === 'class') && c.name)
        out.push({ file: f.relPath, name: c.name, lines: c.endLine - c.startLine + 1 });
    }
  }
  return out.sort((a, b) => b.lines - a.lines).slice(0, 6);
}

/** Deep relative imports (../../.. chains) — coupling smell. */
function deepImports(fileTexts: Map<string, string>): Finding[] {
  const out: Finding[] = [];
  const re = /from\s+['"]((?:\.\.\/){3,}[^'"]*)['"]/;
  for (const [file, text] of fileTexts) {
    if (isTestPath(file)) continue;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(re);
      if (m) out.push({ file, line: i + 1, sample: m[1] });
    }
  }
  return out.slice(0, 8);
}

/** Max indentation depth + comment density per file. */
function codeShape(fileTexts: Map<string, string>) {
  let commentLines = 0, codeLines = 0;
  const deepNest: { file: string; depth: number }[] = [];
  for (const [file, text] of fileTexts) {
    if (isSkippablePath(file)) continue;
    let maxDepth = 0, inBlock = false;
    // Lines inside template literals (help text, HTML, embedded SQL…) are not
    // code — their indentation must not count toward nesting depth.
    const startsInStr = lineStartsInString(text);
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const t = line.trim();
      if (!t) continue;
      codeLines++;
      if (inBlock) { commentLines++; if (t.includes('*/')) inBlock = false; continue; }
      if (t.startsWith('//') || t.startsWith('*')) { commentLines++; continue; }
      if (t.startsWith('/*')) { commentLines++; if (!t.includes('*/')) inBlock = true; continue; }
      if (startsInStr[i]) continue;
      const indent = line.match(/^[\t ]*/)![0];
      const depth = indent.replace(/\t/g, '    ').length / 4;
      if (depth > maxDepth) maxDepth = depth;
    }
    if (maxDepth >= 6) deepNest.push({ file, depth: Math.round(maxDepth) });
  }
  return { commentPct: codeLines ? Math.round((commentLines / codeLines) * 100) : 0, deepNest: deepNest.sort((a, b) => b.depth - a.depth).slice(0, 5) };
}

/** Cyclomatic-ish complexity per function chunk (branches inside the body). */
function functionComplexity(index: { files: Record<string, { relPath: string; chunks: { kind: string; name?: string; content: string }[] }> }) {
  const BRANCH = /\b(if|for|while|case|catch)\b|&&|\|\||\?/g;
  const out: { file: string; name: string; score: number }[] = [];
  for (const f of Object.values(index.files)) {
    if (isSkippablePath(f.relPath)) continue;
    for (const c of f.chunks) {
      if ((c.kind === 'function' || c.kind === 'method') && c.name)
        out.push({ file: f.relPath, name: c.name, score: (c.content.match(BRANCH) ?? []).length });
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 6);
}

/** Same basename in multiple directories → confusion. */
function duplicateNames(codeFiles: string[]): { name: string; files: string[] }[] {
  const byName = new Map<string, string[]>();
  for (const f of codeFiles) {
    const b = basename(f).toLowerCase();
    (byName.get(b) ?? byName.set(b, []).get(b)!).push(f);
  }
  return [...byName.entries()]
    .filter(([n, fs]) => fs.length > 1 && !/^(index|types?|constants?|config)\./.test(n))
    .map(([name, files]) => ({ name, files }))
    .slice(0, 5);
}

/** async functions containing no await — almost always a bug. */
function asyncWithoutAwait(index: { files: Record<string, { relPath: string; chunks: { kind: string; name?: string; content: string }[] }> }) {
  const out: { file: string; name: string }[] = [];
  for (const f of Object.values(index.files)) {
    if (isSkippablePath(f.relPath)) continue;
    for (const c of f.chunks) {
      if ((c.kind === 'function' || c.kind === 'method') && c.name
        && /\basync\b/.test(c.content.split('\n')[0]) && !/\bawait\b/.test(c.content))
        out.push({ file: f.relPath, name: c.name });
    }
  }
  return out.slice(0, 6);
}

/** Longest dependency chains in the import graph. */
function graphDepth(edges: { from: string; to: string }[], entryPoints: string[]): number {
  const adj = new Map<string, string[]>();
  for (const e of edges) (adj.get(e.from) ?? adj.set(e.from, []).get(e.from)!).push(e.to);
  let max = 0;
  const memo = new Map<string, number>();
  const dfs = (f: string, seen: Set<string>): number => {
    if (memo.has(f)) return memo.get(f)!;
    if (seen.has(f)) return 0; // cycle — stop
    seen.add(f);
    let d = 0;
    for (const t of adj.get(f) ?? []) d = Math.max(d, dfs(t, seen) + 1);
    seen.delete(f);
    memo.set(f, d);
    return d;
  };
  for (const e of entryPoints) max = Math.max(max, dfs(e, new Set()));
  return max;
}

/** Docstring coverage: exported declarations preceded by a comment line. */
function docCoverage(fileTexts: Map<string, string>): { documented: number; total: number } {
  let documented = 0, total = 0;
  const EXPORT_LINE = /^\s*export\s+(?:async\s+)?(?:function|class|const|let|interface|type|enum|default)\b/;
  for (const [file, text] of fileTexts) {
    if (isSkippablePath(file)) continue;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!EXPORT_LINE.test(lines[i])) continue;
      total++;
      let j = i - 1;
      while (j >= 0 && !lines[j].trim()) j--;
      if (j >= 0 && /^\s*(\/\/|\/\*|\*)/.test(lines[j])) documented++;
    }
  }
  return { documented, total };
}

/** Infra/config presence from indexed paths. */
function detectInfra(indexPaths: Set<string>): string[] {
  const found: string[] = [];
  const has = (p: string) => indexPaths.has(p) || [...indexPaths].some(f => f.startsWith(p));
  if (has('.github/workflows')) found.push('CI (GitHub Actions)');
  if (has('dockerfile') || has('docker-compose.yml')) found.push('Docker');
  if (has('tsconfig.json')) found.push('TypeScript config');
  if (has('pnpm-lock.yaml') || has('package-lock.json') || has('yarn.lock')) found.push('lockfile');
  if (has('vitest.config') || has('jest.config')) found.push('test runner config');
  if (has('.env.example') || has('.env.sample')) found.push('.env template');
  if (has('dockerfile')) found.push('container');
  if (has('vercel.json') || has('netlify.toml')) found.push('deploy config');
  if (has('eslint.config') || has('.eslintrc')) found.push('linter config');
  if (has('.prettierrc') || has('prettier.config')) found.push('formatter config');
  return [...new Set(found)];
}

/** True when a file has a dedicated test file (foo.ts ↔ foo.test.ts / foo.spec.ts). */
export function hasDedicatedTest(testBases: Set<string>, file: string): boolean {
  return testBases.has(basename(file).replace(/\.[^.]+$/, '').toLowerCase());
}

// Repeat calls from long-lived processes (MCP server, dashboard, DSH plugin)
// memoize on the file-set signature — same files ⇒ same audit. The 10s TTL
// covers what stats can't see (a new git commit, a regenerated file).
const AUDIT_TTL_MS = 10_000;
const auditCache = new Map<string, { sig: string; at: number; data: AuditData }>();

/** All deterministic audit computations — no rendering, no language. */
export async function collectAudit(projectPath: string): Promise<AuditData> {
  const abs = await findProjectRoot(resolveProjectPath(projectPath));
  const sig = await projectSignature(abs);
  const hit = auditCache.get(abs);
  if (hit && hit.sig === sig && Date.now() - hit.at < AUDIT_TTL_MS) return hit.data;
  const [index, graph] = await Promise.all([
    getIndex(abs),
    collectImportGraph(abs),
  ]);
  const health = await analyzeGraph(graph);
  const name = basename(health.projectPath);

  let pkg: Record<string, any> = {};
  try { pkg = JSON.parse(await readFile(join(health.projectPath, 'package.json'), 'utf8')); } catch {}

  // --- Stack ------------------------------------------------------------
  const langCount = new Map<string, number>();
  for (const rel of Object.keys(index.files)) {
    const l = EXT_LANG[extname(rel).toLowerCase()];
    if (!l) continue; // docs/config files aren't code languages
    langCount.set(l, (langCount.get(l) ?? 0) + 1);
  }
  const langs = [...langCount.entries()].sort((a, b) => b[1] - a[1]);
  const deps = Object.keys(pkg.dependencies ?? {});
  const devDeps = Object.keys(pkg.devDependencies ?? {});
  const scripts = Object.keys(pkg.scripts ?? {});

  // --- Modules, smells, security -------------------------------------------
  const symbols = Object.values(index.files).reduce((s, f) => s + f.chunks.filter(c => c.name).length, 0);
  const hubs = [...graph.inDegree.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const entryPoints = graph.codeFiles.filter(f => looksLikeEntry(f, pkg)).slice(0, 10);
  const leaves = graph.codeFiles.filter(f => !graph.edges.some(e => e.from === f)).length;
  const testFiles = Object.keys(index.files).filter(isTestPath);
  const srcFiles = graph.codeFiles.filter(f => !isTestPath(f));
  const testRatio = srcFiles.length ? Math.round((testFiles.length / srcFiles.length) * 100) : 0;
  const largest = graph.codeFiles
    .map(f => ({ f, lines: graph.fileTexts.get(f)!.split('\n').length }))
    .sort((a, b) => b.lines - a.lines).slice(0, 5);
  const indexPaths = new Set(Object.keys(index.files).map(f => f.toLowerCase()));
  const docs = ['readme.md', 'license', 'license.md', 'changelog.md', 'contributing.md', 'security.md', 'agents.md']
    .filter(d => indexPaths.has(d));
  const smells = scanCode(graph.fileTexts, SMELL_PATS, 3, { skipStrings: true, skipCommentsExcept: new Set(['todo', 'tsIgnore']) });
  const secTotals: Record<string, number> = {};
  const sec = scanCode(graph.fileTexts, SEC_PATS, 5, { skipComments: true, totals: secTotals });
  const hasTests = testFiles.length > 0;
  const git = await gitActivity(health.projectPath);
  const infra = detectInfra(indexPaths);
  const env = await envAudit(health.projectPath, graph.fileTexts);
  const imported = importedPackages(graph.fileTexts);
  const deadDeps = unusedDeps(deps, imported, pkg, graph.fileTexts);
  const missing = await missingDeps(health.projectPath, graph.fileTexts, pkg, indexPaths);
  const lockDrift = await lockfileDrift(health.projectPath, deps);
  const fnComplex = functionComplexity(index);
  const dupNames = duplicateNames(graph.codeFiles);
  const asyncNoAwait = asyncWithoutAwait(index);
  const maxDepth = graphDepth(graph.edges, entryPoints);
  const cfg = await configAudit(health.projectPath, pkg, indexPaths, !!git);
  const longFns = functionHotspots(index);
  const brokenEntries = await brokenPkgEntries(health.projectPath, pkg);
  const deepRel = deepImports(graph.fileTexts);
  const shape = codeShape(graph.fileTexts);
  const readme = await readmeAudit(health.projectPath);
  const commitQ = git ? commitQuality(git.subjects) : null;
  const typedFiles = graph.codeFiles.filter(f => /\.(ts|tsx)$/.test(f)).length;
  const typedPct = graph.codeFiles.length ? Math.round((typedFiles / graph.codeFiles.length) * 100) : 0;
  // Stale hubs: heavily imported files not touched in the longest time.
  const staleHubs = git
    ? hubs.filter(([f]) => git.fileLastCommit.has(f))
        .map(([f, n]) => ({ f, n, last: git.fileLastCommit.get(f)! }))
        .sort((a, b) => a.last.localeCompare(b.last))
        .slice(0, 5)
    : [];
  const testBases = new Set(testFiles.map(f => basename(f).replace(/\.(test|spec)\.[^.]+$/i, '').toLowerCase()));
  const sensitive = [...(git?.sensitiveTracked ?? [])];
  if (!git) { // no git → check the working tree directly
    for (const rel of ['.env', '.env.local', '.env.production']) {
      try { await access(join(health.projectPath, rel)); sensitive.push(rel); } catch {}
    }
  }
  const docCov = docCoverage(graph.fileTexts);
  const docPct = docCov.total ? Math.round((docCov.documented / docCov.total) * 100) : 0;
  // Risk = churn × complexity — files that change often AND are hard to read.
  const complexityByFile = new Map(health.hotspots.map(h => [h.file, h.score]));
  const riskFiles = git
    ? [...git.churn.entries()]
        .filter(([f]) => complexityByFile.has(f))
        .map(([file, churn]) => ({ file, churn, commits: git.fileCommits.get(file) ?? 0, score: complexityByFile.get(file)! }))
        .sort((a, b) => b.churn * b.score - a.churn * a.score)
        .slice(0, 5)
    : [];
  const untestedRisk = riskFiles.filter(r => !hasDedicatedTest(testBases, r.file));
  const topChurn = git
    ? [...git.churn.entries()]
        .filter(([f]) => !/lock|\.min\.|dist\/|generated/i.test(f))
        .sort((a, b) => b[1] - a[1]).slice(0, 8)
    : [];

  const data = { index, graph, health, name, pkg, langs, deps, devDeps, scripts, symbols, hubs, entryPoints, leaves, testFiles, srcFiles, testRatio, largest, docs, smells, sec, secTotals, hasTests, git, infra, env, deadDeps, missing, lockDrift, fnComplex, dupNames, asyncNoAwait, maxDepth, cfg, longFns, brokenEntries, deepRel, shape, readme, commitQ, typedFiles, typedPct, staleHubs, sensitive, docCov, docPct, riskFiles, untestedRisk, testBases, topChurn };
  auditCache.set(graph.abs, { sig, at: Date.now(), data });
  return data;
}
