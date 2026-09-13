import { basename } from 'node:path';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { collectImportGraph, looksLikeEntry, parseExports, type ImportGraph } from './analysis.js';

export interface ImpactDependent { file: string; depth: number; }

export interface ImpactReport {
  projectPath: string;
  query: string;
  target: string;
  /** Set when the blast radius is scoped to one exported symbol. */
  symbol?: string;
  exportedSymbols: { name: string; line: number }[];
  dependents: ImpactDependent[];
  directCount: number;
  totalFiles: number;
  /** Share of the project's code files that transitively depend on the target. */
  percent: number;
  inCycle: boolean;
  isEntry: boolean;
  risk: 'low' | 'medium' | 'high';
}

export type ImpactResult =
  | { ok: true; report: ImpactReport }
  | { ok: false; query: string; candidates: string[] };

/** Rank a candidate path against the query — lower is better, -1 = no match. */
function matchRank(rel: string, q: string): number {
  if (rel === q) return 0;
  if (rel.endsWith(`/${q}`)) return 1;
  if (basename(rel) === q) return 2;
  if (rel.toLowerCase().includes(q.toLowerCase())) return 3;
  return -1;
}

function resolveTarget(codeFiles: string[], query: string): { target?: string; candidates: string[] } {
  const q = query.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!q) return { candidates: [] };
  const ranked = codeFiles
    .map(f => ({ f, r: matchRank(f, q) }))
    .filter(m => m.r >= 0)
    .sort((a, b) => a.r - b.r || a.f.length - b.f.length);
  if (!ranked.length) return { candidates: [] };
  const best = ranked.filter(m => m.r === ranked[0].r);
  if (best.length === 1) return { target: best[0].f, candidates: [] };
  return { candidates: best.slice(0, 12).map(m => m.f) };
}

/**
 * Blast-radius analysis: which files break if `query` changes. Reverse BFS on
 * the local import graph — deterministic, no LLM.
 * `query` may be `file#symbol` or a bare exported symbol name: the radius is
 * then scoped to the files that actually reference that symbol.
 */
export async function analyzeImpact(projectPath: string, query: string, graph?: ImportGraph): Promise<ImpactResult> {
  const g = graph ?? await collectImportGraph(projectPath);
  const hash = query.indexOf('#');
  if (hash > 0) {
    const sym = query.slice(hash + 1).trim();
    const { target, candidates } = resolveTarget(g.codeFiles, query.slice(0, hash));
    if (!target) return { ok: false, query, candidates };
    if (!sym) return { ok: false, query, candidates: [] };
    return symbolImpact(g, query, target, sym);
  }
  const { target, candidates } = resolveTarget(g.codeFiles, query);
  if (!target && !candidates.length) return symbolImpact(g, query); // bare symbol?
  if (!target) return { ok: false, query, candidates };
  return fileImpact(g, query, target);
}

async function fileImpact(g: ImportGraph, query: string, target: string): Promise<ImpactResult> {
  const rev = new Map<string, string[]>();
  for (const e of g.edges) {
    if (!rev.has(e.to)) rev.set(e.to, []);
    rev.get(e.to)!.push(e.from);
  }

  // Reverse BFS — a path coming back to the target reveals a cycle.
  let inCycle = false;
  const queue: string[] = [target];
  let head = 0;
  const dist = new Map<string, number>([[target, 0]]);
  while (head < queue.length) {
    const node = queue[head++];
    const d = dist.get(node)!;
    for (const up of rev.get(node) ?? []) {
      if (up === target) { inCycle = true; continue; }
      if (dist.has(up)) continue;
      dist.set(up, d + 1);
      queue.push(up);
    }
  }
  dist.delete(target);

  const dependents = [...dist.entries()]
    .map(([file, d]) => ({ file, depth: d }))
    .sort((a, b) => a.depth - b.depth || a.file.localeCompare(b.file));
  const directCount = dependents.filter(d => d.depth === 1).length;

  let pkg: Record<string, any> = {};
  try { pkg = JSON.parse(await readFile(join(g.abs, 'package.json'), 'utf8')); } catch {}
  const isEntry = looksLikeEntry(target, pkg);

  const total = dependents.length;
  const percent = g.codeFiles.length ? total / g.codeFiles.length : 0;
  const risk: ImpactReport['risk'] =
    inCycle || percent >= 0.25 || total >= 25 ? 'high'
    : percent >= 0.05 || total >= 5 ? 'medium'
    : 'low';

  return {
    ok: true,
    report: {
      projectPath: g.abs,
      query,
      target,
      exportedSymbols: parseExports(g.fileTexts.get(target) ?? ''),
      dependents,
      directCount,
      totalFiles: g.codeFiles.length,
      percent,
      inCycle,
      isEntry,
      risk,
    },
  };
}

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Symbol-scoped blast radius: files that reference `symbol` (depth 1 = direct
 * users among the exporter's dependents) plus whoever depends on them.
 */
function symbolImpact(g: ImportGraph, query: string, target?: string, symbol?: string): ImpactResult {
  const sym = symbol ?? query.trim();
  if (!sym) return { ok: false, query, candidates: [] };

  if (!target) {
    const exporters = g.codeFiles.filter(f =>
      parseExports(g.fileTexts.get(f) ?? '').some(s => s.name === sym));
    if (!exporters.length) return { ok: false, query, candidates: [] };
    if (exporters.length > 1) {
      // Prefer the file that actually defines the symbol over re-export barrels.
      const defRe = new RegExp(`(?:^|\\n)\\s*(?:export\\s+)?(?:async\\s+)?(?:function|class|const|let|var|interface|type|enum)\\s+${escRe(sym)}\\b`);
      const definers = exporters.filter(f => defRe.test(g.fileTexts.get(f) ?? ''));
      if (definers.length === 1) { target = definers[0]; }
      else return { ok: false, query, candidates: exporters.slice(0, 12) };
    } else target = exporters[0];
  }

  const rev = new Map<string, string[]>();
  for (const e of g.edges) {
    if (!rev.has(e.to)) rev.set(e.to, []);
    rev.get(e.to)!.push(e.from);
  }

  // Every transitive dependent of the exporter…
  const dist = new Map<string, number>([[target, 0]]);
  const queue: string[] = [target];
  let head = 0;
  while (head < queue.length) {
    const node = queue[head++];
    for (const up of rev.get(node) ?? []) {
      if (up === target || dist.has(up)) continue;
      dist.set(up, dist.get(node)! + 1);
      queue.push(up);
    }
  }
  dist.delete(target);

  // …filtered to the ones that actually mention the symbol = direct users.
  const nameRe = new RegExp(`\\b${escRe(sym)}\\b`);
  const users = [...dist.keys()].filter(f => nameRe.test(g.fileTexts.get(f) ?? ''));

  // Then whoever depends on those users breaks transitively.
  const out = new Map<string, number>(users.map(f => [f, 1]));
  const q2 = [...users];
  let h2 = 0;
  while (h2 < q2.length) {
    const node = q2[h2++];
    for (const up of rev.get(node) ?? []) {
      if (up === target || out.has(up)) continue;
      out.set(up, out.get(node)! + 1);
      q2.push(up);
    }
  }

  const dependents = [...out.entries()]
    .map(([file, d]) => ({ file, depth: d }))
    .sort((a, b) => a.depth - b.depth || a.file.localeCompare(b.file));
  const total = dependents.length;
  const percent = g.codeFiles.length ? total / g.codeFiles.length : 0;
  const risk: ImpactReport['risk'] =
    percent >= 0.25 || total >= 25 ? 'high'
    : percent >= 0.05 || total >= 5 ? 'medium'
    : 'low';

  return {
    ok: true,
    report: {
      projectPath: g.abs,
      query,
      target,
      symbol: sym,
      exportedSymbols: parseExports(g.fileTexts.get(target) ?? ''),
      dependents,
      directCount: users.length,
      totalFiles: g.codeFiles.length,
      percent,
      inCycle: false,
      isEntry: false,
      risk,
    },
  };
}

const RISK_ICON = { low: '🟢', medium: '🟡', high: '🔴' } as const;

export function formatImpactReport(r: ImpactReport, lang: 'fr' | 'en' = 'fr'): string {
  const t = lang === 'en'
    ? {
        title: 'IMPACT ANALYSIS', target: 'Target', exports: 'Exported symbols',
        direct: 'Direct dependents', total: 'Total blast radius', files: 'code files',
        inCycle: 'part of a dependency cycle', entry: 'entry point',
        risk: 'Risk', low: 'LOW', medium: 'MEDIUM', high: 'HIGH',
        depth: 'depth', none: 'none — nothing imports this file', more: (n: number) => `…and ${n} more`,
      }
    : {
        title: 'ANALYSE D’IMPACT', target: 'Cible', exports: 'Symboles exportés',
        direct: 'Dépendants directs', total: 'Rayon d’impact total', files: 'fichiers de code',
        inCycle: 'dans un cycle de dépendances', entry: 'point d’entrée',
        risk: 'Risque', low: 'FAIBLE', medium: 'MOYEN', high: 'ÉLEVÉ',
        depth: 'profondeur', none: 'aucun — rien n’importe ce fichier', more: (n: number) => `…et ${n} autres`,
      };

  const tags = [r.isEntry ? t.entry : '', r.inCycle ? t.inCycle : ''].filter(Boolean).join(' · ');
  const out: string[] = [];
  out.push(`== ${t.title} — ${basename(r.projectPath)} ==`);
  out.push(`${t.target}: ${r.target}${r.symbol ? `#${r.symbol}` : ''}${tags ? ` (${tags})` : ''}`);
  out.push(`${t.exports}: ${r.exportedSymbols.length ? r.exportedSymbols.map(s => s.name).join(', ') : '—'}`);
  out.push(`${t.direct}: ${r.directCount} · ${t.total}: ${r.dependents.length} / ${r.totalFiles} ${t.files} (${Math.round(r.percent * 100)}%)`);
  out.push(`${t.risk}: ${t[riskKey(r.risk)]}`);
  out.push('');
  if (!r.dependents.length) {
    out.push(`  ${t.none}`);
    return out.join('\n');
  }
  const byDepth = new Map<number, string[]>();
  for (const d of r.dependents) {
    if (!byDepth.has(d.depth)) byDepth.set(d.depth, []);
    byDepth.get(d.depth)!.push(d.file);
  }
  for (const [d, files] of [...byDepth.entries()].sort((a, b) => a[0] - b[0])) {
    out.push(`  ${t.depth} ${d} (${files.length}):`);
    for (const f of files.slice(0, 12)) out.push(`    ${f}`);
    if (files.length > 12) out.push(`    ${t.more(files.length - 12)}`);
  }
  return out.join('\n');
}

function riskKey(r: ImpactReport['risk']): 'low' | 'medium' | 'high' { return r; }

export function formatImpactReportMd(r: ImpactReport, lang: 'fr' | 'en' = 'fr'): string {
  const t = lang === 'en'
    ? {
        title: 'Impact analysis', target: 'Target', exports: 'Exported symbols',
        direct: 'Direct dependents', total: 'Total blast radius', files: 'code files',
        inCycle: 'part of a dependency cycle', entry: 'entry point',
        risk: 'Risk', low: 'LOW', medium: 'MEDIUM', high: 'HIGH',
        colDepth: 'Depth', colFile: 'File', none: '_None — nothing imports this file._',
        more: (n: number) => `_…and ${n} more_`,
      }
    : {
        title: 'Analyse d’impact', target: 'Cible', exports: 'Symboles exportés',
        direct: 'Dépendants directs', total: 'Rayon d’impact total', files: 'fichiers de code',
        inCycle: 'dans un cycle de dépendances', entry: 'point d’entrée',
        risk: 'Risque', low: 'FAIBLE', medium: 'MOYEN', high: 'ÉLEVÉ',
        colDepth: 'Profondeur', colFile: 'Fichier', none: '_Aucun — rien n’importe ce fichier._',
        more: (n: number) => `_…et ${n} autres_`,
      };

  const tags = [r.isEntry ? t.entry : '', r.inCycle ? t.inCycle : ''].filter(Boolean).join(' · ');
  const out: string[] = [];
  out.push(`## ${RISK_ICON[r.risk]} ${t.title} — \`${basename(r.projectPath)}\``);
  out.push('');
  out.push(`**${t.target} : \`${r.target}\`${r.symbol ? `#\`${r.symbol}\`` : ''}**${tags ? ` — _${tags}_` : ''}`);
  out.push('');
  out.push(`- **${t.exports}** : ${r.exportedSymbols.length ? r.exportedSymbols.map(s => `\`${s.name}\``).join(', ') : '—'}`);
  out.push(`- **${t.direct}** : ${r.directCount} · **${t.total}** : **${r.dependents.length}** / ${r.totalFiles} ${t.files} (**${Math.round(r.percent * 100)}%**)`);
  out.push(`- **${t.risk}** : **${t[riskKey(r.risk)]}**`);
  out.push('');
  if (!r.dependents.length) {
    out.push(t.none);
    return out.join('\n');
  }
  out.push(`| ${t.colDepth} | ${t.colFile} |`, '|---|---|');
  for (const d of r.dependents.slice(0, 30)) out.push(`| ${d.depth} | \`${d.file}\` |`);
  if (r.dependents.length > 30) out.push(`| | ${t.more(r.dependents.length - 30)} |`);
  return out.join('\n');
}
