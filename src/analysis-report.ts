import { basename } from 'node:path';
import type { Cycle, HealthReport } from './analysis-types.js';

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
