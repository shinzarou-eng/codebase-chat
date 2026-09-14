// Env / dependencies / package-config collectors - file reads only, no graph.
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isTestPath } from './analysis.js';

const SYSTEM_ENV = new Set([
  'PATH', 'PATHEXT', 'HOME', 'HOMEPATH', 'USERPROFILE', 'USERNAME', 'USER', 'APPDATA', 'LOCALAPPDATA',
  'TEMP', 'TMP', 'TMPDIR', 'OS', 'COMSPEC', 'SYSTEMROOT', 'WINDIR', 'PROGRAMFILES', 'PROGRAMDATA',
  'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'SHELL', 'TERM', 'PWD', 'OLDPWD', 'HOME',
  'LANG', 'LC_ALL', 'TZ', 'NODE_ENV', 'NODE_PATH', 'npm_config_cache', 'CI', 'HOSTNAME',
]);

/** Env vars referenced in code vs declared in .env.example/.env.sample. */
export async function envAudit(abs: string, fileTexts: Map<string, string>) {
  const used = new Set<string>();
  for (const [file, text] of fileTexts) {
    if (isTestPath(file)) continue;
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
export function unusedDeps(deps: string[], imported: Set<string>, pkg: Record<string, any>, fileTexts: Map<string, string>): string[] {
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
export async function configAudit(abs: string, pkg: Record<string, any>, _indexPaths: Set<string>, isGit: boolean) {
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

/** package.json entry points (bin/main/exports) that don't exist on disk. */
export async function brokenPkgEntries(abs: string, pkg: Record<string, any>): Promise<string[]> {
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

/** README quality: install/usage sections, code blocks, badges. */
export async function readmeAudit(abs: string): Promise<{ install: boolean; usage: boolean; codeBlocks: number; badges: number } | null> {
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

const NODE_BUILTINS = new Set([
  'assert', 'buffer', 'child_process', 'cluster', 'console', 'constants', 'crypto', 'dgram', 'dns',
  'domain', 'events', 'fs', 'http', 'http2', 'https', 'inspector', 'module', 'net', 'os', 'path',
  'perf_hooks', 'process', 'punycode', 'querystring', 'readline', 'repl', 'stream', 'string_decoder',
  'sys', 'timers', 'tls', 'tty', 'url', 'util', 'v8', 'vm', 'worker_threads', 'zlib',
]);

export function pkgRoot(spec: string): string {
  const s = spec.startsWith('node:') ? spec.slice(5) : spec;
  if (s.startsWith('@')) return s.split('/').slice(0, 2).join('/');
  return s.split('/')[0];
}

/** All external package names imported in the codebase. `skipTests` excludes
 *  test/fixture files - their contents are often code samples in other languages
 *  (a Go import of the fmt package inside a string literal) that aren't real
 *  package imports. */
export function importedPackages(fileTexts: Map<string, string>, skipTests = false): Set<string> {
  const imported = new Set<string>();
  const IMPORT_RE = /(?:\bfrom\s+|\bimport\s*\(|\bimport\s+|\brequire\s*\(|\brequire\.resolve\s*\()\s*['"]([^'"./][^'"]*)['"]/g;
  for (const [p, text] of fileTexts) {
    if (skipTests && isTestPath(p)) continue;
    for (const m of text.matchAll(IMPORT_RE)) imported.add(m[1]);
  }
  return imported;
}

/** Packages imported in code but absent from any package.json in the repo - breaks installs. */
export async function missingDeps(abs: string, fileTexts: Map<string, string>, pkg: Record<string, any>, indexPaths: Set<string>): Promise<string[]> {
  const declared = new Set<string>([pkg.name].filter(Boolean) as string[]);
  const addDeps = (p: Record<string, any>) =>
    ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
      .forEach(k => Object.keys(p[k] ?? {}).forEach(d => declared.add(d)));
  addDeps(pkg);
  // Sub-packages (mcp/, demo/, packages/*) have their own package.json - merge their deps.
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
export async function lockfileDrift(abs: string, deps: string[]): Promise<string[]> {
  for (const lf of ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lock']) {
    try {
      const text = await readFile(join(abs, lf), 'utf8');
      return deps.filter(d => !text.includes(d));
    } catch {}
  }
  return [];
}
