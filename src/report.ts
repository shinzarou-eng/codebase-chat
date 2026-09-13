// Deterministic full report — a complete structured audit built purely from
// static analysis: index stats, import graph, package manifest, health report.
// Zero LLM, zero network — same project in → same report out.
import { access, readFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getIndex } from './indexer.js';
import { analyzeProject, collectImportGraph, formatHealthReportMd, insideString, lineStartsInString, looksLikeEntry } from './analysis.js';
import { recommendations } from './recommendations.js';
import type { Reco } from './recommendations.js';

const run = promisify(execFile);

const EXT_LANG: Record<string, string> = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript (React)', '.js': 'JavaScript', '.jsx': 'JavaScript (React)',
  '.mjs': 'JavaScript (ESM)', '.cjs': 'JavaScript (CJS)', '.py': 'Python', '.rs': 'Rust',
  '.go': 'Go', '.java': 'Java', '.kt': 'Kotlin', '.rb': 'Ruby', '.php': 'PHP',
  '.c': 'C', '.h': 'C/C++', '.cpp': 'C++', '.cs': 'C#', '.swift': 'Swift',
  '.vue': 'Vue', '.svelte': 'Svelte', '.dart': 'Dart', '.lua': 'Lua',
};

function bar(score: number): string {
  const filled = Math.round(score / 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

// --- Deterministic smell & security scan ---------------------------------
// Every finding is a real file:line hit — grep-grade evidence, no guessing.

export type { Finding, SmellScan, GitStats } from './report-types.js';
import type { AuditData, Finding, SmellScan, GitStats } from './report-types.js';

const SMELL_PATS: [string, RegExp][] = [
  // The (?:) no-ops keep this pattern table from matching its own source.
  ['todo', /\b(?:TOD(?:)O|FIXM(?:)E|HAC(?:)K|XX(?:)X|WI(?:)P)\b/],
  ['console', /\bconsole\.(log|warn|error|debug|info)\s*\(/],
  ['tsIgnore', /@ts-(ignore|expect-error|nocheck)\b/],
  ['any', /:\s*any\b/],
  ['emptyCatch', /catch\s*\([^)]*\)\s*\{\s*\}/],
  ['debugger', /\bdebugger\s*;/],
  ['syncIo', /\b(readFileSync|writeFileSync|appendFileSync|readdirSync|mkdirSync|execSync)\s*\(/],
];

const SEC_PATS: [string, RegExp][] = [
  ['secret', /(?:api[_-]?key|secret|passwd|password|token|private[_-]?key)\s*[:=]\s*['"`][A-Za-z0-9_\/+\-.]{8,}['"`]/i],
  ['eval', /\beval\s*\(|new\s+Function\s*\(/],
  // Only shell-string execution is a risky sink — exec/execSync take a shell
  // string, and spawn*/execFile* with `shell: true` opt into a shell too.
  // spawn(cmd, args[]) and execFile are the safe array-arg APIs.
  ['exec', /(?<![.\w$])exec(?:Sync)?\s*\((?!\?)|shell\s*:\s*true/],
  ['innerHTML', /\.innerHTML\s*=/],
  ['unsafeRegex', /new\s+RegExp\s*\([^'"`]/],
];

export function scanCode(
  fileTexts: Map<string, string>, pats: [string, RegExp][], perFileCap = 3,
  opts: { skipComments?: boolean; skipStrings?: boolean; totals?: Record<string, number> } = {},
): SmellScan {
  const out: SmellScan = {};
  for (const [file, text] of fileTexts) {
    if (/test|spec|__tests__|\.d\.ts$/i.test(file)) continue; // tests legitimately console/TODO
    // CLI entry points and helper scripts print to stdout on purpose, and sync
    // IO is fine there too — console.*/readFileSync are their interface.
    const isCli = /^#!/m.test(text) || /\bprocess\.argv\b/.test(text) || /(^|\/)scripts?\//.test(file);
    const lines = text.split('\n');
    const startsInStr = opts.skipStrings ? lineStartsInString(text) : [];
    for (const [key, re] of pats) {
      if (isCli && (key === 'console' || key === 'syncIo')) continue;
      let found = 0;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        // Comments mentioning `shell: true` or `eval(` are not sinks.
        if (opts.skipComments && (/^\/\//.test(line) || /^\* /.test(line) || /^\/\*/.test(line))) continue;
        // Smell patterns inside string literals are prompt text / fixtures —
        // but security patterns keep strings (secrets and generated code
        // like `out.innerHTML = ...` in a template live inside them).
        const m = re.exec(lines[i]);
        if (!m) continue;
        if (opts.skipStrings && (startsInStr[i] || insideString(lines[i], m.index))) continue;
        if (opts.totals) opts.totals[key] = (opts.totals[key] ?? 0) + 1;
        if (found >= perFileCap) continue;
        (out[key] ??= []).push({ file, line: i + 1, sample: line.slice(0, 90) });
        found++;
      }
    }
  }
  return out;
}

function countHits(scan: SmellScan): number {
  return Object.values(scan).reduce((s, f) => s + f.length, 0);
}

// --- Git activity (local, deterministic — no network) ----------------------

const SENSITIVE_PATS = /(^|\/)\.env$|(^|\/)\.env\.(local|prod|production|dev|development)$|\.(pem|key|p12|pfx|keystore)$|id_rsa|id_ed25519|credentials\.json|service-account/i;

async function gitActivity(abs: string): Promise<GitStats | null> {
  try {
    const { stdout } = await run('git', [
      '-C', abs, 'log', '--numstat', '--format=@@@%an|%ad|%s', '--date=short', '-n', '400',
    ], { maxBuffer: 32 * 1024 * 1024 });
    const stats: GitStats = { commits: 0, authors: new Map(), lastDate: '', churn: new Map(), fileCommits: new Map(), fileAuthors: new Map(), months: new Map(), sensitiveTracked: [], fileLastCommit: new Map(), subjects: [], commitSizes: [] };
    let author = '';
    let date = '';
    let curFiles = 0, curLines = 0;
    const flush = () => { if (curFiles || curLines) stats.commitSizes.push({ files: curFiles, lines: curLines }); curFiles = 0; curLines = 0; };
    for (const line of stdout.split('\n')) {
      if (line.startsWith('@@@')) {
        flush();
        stats.commits++;
        const [a, d, s] = line.slice(3).split('|');
        author = a;
        date = d;
        if (s) stats.subjects.push(s);
        if (!stats.lastDate) stats.lastDate = d;
        stats.authors.set(a, (stats.authors.get(a) ?? 0) + 1);
        const month = d.slice(0, 7);
        stats.months.set(month, (stats.months.get(month) ?? 0) + 1);
        continue;
      }
      const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
      if (!m || m[1] === '-') continue; // binary
      const file = m[3].replace(/\\/g, '/');
      const delta = Number(m[1]) + Number(m[2]);
      curFiles++;
      curLines += delta;
      stats.churn.set(file, (stats.churn.get(file) ?? 0) + delta);
      stats.fileCommits.set(file, (stats.fileCommits.get(file) ?? 0) + 1);
      if (!stats.fileLastCommit.has(file) && date) stats.fileLastCommit.set(file, date);
      if (author) (stats.fileAuthors.get(file) ?? stats.fileAuthors.set(file, new Set()).get(file)!).add(author);
    }
    flush();
    try {
      const { stdout: tracked } = await run('git', ['-C', abs, 'ls-files'], { maxBuffer: 8 * 1024 * 1024 });
      stats.sensitiveTracked = tracked.split('\n').map(l => l.trim()).filter(f => f && SENSITIVE_PATS.test(f));
    } catch { /* ls-files failed — leave empty */ }
    return stats;
  } catch {
    return null; // not a git repo / no git
  }
}

// --- Env / deps / config audit --------------------------------------------

const SYSTEM_ENV = new Set([
  'PATH', 'PATHEXT', 'HOME', 'HOMEPATH', 'USERPROFILE', 'USERNAME', 'USER', 'APPDATA', 'LOCALAPPDATA',
  'TEMP', 'TMP', 'TMPDIR', 'OS', 'COMSPEC', 'SYSTEMROOT', 'WINDIR', 'PROGRAMFILES', 'PROGRAMDATA',
  'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'SHELL', 'TERM', 'PWD', 'OLDPWD', 'HOME',
  'LANG', 'LC_ALL', 'TZ', 'NODE_ENV', 'NODE_PATH', 'npm_config_cache', 'CI', 'HOSTNAME',
]);

/** Env vars referenced in code vs declared in .env.example/.env.sample. */
async function envAudit(abs: string, fileTexts: Map<string, string>) {
  const used = new Set<string>();
  for (const [file, text] of fileTexts) {
    if (/test|spec|__tests__/i.test(file)) continue;
    for (const m of text.matchAll(/\bprocess\.env\.([A-Z_][A-Z0-9_]*)/g)) used.add(m[1]);
    for (const m of text.matchAll(/\bimport\.meta\.env\.([A-Z_][A-Z0-9_]*)/g)) used.add(m[1]);
  }
  const declared = new Set<string>();
  for (const envFile of ['.env.example', '.env.sample', '.env.template']) {
    try {
      const text = await readFile(join(abs, envFile), 'utf8');
      for (const m of text.matchAll(/^\s*([A-Z_][A-Z0-9_]*)\s*=/gm)) declared.add(m[1]);
    } catch {}
  }
  const projectVars = [...used].filter(v => !SYSTEM_ENV.has(v));
  const undocumented = projectVars.filter(v => !declared.has(v)).sort();
  return { used: projectVars.sort(), undocumented, hasTemplate: declared.size > 0 };
}

/** package.json dependencies never imported anywhere in the codebase. */
function unusedDeps(deps: string[], imported: Set<string>, pkg: Record<string, any>, fileTexts: Map<string, string>): string[] {
  // Deps invoked as CLIs in npm scripts (tsup, vitest) or resolved by path
  // (require.resolve, wasm assets) are used even without a static import.
  const scripts = Object.values(pkg?.scripts ?? {}).join('\n');
  return deps.filter(d => {
    if ([...imported].some(i => pkgRoot(i) === d)) return false;
    if (new RegExp(`\\b${d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(scripts)) return false;
    for (const text of fileTexts.values()) {
      if (text.includes(`'${d}`) || text.includes(`"${d}`) || text.includes(`\`${d}`)) return false;
    }
    return true;
  });
}

/** Config hygiene: tsconfig strict, .gitignore, package.json completeness. */
async function configAudit(abs: string, pkg: Record<string, any>, _indexPaths: Set<string>, isGit: boolean) {
  let tsStrict: boolean | null = null;
  let gitignore = false;
  try {
    const raw = await readFile(join(abs, 'tsconfig.json'), 'utf8');
    const clean = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    tsStrict = JSON.parse(clean)?.compilerOptions?.strict === true;
  } catch {}
  try { await access(join(abs, '.gitignore')); gitignore = true; } catch {}
  const pkgMissing = ['license', 'repository', 'engines'].filter(k => !pkg[k]);
  return { tsStrict, gitignore, pkgMissing, isGit };
}

/** Longest functions/methods from tree-sitter chunks. */
function functionHotspots(index: { files: Record<string, { relPath: string; chunks: { kind: string; name?: string; startLine: number; endLine: number }[] }> }) {
  const out: { file: string; name: string; lines: number }[] = [];
  for (const f of Object.values(index.files)) {
    if (/test|spec|__tests__|\.d\.ts$/i.test(f.relPath)) continue;
    for (const c of f.chunks) {
      if ((c.kind === 'function' || c.kind === 'method' || c.kind === 'class') && c.name)
        out.push({ file: f.relPath, name: c.name, lines: c.endLine - c.startLine + 1 });
    }
  }
  return out.sort((a, b) => b.lines - a.lines).slice(0, 6);
}

/** package.json entry points (bin/main/exports) that don't exist on disk. */
async function brokenPkgEntries(abs: string, pkg: Record<string, any>): Promise<string[]> {
  const targets: string[] = [];
  if (typeof pkg.main === 'string') targets.push(pkg.main);
  if (typeof pkg.bin === 'string') targets.push(pkg.bin);
  else if (pkg.bin && typeof pkg.bin === 'object') targets.push(...Object.values(pkg.bin).filter((v): v is string => typeof v === 'string'));
  const walkExports = (e: any): void => {
    if (typeof e === 'string' && e.startsWith('.')) targets.push(e);
    else if (e && typeof e === 'object') Object.values(e).forEach(walkExports);
  };
  walkExports(pkg.exports);
  const broken: string[] = [];
  for (const t of [...new Set(targets)]) {
    try { await access(join(abs, t)); } catch { broken.push(t); }
  }
  return broken;
}

/** Deep relative imports (../../.. chains) — coupling smell. */
function deepImports(fileTexts: Map<string, string>): Finding[] {
  const out: Finding[] = [];
  const re = /from\s+['"]((?:\.\.\/){3,}[^'"]*)['"]/;
  for (const [file, text] of fileTexts) {
    if (/test|spec|__tests__/i.test(file)) continue;
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
    if (/test|spec|__tests__|\.d\.ts$/i.test(file)) continue;
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

/** README quality: install/usage sections, code blocks, badges. */
async function readmeAudit(abs: string): Promise<{ install: boolean; usage: boolean; codeBlocks: number; badges: number } | null> {
  try {
    const text = await readFile(join(abs, 'README.md'), 'utf8');
    return {
      install: /^#{1,3}.*(install|installation|getting started|démarrage)/im.test(text),
      usage: /^#{1,3}.*(usage|utilisation|quickstart|quick start)/im.test(text),
      codeBlocks: (text.match(/```/g) ?? []).length / 2,
      badges: (text.match(/!\[/g) ?? []).length,
    };
  } catch { return null; }
}

/** Commit message quality: % conventional, avg subject length. */
function commitQuality(subjects: string[]) {
  if (!subjects.length) return null;
  const CONV = /^(feat|fix|docs|style|refactor|perf|test|chore|ci|build|revert|tweak|release|hotfix|init|merge|wip)(\(.+\))?!?:\s/i;
  const conv = subjects.filter(s => CONV.test(s)).length;
  const avgLen = Math.round(subjects.reduce((s, x) => s + x.length, 0) / subjects.length);
  return { conventionalPct: Math.round((conv / subjects.length) * 100), avgLen };
}

const NODE_BUILTINS = new Set([
  'assert', 'buffer', 'child_process', 'cluster', 'console', 'constants', 'crypto', 'dgram', 'dns',
  'domain', 'events', 'fs', 'http', 'http2', 'https', 'inspector', 'module', 'net', 'os', 'path',
  'perf_hooks', 'process', 'punycode', 'querystring', 'readline', 'repl', 'stream', 'string_decoder',
  'sys', 'timers', 'tls', 'tty', 'url', 'util', 'v8', 'vm', 'worker_threads', 'zlib',
]);

function pkgRoot(spec: string): string {
  const s = spec.startsWith('node:') ? spec.slice(5) : spec;
  if (s.startsWith('@')) return s.split('/').slice(0, 2).join('/');
  return s.split('/')[0];
}



/** All external package names imported in the codebase. `skipTests` excludes
 *  test/fixture files — their contents are often code samples in other languages
 *  (a Go import of the fmt package inside a string literal) that aren't real
 *  package imports. */
function importedPackages(fileTexts: Map<string, string>, skipTests = false): Set<string> {
  const imported = new Set<string>();
  const IMPORT_RE = /(?:\bfrom\s+|\bimport\s*\(|\bimport\s+|\brequire\s*\(|\brequire\.resolve\s*\()\s*['"]([^'"./][^'"]*)['"]/g;
  const TEST_PATH = /(^|[\\/])(tests?|__tests__|fixtures?)([\\/]|$)|\.(test|spec)\.[tj]sx?$/i;
  for (const [p, text] of fileTexts) {
    if (skipTests && TEST_PATH.test(p)) continue;
    for (const m of text.matchAll(IMPORT_RE)) imported.add(m[1]);
  }
  return imported;
}

/** Packages imported in code but absent from any package.json in the repo — breaks installs. */
async function missingDeps(abs: string, fileTexts: Map<string, string>, pkg: Record<string, any>, indexPaths: Set<string>): Promise<string[]> {
  const declared = new Set<string>([pkg.name].filter(Boolean) as string[]);
  const addDeps = (p: Record<string, any>) =>
    ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
      .forEach(k => Object.keys(p[k] ?? {}).forEach(d => declared.add(d)));
  addDeps(pkg);
  // Sub-packages (mcp/, demo/, packages/*) have their own package.json — merge their deps.
  for (const p of indexPaths) {
    if (!/(^|\/)package\.json$/.test(p) || p === 'package.json') continue;
    try { addDeps(JSON.parse(await readFile(join(abs, p), 'utf8'))); } catch {}
  }
  const missing = new Set<string>();
  for (const spec of importedPackages(fileTexts, true)) {
    const root = pkgRoot(spec);
    if (!NODE_BUILTINS.has(root) && !declared.has(root) && !root.startsWith('@/') && !root.startsWith('~/')) missing.add(root);
  }
  return [...missing].sort();
}

/** Declared deps missing from the lockfile → lockfile out of sync. */
async function lockfileDrift(abs: string, deps: string[]): Promise<string[]> {
  for (const lf of ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lock']) {
    try {
      const text = await readFile(join(abs, lf), 'utf8');
      return deps.filter(d => !text.includes(d));
    } catch {}
  }
  return [];
}

/** Cyclomatic-ish complexity per function chunk (branches inside the body). */
function functionComplexity(index: { files: Record<string, { relPath: string; chunks: { kind: string; name?: string; content: string }[] }> }) {
  const BRANCH = /\b(if|for|while|case|catch)\b|&&|\|\||\?/g;
  const out: { file: string; name: string; score: number }[] = [];
  for (const f of Object.values(index.files)) {
    if (/test|spec|__tests__|\.d\.ts$/i.test(f.relPath)) continue;
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
    if (/test|spec|__tests__|\.d\.ts$/i.test(f.relPath)) continue;
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
    if (/test|spec|__tests__|\.d\.ts$/i.test(file)) continue;
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

/** All deterministic audit computations — no rendering, no language. */
export async function collectAudit(projectPath: string): Promise<AuditData> {
  const [index, graph, health] = await Promise.all([
    getIndex(projectPath),
    collectImportGraph(projectPath),
    analyzeProject(projectPath),
  ]);
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
  const testFiles = Object.keys(index.files).filter(f => /test|spec|__tests__/i.test(f));
  const srcFiles = graph.codeFiles.filter(f => !/test|spec|__tests__/i.test(f));
  const testRatio = srcFiles.length ? Math.round((testFiles.length / srcFiles.length) * 100) : 0;
  const largest = graph.codeFiles
    .map(f => ({ f, lines: graph.fileTexts.get(f)!.split('\n').length }))
    .sort((a, b) => b.lines - a.lines).slice(0, 5);
  const indexPaths = new Set(Object.keys(index.files).map(f => f.toLowerCase()));
  const docs = ['readme.md', 'license', 'license.md', 'changelog.md', 'contributing.md', 'security.md', 'agents.md']
    .filter(d => indexPaths.has(d));
  const smells = scanCode(graph.fileTexts, SMELL_PATS, 3, { skipStrings: true });
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

  return { index, graph, health, name, pkg, langs, deps, devDeps, scripts, symbols, hubs, entryPoints, leaves, testFiles, srcFiles, testRatio, largest, docs, smells, sec, secTotals, hasTests, git, infra, env, deadDeps, missing, lockDrift, fnComplex, dupNames, asyncNoAwait, maxDepth, cfg, longFns, brokenEntries, deepRel, shape, readme, commitQ, typedFiles, typedPct, staleHubs, sensitive, docCov, docPct, riskFiles, untestedRisk, testBases, topChurn };
}

export function renderAuditMd(data: AuditData, lang: 'fr' | 'en' = 'fr'): string {
  const en = lang === 'en';
  const { index, graph, health, name, pkg, langs, deps, devDeps, scripts, symbols, hubs, entryPoints, leaves, testFiles, testRatio, largest, docs, smells, sec, secTotals, hasTests, git, infra, env, deadDeps, missing, lockDrift, fnComplex, dupNames, asyncNoAwait, maxDepth, cfg, longFns, brokenEntries, deepRel, shape, readme, commitQ, typedFiles, typedPct, staleHubs, sensitive, docCov, docPct, riskFiles, untestedRisk, testBases, topChurn } = data;

  const t = en
    ? {
        title: 'Deterministic report', genBy: 'generated by static analysis — no LLM, no network',
        summary: 'Executive summary', stack: 'Stack & structure', lang: 'Languages', deps: 'Runtime deps', devDeps: 'Dev deps', scripts: 'Scripts',
        arch: 'Module graph', hubs: 'Hub modules (most imported)', entries: 'Entry points', leaves: 'leaf modules', syms: 'symbols extracted',
        constraints: 'Product constraints', none: 'None declared',
        debt: 'Debt & smells', secu: 'Security signals', secuNone: 'No risky pattern detected in scanned code.',
        tests: 'test/src file ratio', largest: 'Largest files', docs: 'Docs present', infra: 'Infra detected',
        gitTitle: 'Git activity & risk', gitCommits: 'commits', gitAuthors: 'authors', gitLast: 'last commit',
        gitChurn: 'Most churned files', gitRisk: 'Risk hotspots (churn × complexity)', gitSolo: 'single-author files',
        docCov: 'docstring coverage', timeline: 'Activity (commits/month)', longestFns: 'Longest functions',
        untested: 'Untested risk hotspots', envUsed: 'Env vars used', envUndoc: 'not documented in .env.example',
        deadDeps: 'Dependencies never imported', sensitive: 'Sensitive files present',
        cfg: 'Config hygiene', cfgStrict: 'tsconfig strict: off', cfgGitignore: 'no .gitignore', cfgPkg: 'package.json missing',
        pkgBroken: 'broken package entries', typed: 'typed files', comments: 'comment density',
        deepImports: 'Deep relative imports (3+ levels)', deepNest: 'Deep nesting (6+ levels)',
        readmeTitle: 'README audit', readmeInstall: 'install section', readmeUsage: 'usage section', readmeCode: 'code blocks', readmeBadges: 'badges',
        commitQ: 'Commit messages', commitConv: 'conventional', staleHubs: 'Stable core (hubs untouched longest)',
        missingDeps: 'imported but undeclared', lockDrift: 'absent from lockfile', bigCommits: 'Largest commits',
        fnComplex: 'Most complex functions', dupNames: 'Duplicate file names', asyncNoAwait: 'async without await',
        graphDepth: 'Max import chain depth',
        reco: 'Recommendations', sev: 'Severity', action: 'Action',
        labels: {
          todo: 'TODO/FIXME markers', console: 'console.* calls', tsIgnore: '@ts-ignore/-expect-error',
          any: '`any` types', emptyCatch: 'empty catch blocks', debugger: 'debugger statements',
          secret: 'hardcoded secrets (suspected)', eval: 'eval / new Function', exec: 'child_process / execSync',
          innerHTML: 'innerHTML assignments', unsafeRegex: 'dynamic RegExp',
        },
        verdict: (g: string) => ({ A: 'Excellent health — clean structure.', B: 'Good health — minor debt.', C: 'Correct — visible debt to watch.', D: 'Fragile — refactor before growing.', E: 'Critical — structural debt blocking.' }[g] ?? ''),
      }
    : {
        title: 'Rapport déterministe', genBy: 'généré par analyse statique — aucun LLM, aucun réseau',
        summary: 'Résumé exécutif', stack: 'Stack & structure', lang: 'Langages', deps: 'Dépendances runtime', devDeps: 'Dépendances dev', scripts: 'Scripts',
        arch: 'Graphe de modules', hubs: 'Modules hubs (les plus importés)', entries: 'Points d\u2019entrée', leaves: 'modules feuilles', syms: 'symboles extraits',
        constraints: 'Contraintes produit', none: 'Aucune déclarée',
        debt: 'Dette & smells', secu: 'Signaux sécurité', secuNone: 'Aucun pattern risqué détecté dans le code scanné.',
        tests: 'ratio tests/src', largest: 'Plus gros fichiers', docs: 'Docs présentes', infra: 'Infra détectée',
        gitTitle: 'Activité Git & risque', gitCommits: 'commits', gitAuthors: 'auteurs', gitLast: 'dernier commit',
        gitChurn: 'Fichiers les plus modifiés', gitRisk: 'Hotspots de risque (churn × complexité)', gitSolo: 'fichiers mono-auteur',
        docCov: 'couverture docstrings', timeline: 'Activité (commits/mois)', longestFns: 'Fonctions les plus longues',
        untested: 'Hotspots à risque non testés', envUsed: 'Variables d\u2019env utilisées', envUndoc: 'non documentées dans .env.example',
        deadDeps: 'Dépendances jamais importées', sensitive: 'Fichiers sensibles présents',
        cfg: 'Hygiène de config', cfgStrict: 'tsconfig strict : off', cfgGitignore: 'pas de .gitignore', cfgPkg: 'package.json incomplet',
        pkgBroken: 'entrées package cassées', typed: 'fichiers typés', comments: 'densité de commentaires',
        deepImports: 'Imports relatifs profonds (3+ niveaux)', deepNest: 'Imbrication profonde (6+ niveaux)',
        readmeTitle: 'Audit README', readmeInstall: 'section install', readmeUsage: 'section usage', readmeCode: 'blocs de code', readmeBadges: 'badges',
        commitQ: 'Messages de commit', commitConv: 'conventionnels', staleHubs: 'Noyau stable (hubs les plus anciens)',
        missingDeps: 'importés mais non déclarés', lockDrift: 'absentes du lockfile', bigCommits: 'Plus gros commits',
        fnComplex: 'Fonctions les plus complexes', dupNames: 'Noms de fichiers dupliqués', asyncNoAwait: 'async sans await',
        graphDepth: 'Profondeur max des chaînes d\u2019imports',
        reco: 'Recommandations', sev: 'Sévérité', action: 'Action',
        labels: {
          todo: 'Marqueurs TODO/FIXME', console: 'Appels console.*', tsIgnore: '@ts-ignore/-expect-error',
          any: 'Types `any`', emptyCatch: 'catch vides', debugger: 'Instructions debugger',
          secret: 'Secrets en dur (suspectés)', eval: 'eval / new Function', exec: 'child_process / execSync',
          innerHTML: 'Affectations innerHTML', unsafeRegex: 'RegExp dynamiques',
        },
        verdict: (g: string) => ({ A: 'Excellente santé — structure propre.', B: 'Bonne santé — dette mineure.', C: 'Correct — dette visible à surveiller.', D: 'Fragile — refactorer avant de grossir.', E: 'Critique — dette structurelle bloquante.' }[g] ?? ''),
      };

  const out: string[] = [];
  out.push(`# 📊 ${t.title} — \`${name}\``);
  out.push(`_${t.genBy}_`, '');

  out.push(`## 1. ${t.summary}`);
  out.push(`**${bar(health.score)} ${health.score}/100 (${health.grade})** — ${t.verdict(health.grade)}`);
  out.push('');
  out.push(`- ${health.analyzedFiles} ${en ? 'code files' : 'fichiers de code'} · ${symbols} ${t.syms} · ${health.importEdges} ${en ? 'local imports' : 'imports locaux'} · ${leaves} ${t.leaves}`);
  out.push(`- ${testFiles.length} ${en ? 'test files' : 'fichiers de test'} (${testRatio}% ${t.tests}) · ${countHits(smells)} ${en ? 'smell hits' : 'smells détectés'} · ${Object.values(secTotals).reduce((a, b) => a + b, 0)} ${en ? 'security signals' : 'signaux sécurité'}`);
  out.push(`- ${docCov.documented}/${docCov.total} ${en ? 'exports documented' : 'exports documentés'} (${docPct}% ${t.docCov})`);
  if (git) out.push(`- ${git.commits} ${t.gitCommits} · ${git.authors.size} ${en ? 'author(s)' : 'auteur(s)'} · ${t.gitLast} : ${git.lastDate}`);
  out.push('');

  let secN = 2;
  out.push(`## ${secN++}. ${t.stack}`);
  if (pkg.name) out.push(`- **${en ? 'Package' : 'Package'}** : \`${pkg.name}${pkg.version ? `@${pkg.version}` : ''}\``);
  if (langs.length) out.push(`- **${t.lang}** : ${langs.map(([l, n]) => `${l} (${n})`).join(', ')}`);
  if (deps.length) out.push(`- **${t.deps}** (${deps.length}) : ${deps.slice(0, 12).map(d => `\`${d}\``).join(', ')}${deps.length > 12 ? ' …' : ''}`);
  if (devDeps.length) out.push(`- **${t.devDeps}** (${devDeps.length}) : ${devDeps.slice(0, 8).map(d => `\`${d}\``).join(', ')}${devDeps.length > 8 ? ' …' : ''}`);
  if (scripts.length) out.push(`- **${t.scripts}** : ${scripts.map(s => `\`${s}\``).join(', ')}`);
  if (docs.length) out.push(`- **${t.docs}** : ${docs.map(d => `\`${d}\``).join(', ')}`);
  if (infra.length) out.push(`- **${t.infra}** : ${infra.map(i => `\`${i}\``).join(', ')}`);
  if (env.used.length) out.push(`- **${t.envUsed}** (${env.used.length}) : ${env.used.slice(0, 10).map(v => `\`${v}\``).join(', ')}${env.used.length > 10 ? ' …' : ''}`);
  if (env.undocumented.length && env.hasTemplate) out.push(`  - ⚠️ ${env.undocumented.length} ${t.envUndoc} : ${env.undocumented.slice(0, 8).map(v => `\`${v}\``).join(', ')}`);
  if (deadDeps.length) out.push(`- **${t.deadDeps}** : ${deadDeps.map(d => `\`${d}\``).join(', ')}`);
  if (missing.length) out.push(`- ⚠️ **${en ? 'Deps' : 'Deps'} ${t.missingDeps}** : ${missing.map(d => `\`${d}\``).join(', ')}`);
  if (lockDrift.length) out.push(`- ⚠️ ${lockDrift.length} ${en ? 'deps' : 'deps'} ${t.lockDrift} : ${lockDrift.map(d => `\`${d}\``).join(', ')}`);
  const cfgNotes: string[] = [];
  if (cfg.tsStrict === false) cfgNotes.push(t.cfgStrict);
  if (cfg.isGit && !cfg.gitignore) cfgNotes.push(t.cfgGitignore);
  if (cfg.pkgMissing.length) cfgNotes.push(`${t.cfgPkg} : ${cfg.pkgMissing.map(k => `\`${k}\``).join(', ')}`);
  if (cfgNotes.length) out.push(`- **${t.cfg}** : ${cfgNotes.join(' · ')}`);
  if (brokenEntries.length) out.push(`- ⚠️ **${t.pkgBroken}** : ${brokenEntries.map(e => `\`${e}\``).join(', ')}`);
  out.push(`- ${typedPct}% ${t.typed} (${typedFiles}/${graph.codeFiles.length}) · ${shape.commentPct}% ${t.comments}`);
  if (readme) {
    const ok = (b: boolean) => (b ? '✅' : '❌');
    out.push(`- **${t.readmeTitle}** : ${t.readmeInstall} ${ok(readme.install)} · ${t.readmeUsage} ${ok(readme.usage)} · ${readme.codeBlocks} ${t.readmeCode} · ${readme.badges} ${t.readmeBadges}`);
  }
  out.push('');

  out.push(`## ${secN++}. ${t.arch}`);
  if (hubs.length) {
    out.push(`**${t.hubs}** :`, '');
    for (const [f, n] of hubs) out.push(`- \`${f}\` ← ${n} ${en ? 'importers' : 'importeurs'}`);
    out.push('');
  }
  if (entryPoints.length) {
    out.push(`**${t.entries}** : ${entryPoints.map(f => `\`${f}\``).join(', ')}`, '');
  }
  if (largest.length) {
    out.push(`**${t.largest}** : ${largest.map(x => `\`${x.f}\` (${x.lines}l)`).join(', ')}`, '');
  }
  if (longFns.length) {
    out.push(`**${t.longestFns}** :`, '');
    for (const f of longFns) out.push(`- \`${f.file}\` → \`${f.name}\` (${f.lines}l)`);
    out.push('');
  }
  if (deepRel.length) {
    out.push(`**${t.deepImports}** — ${deepRel.length} :`, '');
    for (const d of deepRel.slice(0, 5)) out.push(`- \`${d.file}:${d.line}\` → \`${d.sample}\``);
    out.push('');
  }
  if (shape.deepNest.length) {
    out.push(`**${t.deepNest}** : ${shape.deepNest.map(d => `\`${d.file}\` (${d.depth})`).join(', ')}`, '');
  }
  if (maxDepth > 0) out.push(`- **${t.graphDepth}** : ${maxDepth}`);
  if (fnComplex.length) {
    out.push(`**${t.fnComplex}** :`, '');
    for (const f of fnComplex) out.push(`- \`${f.file}\` → \`${f.name}\` (${f.score} ${en ? 'branches' : 'branchements'})`);
    out.push('');
  }
  if (dupNames.length) {
    out.push(`**${t.dupNames}** :`, '');
    for (const d of dupNames) out.push(`- \`${d.name}\` → ${d.files.map(f => `\`${f}\``).join(', ')}`);
    out.push('');
  }

  if (git) {
    out.push(`## ${secN++}. ${t.gitTitle}`, '');
    const topAuthors = [...git.authors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([a, n]) => `${a} (${n})`).join(', ');
    const soloCount = [...git.fileAuthors.values()].filter(a => a.size === 1).length;
    out.push(`- ${git.commits} ${t.gitCommits} · **${t.gitAuthors}** : ${topAuthors}`);
    out.push(`- ${soloCount} ${t.gitSolo}`);
    if (commitQ) out.push(`- ${t.commitQ} : ${commitQ.conventionalPct}% ${t.commitConv} · ~${commitQ.avgLen} ${en ? 'chars' : 'car.'}`);
    out.push('');
    out.push(`**${t.gitChurn}** :`, '');
    for (const [f, c] of topChurn) {
      const n = git.fileAuthors.get(f)?.size ?? 0;
      out.push(`- \`${f}\` — ${c} ${en ? 'lines changed' : 'lignes modifiées'} · ${n} ${en ? 'author(s)' : 'auteur(s)'}`);
    }
    out.push('');
    if (riskFiles.length) {
      out.push(`**${t.gitRisk}** :`, '');
      for (const r of riskFiles) {
        const tested = hasDedicatedTest(testBases, r.file);
        out.push(`- \`${r.file}\` — churn ${r.churn} × ${en ? 'complexity' : 'complexité'} ${r.score}${tested ? '' : (en ? ' · ⚠️ no test' : ' · ⚠️ sans test')}`);
      }
      out.push('');
      if (untestedRisk.length) out.push(`_${t.untested} : ${untestedRisk.map(r => `\`${r.file}\``).join(', ')}_`, '');
    }
    if (git.months.size > 1) {
      const months = [...git.months.entries()].sort().slice(-12);
      const max = Math.max(...months.map(([, n]) => n));
      out.push(`**${t.timeline}** :`, '');
      out.push('```');
      for (const [m, n] of months) out.push(`${m} ${'▇'.repeat(Math.max(1, Math.round((n / max) * 20)))} ${n}`);
      out.push('```', '');
    }
    if (staleHubs.length) {
      out.push(`**${t.staleHubs}** :`, '');
      for (const s of staleHubs) out.push(`- \`${s.f}\` ← ${s.n} ${en ? 'importers' : 'importeurs'} · ${en ? 'last change' : 'dernière modif'} ${s.last}`);
      out.push('');
    }
    if (git.commitSizes.length) {
      const big = [...git.commitSizes].sort((a, b) => b.lines - a.lines).slice(0, 3);
      out.push(`**${t.bigCommits}** : ${big.map(c => `${c.lines} ${en ? 'lines' : 'lignes'} / ${c.files} ${en ? 'files' : 'fichiers'}`).join(' · ')}`, '');
    }
  }

  out.push(`## ${secN++}. ${t.debt}`);
  const smellKeys = Object.keys(smells);
  if (!smellKeys.length) out.push(en ? '_Nothing detected._' : '_Rien détecté._');
  for (const key of smellKeys) {
    const hits = smells[key];
    out.push(`- **${t.labels[key as keyof typeof t.labels] ?? key}** — ${hits.length}${en ? ' hit' + (hits.length > 1 ? 's' : '') : ''}`);
    for (const h of hits.slice(0, 4)) out.push(`  - \`${h.file}:${h.line}\` — ${h.sample}`);
    if (hits.length > 4) out.push(`  - _…${hits.length - 4} ${en ? 'more' : 'autres'}_`);
  }
  if (asyncNoAwait.length) {
    out.push(`- **${t.asyncNoAwait}** — ${asyncNoAwait.length}`);
    for (const a of asyncNoAwait.slice(0, 5)) out.push(`  - \`${a.file}\` → \`${a.name}\``);
  }
  out.push('');

  out.push(`## ${secN++}. ${t.secu}`);
  if (sensitive.length) {
    out.push(`- **${t.sensitive}** — ${sensitive.length}`);
    for (const f of sensitive.slice(0, 6)) out.push(`  - \`${f}\`${git?.sensitiveTracked.includes(f) ? (en ? ' (tracked by git!)' : ' (suivi par git !)') : ''}`);
  }
  const secKeys = Object.keys(sec);
  if (!secKeys.length && !sensitive.length) out.push(`_${t.secuNone}_`);
  for (const key of secKeys) {
    const hits = sec[key];
    out.push(`- **${t.labels[key as keyof typeof t.labels] ?? key}** — ${hits.length}`);
    for (const h of hits.slice(0, 5)) out.push(`  - \`${h.file}:${h.line}\` — ${h.sample}`);
    if (hits.length > 5) out.push(`  - _…${hits.length - 5} ${en ? 'more' : 'autres'}_`);
  }
  out.push('');

  out.push(`## ${secN++}. ${t.constraints}`);
  out.push(index.constraints.length ? index.constraints.map(c => `- ${c}`).join('\n') : t.none, '');

  out.push(formatHealthReportMd(health, lang).replace(/^## /, `## ${secN++}. `).replace(/\n### /g, '\n#### '), '');

  out.push(`## ${secN++}. ${t.reco}`, '');
  out.push(`| ${t.sev} | ${t.action} |`, '|---|---|');
  const SEV_ICON: Record<Reco['severity'], string> = { Critique: '🔴', 'Élevée': '🟠', Moyenne: '🟡', Faible: '🔵' };
  for (const r of recommendations(health, hasTests, smells, sec, git, infra, riskFiles, { sensitive, envUndoc: env.undocumented, deadDeps, tsStrict: cfg.tsStrict, untestedRisk: untestedRisk.map(r => r.file), brokenEntries, deepRel: deepRel.length, deepNest: shape.deepNest.map(d => d.file), commitConv: commitQ?.conventionalPct ?? null, missingDeps: missing, lockDrift, secTotals }, lang)) out.push(`| ${SEV_ICON[r.severity]} ${r.severity} | ${r.text} |`);
  out.push('');
  out.push('---');
  out.push(`_${en ? 'Made with passion by shinzarou-eng' : 'Fait avec passion par shinzarou-eng'} — dsh-codebase-chat · ${en ? 'deterministic mode' : 'mode déterministe'}_`);

  return out.join('\n');
}

export async function buildDeterministicReport(projectPath: string, lang: 'fr' | 'en' = 'fr'): Promise<string> {
  return renderAuditMd(await collectAudit(projectPath), lang);
}
