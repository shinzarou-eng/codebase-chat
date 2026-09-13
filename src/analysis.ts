import { basename, extname, join, relative, sep, posix as posixPath } from 'node:path';
import { readFile } from 'node:fs/promises';
import { findProjectRoot, getWalkOptions, resolveProjectPath, safeReadText, walkFiles } from './project.js';

export const CODE_EXTS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx']);
const ENTRY_BASENAMES = new Set(['index', 'main', 'app', 'cli', 'server', 'bin', 'mod']);
export const SKIP_EXTS = new Set(['.d.ts', '.test.ts', '.test.js', '.spec.ts', '.spec.js', '.config.js', '.config.ts', '.config.mjs']);

export interface ImportEdge { from: string; to: string; }
export interface Cycle { path: string[]; }
export interface UnusedExport { file: string; name: string; line: number; }
export interface CloneGroup { files: string[]; lines: number; preview: string; }
export interface Hotspot { file: string; name?: string; startLine: number; score: number; }

export interface HealthReport {
  projectPath: string;
  analyzedFiles: number;
  importEdges: number;
  cycles: Cycle[];
  unusedFiles: string[];
  unusedExports: UnusedExport[];
  duplicates: CloneGroup[];
  hotspots: Hotspot[];
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'E';
}

const IMPORT_RE = /(?:import|export)\s+(?:[\w*{}\s,]+\s+from\s+)?['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)|import\(\s*['"]([^'"]+)['"]\s*\)/g;
const EXPORT_RE = /export\s+(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)|export\s*\{\s*([^}]+)\}|export\s+default\b/g;

function parseImports(text: string, relPath: string, known: Set<string>): string[] {
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

/**
 * Detect cycle groups in the local import graph via Tarjan's SCC algorithm —
 * linear time, no combinatorial blow-up on dense graphs. Each reported
 * `Cycle.path` holds the members of one strongly connected component.
 */
export function findCycles(edges: ImportEdge[]): Cycle[] {
  const adj = new Map<string, string[]>();
  const nodes = new Set<string>();
  for (const e of edges) {
    nodes.add(e.from);
    nodes.add(e.to);
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from)!.push(e.to);
  }

  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];
  let counter = 0;

  for (const root of nodes) {
    if (index.has(root)) continue;
    // Iterative DFS — no recursion limit on deep graphs.
    const work: [string, number][] = [[root, 0]];
    while (work.length) {
      const top = work[work.length - 1];
      const [v, ci] = top;
      if (ci === 0) {
        index.set(v, counter);
        low.set(v, counter);
        counter++;
        stack.push(v);
        onStack.add(v);
      }
      const children = adj.get(v) ?? [];
      if (ci < children.length) {
        top[1] = ci + 1;
        const w = children[ci];
        if (!index.has(w)) work.push([w, 0]);
        else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
      } else {
        work.pop();
        if (work.length) {
          const parent = work[work.length - 1][0];
          low.set(parent, Math.min(low.get(parent)!, low.get(v)!));
        }
        if (low.get(v) === index.get(v)) {
          const scc: string[] = [];
          let w: string;
          do { w = stack.pop()!; onStack.delete(w); scc.push(w); } while (w !== v);
          // size > 1 = real cycle; size 1 only when the file imports itself
          if (scc.length > 1 || (adj.get(v) ?? []).includes(v)) sccs.push(scc);
        }
      }
    }
  }

  return sccs
    .map(m => ({ path: m.sort() }))
    .sort((a, b) => b.path.length - a.path.length);
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

function complexityOf(text: string): number {
  const matches = text.match(/\b(if|else if|for|while|case|catch|&&|\|\||\?)\b|\?\./g);
  return 1 + (matches ? matches.length : 0);
}

const WINDOW = 6;
function findDuplicates(fileTexts: Map<string, string>): CloneGroup[] {
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

export interface AnalyzeOptions {
  /** Restrict *reported findings* to these project-relative paths (e.g. a diff
   * scope). The import graph and usage checks still run on the whole project
   * so cycles/uses crossing the scope boundary are detected. */
  files?: Set<string>;
}

export interface ImportGraph {
  abs: string;
  codeFiles: string[];
  fileTexts: Map<string, string>;
  edges: ImportEdge[];
  inDegree: Map<string, number>;
}

/**
 * Walk the project once and build the local import graph (file → files it
 * imports). Shared by `analyzeProject` and `analyzeImpact` so both run the
 * same resolution rules.
 */
export async function collectImportGraph(projectPath: string): Promise<ImportGraph> {
  const abs = await findProjectRoot(resolveProjectPath(projectPath));
  const fileTexts = new Map<string, string>();
  const codeFiles: string[] = [];
  const walk = await getWalkOptions(abs);

  for await (const full of walkFiles(abs, walk.skipDirs, walk.skipFiles, walk.ignoreGlobs)) {
    const rel = relative(abs, full).split(sep).join('/');
    const ext = extname(rel).toLowerCase();
    if (!CODE_EXTS.has(ext) || SKIP_EXTS.has(ext) || rel.includes('.min.')) continue;
    const text = await safeReadText(full);
    if (!text) continue;
    codeFiles.push(rel);
    fileTexts.set(rel, text);
  }

  const known = new Set(codeFiles);
  const edges: ImportEdge[] = [];
  const inDegree = new Map<string, number>();
  for (const rel of codeFiles) {
    for (const to of parseImports(fileTexts.get(rel)!, rel, known)) {
      edges.push({ from: rel, to });
      inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
    }
  }
  return { abs, codeFiles, fileTexts, edges, inDegree };
}

export async function analyzeProject(projectPath: string, opts: AnalyzeOptions = {}): Promise<HealthReport> {
  const { abs, codeFiles, fileTexts, edges, inDegree } = await collectImportGraph(projectPath);
  const scope = opts.files;
  const scopedFiles = scope ? codeFiles.filter(f => scope.has(f)) : codeFiles;

  let pkg: Record<string, any> = {};
  try { pkg = JSON.parse(await readFile(join(abs, 'package.json'), 'utf8')); } catch {}

  // Full-graph cycles — when scoped, keep only cycles touching a changed file.
  const cycles = findCycles(edges)
    .filter(c => !scope || c.path.some(node => scope.has(node)));

  const unusedFiles = scopedFiles
    .filter(rel => !inDegree.has(rel) && !looksLikeEntry(rel, pkg))
    .sort();

  // Unused exports: name not imported and not referenced elsewhere.
  // A name referenced by other code in its own file (e.g. a type used by a
  // public interface) is live API surface, not dead code — so we also index
  // identifiers on non-export lines per file.
  const IDENT_RE = /[A-Za-z_$][\w$]*/g;
  const identifiersByFile = new Map<string, Set<string>>();
  const nonExportIdsByFile = new Map<string, Set<string>>();
  for (const [file, text] of fileTexts) {
    identifiersByFile.set(file, new Set(text.match(IDENT_RE) ?? []));
    const nonExport = text.split('\n').filter(l => !/^\s*export\b/.test(l)).join('\n');
    nonExportIdsByFile.set(file, new Set(nonExport.match(IDENT_RE) ?? []));
  }
  const unusedExports: UnusedExport[] = [];
  for (const rel of scopedFiles) {
    for (const exp of parseExports(fileTexts.get(rel)!)) {
      if (exp.name === 'default') continue;
      if (nonExportIdsByFile.get(rel)!.has(exp.name)) continue; // referenced by own module
      let used = false;
      for (const [otherFile, ids] of identifiersByFile) {
        if (otherFile === rel) continue;
        if (ids.has(exp.name)) { used = true; break; }
      }
      if (!used) unusedExports.push({ file: rel, name: exp.name, line: exp.line });
    }
  }

  // Duplicates across the whole project, but when scoped only report groups
  // that include at least one changed file.
  const duplicates = findDuplicates(fileTexts)
    .filter(g => !scope || g.files.some(f => scope.has(f)));

  const hotspots: Hotspot[] = [];
  for (const rel of scopedFiles) {
    const score = complexityOf(fileTexts.get(rel)!);
    if (score >= 12) hotspots.push({ file: rel, startLine: 1, score });
  }
  hotspots.sort((a, b) => b.score - a.score);

  const codeLines = scopedFiles.reduce((s, f) => s + fileTexts.get(f)!.split('\n').length, 0);
  const dupLines = duplicates.reduce((s, g) => s + g.lines, 0);
  // Cycle penalty scales with how many files are trapped in cycle groups.
  const cyclesPenalty = cycles.reduce((s, c) => s + c.path.length, 0) * 2;
  const penalties =
    cyclesPenalty +
    unusedFiles.length * 2 +
    Math.min(unusedExports.length, 20) * 1 +
    Math.round((dupLines / Math.max(codeLines, 1)) * 100) +
    Math.min(hotspots.length, 15) * 2;
  const score = Math.max(0, Math.min(100, 100 - penalties));
  const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 65 ? 'C' : score >= 50 ? 'D' : 'E';

  return {
    projectPath: abs,
    analyzedFiles: scopedFiles.length,
    importEdges: edges.length,
    cycles,
    unusedFiles,
    unusedExports,
    duplicates,
    hotspots,
    score,
    grade,
  };
}

export function formatHealthReport(r: HealthReport, lang: 'fr' | 'en' = 'fr'): string {
  const t = lang === 'en'
    ? {
        title: 'STATIC ANALYSIS', files: 'files analyzed', edges: 'local imports',
        cycles: 'Circular dependencies', none: 'none',
        unusedFiles: 'Unused files (candidates)', unusedExports: 'Unused exports (candidates)',
        dupes: 'Duplicate code blocks', hotspots: 'Complexity hotspots',
        score: 'Health score', noteUnused: 'candidates — entry points and framework conventions excluded',
      }
    : {
        title: 'ANALYSE STATIQUE', files: 'fichiers analysés', edges: 'imports locaux',
        cycles: 'Dépendances circulaires', none: 'aucune',
        unusedFiles: 'Fichiers inutilisés (candidats)', unusedExports: 'Exports inutilisés (candidats)',
        dupes: 'Blocs de code dupliqués', hotspots: 'Hotspots de complexité',
        score: 'Score de santé', noteUnused: 'candidats — points d’entrée et conventions exclus',
      };

  const out: string[] = [];
  out.push(`== ${t.title} — ${basename(r.projectPath)} ==`);
  if (r.analyzedFiles === 0) {
    out.push(lang === 'en'
      ? 'No code files detected in this project — check the path or your .codebase-chat.json ignore rules.'
      : 'Aucun fichier de code détecté dans ce projet — vérifie le chemin ou les règles ignore de .codebase-chat.json.');
    return out.join('\n');
  }
  out.push(`${t.score}: ${r.score}/100 (${r.grade}) · ${r.analyzedFiles} ${t.files} · ${r.importEdges} ${t.edges}`);
  out.push('');

  out.push(`● ${t.cycles} (${r.cycles.length})`);
  for (const c of r.cycles.slice(0, 10)) out.push(`  ${formatCycle(c)}`);
  if (r.cycles.length === 0) out.push(`  ${t.none}`);
  out.push('');

  out.push(`● ${t.unusedFiles} (${r.unusedFiles.length}) — ${t.noteUnused}`);
  for (const f of r.unusedFiles.slice(0, 15)) out.push(`  ${f}`);
  out.push('');

  out.push(`● ${t.unusedExports} (${r.unusedExports.length})`);
  for (const e of r.unusedExports.slice(0, 15)) out.push(`  ${e.file}:${e.line} — ${e.name}`);
  out.push('');

  out.push(`● ${t.dupes} (${r.duplicates.length})`);
  for (const d of r.duplicates.slice(0, 8)) out.push(`  ${d.lines} lines × ${d.files.length} files — ${d.files.join(', ')}`);
  out.push('');

  out.push(`● ${t.hotspots} (${r.hotspots.length})`);
  for (const h of r.hotspots.slice(0, 10)) out.push(`  ${h.file} — score ${h.score}`);
  return out.join('\n');
}

/** Small SCCs render as a closed loop; large ones as a file list. */
function formatCycle(c: Cycle, md = false): string {
  const q = (s: string) => (md ? `\`${s}\`` : s);
  if (c.path.length <= 4) return c.path.map(q).join(' → ') + ' → ' + q(c.path[0]);
  const shown = c.path.slice(0, 4).map(q).join(', ');
  return `${c.path.length} files: ${shown}, …`;
}

const GRADE_ICON: Record<HealthReport['grade'], string> = { A: '🟢', B: '🔵', C: '🟡', D: '🟠', E: '🔴' };

function scoreBar(score: number): string {
  const filled = Math.round(score / 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

export function formatHealthReportMd(r: HealthReport, lang: 'fr' | 'en' = 'fr'): string {
  const t = lang === 'en'
    ? {
        title: 'Static analysis', files: 'files analyzed', edges: 'local imports',
        cycles: 'Circular dependencies', none: 'None',
        unusedFiles: 'Unused files (candidates)', unusedExports: 'Unused exports (candidates)',
        dupes: 'Duplicate code blocks', hotspots: 'Complexity hotspots',
        score: 'Health score', noteUnused: '_candidates — entry points and framework conventions excluded_',
        colFile: 'File', colSymbol: 'Symbol', colSize: 'Size', colFiles: 'Files', colScore: 'Score',
        more: (n: number) => `_…and ${n} more_`,
      }
    : {
        title: 'Analyse statique', files: 'fichiers analysés', edges: 'imports locaux',
        cycles: 'Dépendances circulaires', none: 'Aucune',
        unusedFiles: 'Fichiers inutilisés (candidats)', unusedExports: 'Exports inutilisés (candidats)',
        dupes: 'Blocs de code dupliqués', hotspots: 'Hotspots de complexité',
        score: 'Score de santé', noteUnused: '_candidats — points d’entrée et conventions exclus_',
        colFile: 'Fichier', colSymbol: 'Symbole', colSize: 'Taille', colFiles: 'Fichiers', colScore: 'Score',
        more: (n: number) => `_…et ${n} autres_`,
      };

  const out: string[] = [];
  out.push(`## ${GRADE_ICON[r.grade]} ${t.title} — \`${basename(r.projectPath)}\``);
  out.push('');
  if (r.analyzedFiles === 0) {
    out.push(lang === 'en'
      ? '_No code files detected in this project — check the path or your `.codebase-chat.json` ignore rules._'
      : '_Aucun fichier de code détecté dans ce projet — vérifie le chemin ou les règles ignore de `.codebase-chat.json`._');
    return out.join('\n');
  }
  out.push(`**${t.score} : ${scoreBar(r.score)} ${r.score}/100 (${r.grade})** · ${r.analyzedFiles} ${t.files} · ${r.importEdges} ${t.edges}`);
  out.push('');

  out.push(`### ${t.cycles} — ${r.cycles.length}`);
  if (r.cycles.length === 0) out.push(t.none);
  else for (const c of r.cycles.slice(0, 10)) out.push(`- ${formatCycle(c, true)}`);
  if (r.cycles.length > 10) out.push(t.more(r.cycles.length - 10));
  out.push('');

  out.push(`### ${t.unusedFiles} — ${r.unusedFiles.length}`);
  out.push(t.noteUnused);
  if (r.unusedFiles.length) {
    out.push('', `| ${t.colFile} |`, '|---|---|');
    for (const f of r.unusedFiles.slice(0, 15)) out.push(`| \`${f}\` |`);
    if (r.unusedFiles.length > 15) out.push(`| ${t.more(r.unusedFiles.length - 15)} |`);
  }
  out.push('');

  out.push(`### ${t.unusedExports} — ${r.unusedExports.length}`);
  if (r.unusedExports.length) {
    out.push('', `| ${t.colFile} | ${t.colSymbol} |`, '|---|---|');
    for (const e of r.unusedExports.slice(0, 15)) out.push(`| \`${e.file}:${e.line}\` | \`${e.name}\` |`);
    if (r.unusedExports.length > 15) out.push(`| ${t.more(r.unusedExports.length - 15)} | |`);
  } else out.push(t.none);
  out.push('');

  out.push(`### ${t.dupes} — ${r.duplicates.length}`);
  if (r.duplicates.length) {
    out.push('', `| ${t.colSize} | ${t.colFiles} |`, '|---|---|');
    for (const d of r.duplicates.slice(0, 8)) {
      out.push(`| ${d.lines} × ${d.files.length} | ${d.files.map(f => `\`${f}\``).join(', ')} |`);
    }
    if (r.duplicates.length > 8) out.push(`| ${t.more(r.duplicates.length - 8)} | |`);
  } else out.push(t.none);
  out.push('');

  out.push(`### ${t.hotspots} — ${r.hotspots.length}`);
  if (r.hotspots.length) {
    out.push('', `| ${t.colFile} | ${t.colScore} |`, '|---|---|');
    for (const h of r.hotspots.slice(0, 10)) out.push(`| \`${h.file}\` | **${h.score}** |`);
    if (r.hotspots.length > 10) out.push(`| ${t.more(r.hotspots.length - 10)} | |`);
  } else out.push(t.none);

  return out.join('\n');
}
