import { basename, extname, posix as posixPath } from 'node:path';
import type { CloneGroup } from './analysis-types.js';

export const CODE_EXTS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx']);
const ENTRY_BASENAMES = new Set(['index', 'main', 'app', 'cli', 'server', 'bin', 'mod']);
export const SKIP_EXTS = new Set(['.d.ts', '.test.ts', '.test.js', '.spec.ts', '.spec.js', '.config.js', '.config.ts', '.config.mjs']);

/** Test/fixture path detection — dir segments and filename conventions only,
 *  never a bare substring (`src/latest.ts` is NOT a test file). */
export function isTestPath(rel: string): boolean {
  const f = rel.replace(/\\/g, '/');
  return /(^|\/)(tests?|__tests__|__mocks__|fixtures?|spec)\//i.test(f)
    || /(^|[._-])(test|spec)\.[^./\\]+$/i.test(f);
}

/** Paths skipped by smell/shape scans: test fixtures AND type declarations
 *  (`.d.ts` is declarations, not scannable code). */
export function isSkippablePath(rel: string): boolean {
  return isTestPath(rel) || /\.d\.ts$/i.test(rel.replace(/\\/g, '/'));
}

const IMPORT_RE = /(?:import|export)\s+(?:[\w*{}\s,]+\s+from\s+)?['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)|import\(\s*['"]([^'"]+)['"]\s*\)/g;
const EXPORT_RE = /export\s+(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)|export\s*\{\s*([^}]+)\}|export\s+default\b/g;

export function parseImports(text: string, relPath: string, known: Set<string>): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(text)) !== null) {
    const spec = m[1] ?? m[2] ?? m[3];
    if (!spec || !spec.startsWith('.')) continue;
    const base = posixPath.normalize(posixPath.join(posixPath.dirname(relPath), spec));
    // ESM imports often use a .js extension pointing at a .ts source file.
    const noExt = base.replace(/\.(js|jsx|mjs|cjs|ts|tsx)$/, '');
    for (const cand of [base, `${noExt}.ts`, `${noExt}.tsx`, `${noExt}.js`, `${noExt}.jsx`, `${noExt}.mjs`, `${base}/index.ts`, `${base}/index.js`]) {
      if (known.has(cand)) { out.push(cand); break; }
    }
  }
  return out;
}

/** Is the char at `idx` inside a quoted string on this line? */
export function insideString(line: string, idx: number): boolean {
  let inStr: string | null = null;
  for (let i = 0; i < idx; i++) {
    const c = line[i];
    if (c === '\\') { i++; continue; }
    if (inStr) { if (c === inStr) inStr = null; continue; }
    if (c === "'" || c === '"' || c === '`') inStr = c;
  }
  return inStr !== null;
}

/** Line-start string state: does this line begin inside a string/template literal? */
export function lineStartsInString(text: string): boolean[] {
  const starts: boolean[] = [];
  let inStr: string | null = null;
  let lineStart = true;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (lineStart) { starts.push(inStr !== null); lineStart = false; }
    if (c === '\n') { lineStart = true; continue; }
    if (c === '\\') { i++; continue; }
    if (inStr) { if (c === inStr) inStr = null; continue; }
    if (c === "'" || c === '"' || c === '`') inStr = c;
  }
  return starts;
}

export function parseExports(text: string): { name: string; line: number }[] {
  const out: { name: string; line: number }[] = [];
  let m: RegExpExecArray | null;
  EXPORT_RE.lastIndex = 0;
  while ((m = EXPORT_RE.exec(text)) !== null) {
    const line = text.slice(0, m.index).split('\n').length;
    if (m[1]) out.push({ name: m[1], line });
    else if (m[2]) {
      for (const part of m[2].split(',')) {
        const name = part.trim().split(/\s+as\s+/).pop()?.trim();
        if (name) out.push({ name, line });
      }
    } else out.push({ name: 'default', line });
  }
  return out;
}

export function looksLikeEntry(rel: string, pkg: Record<string, any>): boolean {
  const base = basename(rel).toLowerCase().replace(extname(rel), '');
  if (ENTRY_BASENAMES.has(base)) return true;
  // Test/spec files and tool configs are entry points by convention —
  // they are executed, not imported.
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(rel) || rel.includes('__tests__/') || /^e2e[.-]/.test(basename(rel))) return true;
  if (/\.(config|rc)\.[cm]?[jt]s$/.test(rel)) return true;
  if (/^(pages|app|routes|api|bin|scripts)\//.test(rel) || rel.includes('/pages/') || rel.includes('/routes/')) return true;
  const fields = [pkg?.main, pkg?.module, pkg?.bin, pkg?.exports?.['.']];
  for (const f of fields.flatMap(v => (typeof v === 'string' ? [v] : v ? Object.values(v) : []))) {
    if (typeof f === 'string' && rel.endsWith(f.replace(/^\.\//, ''))) return true;
  }
  return false;
}

export function complexityOf(text: string): number {
  const matches = text.match(/\b(if|else if|for|while|case|catch|&&|\|\||\?)\b|\?\./g);
  return 1 + (matches ? matches.length : 0);
}

const WINDOW = 6;
export function findDuplicates(fileTexts: Map<string, string>): CloneGroup[] {
  const windows = new Map<string, { file: string; line: number }[]>();
  for (const [file, text] of fileTexts) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('//') && l !== '{' && l !== '}');
    for (let i = 0; i + WINDOW <= lines.length; i++) {
      const key = lines.slice(i, i + WINDOW).join('\n');
      if (key.length < 60) continue;
      if (!windows.has(key)) windows.set(key, []);
      const arr = windows.get(key)!;
      if (!arr.some(w => w.file === file)) arr.push({ file, line: i + 1 });
    }
  }
  const groups = new Map<string, CloneGroup>();
  for (const [key, hits] of windows) {
    if (hits.length < 2) continue;
    const files = [...new Set(hits.map(h => h.file))].sort();
    const gk = files.join('|');
    const preview = key.split('\n')[0].slice(0, 80);
    const g = groups.get(gk);
    if (g) g.lines += WINDOW;
    else groups.set(gk, { files, lines: WINDOW, preview });
  }
  return [...groups.values()].sort((a, b) => b.lines - a.lines).slice(0, 15);
}
