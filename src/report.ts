// Deterministic full report — a complete structured audit built purely from
// static analysis: index stats, import graph, package manifest, health report.
// Zero LLM, zero network — same project in → same report out.
import { readFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { getIndex } from './indexer.js';
import { analyzeProject, collectImportGraph, formatHealthReportMd, looksLikeEntry } from './analysis.js';
import type { HealthReport } from './analysis.js';

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

interface Reco { severity: 'Critique' | 'Élevée' | 'Moyenne' | 'Faible'; text: string; }

function recommendations(r: HealthReport, hasTests: boolean, lang: 'fr' | 'en'): Reco[] {
  const en = lang === 'en';
  const out: Reco[] = [];
  if (r.cycles.length) out.push({
    severity: 'Critique',
    text: en
      ? `Break ${r.cycles.length} circular dependenc${r.cycles.length > 1 ? 'ies' : 'y'} — e.g. \`${r.cycles[0].path[0]}\` ↔ \`${r.cycles[0].path[1] ?? r.cycles[0].path[0]}\`. Extract the shared contract into a leaf module.`
      : `Casser ${r.cycles.length} dépendance${r.cycles.length > 1 ? 's' : ''} circulaire${r.cycles.length > 1 ? 's' : ''} — ex. \`${r.cycles[0].path[0]}\` ↔ \`${r.cycles[0].path[1] ?? r.cycles[0].path[0]}\`. Extraire le contrat partagé dans un module feuille.`,
  });
  for (const h of r.hotspots.slice(0, 3)) out.push({
    severity: 'Élevée',
    text: en
      ? `Split \`${h.file}\` (complexity ${h.score}) — extract independent blocks into focused modules.`
      : `Découper \`${h.file}\` (complexité ${h.score}) — extraire les blocs indépendants dans des modules ciblés.`,
  });
  if (r.duplicates.length) out.push({
    severity: 'Moyenne',
    text: en
      ? `Factor ${r.duplicates.length} duplicated block${r.duplicates.length > 1 ? 's' : ''} — e.g. ${r.duplicates[0].files.map(f => `\`${f}\``).join(' / ')} share ${r.duplicates[0].lines} identical lines.`
      : `Factoriser ${r.duplicates.length} bloc${r.duplicates.length > 1 ? 's' : ''} dupliqué${r.duplicates.length > 1 ? 's' : ''} — ex. ${r.duplicates[0].files.map(f => `\`${f}\``).join(' / ')} partagent ${r.duplicates[0].lines} lignes identiques.`,
  });
  if (r.unusedFiles.length) out.push({
    severity: 'Moyenne',
    text: en
      ? `Review ${r.unusedFiles.length} unreferenced file${r.unusedFiles.length > 1 ? 's' : ''} — delete or wire them in (e.g. \`${r.unusedFiles[0]}\`).`
      : `Vérifier ${r.unusedFiles.length} fichier${r.unusedFiles.length > 1 ? 's' : ''} non référencé${r.unusedFiles.length > 1 ? 's' : ''} — supprimer ou brancher (ex. \`${r.unusedFiles[0]}\`).`,
  });
  if (r.unusedExports.length > 5) out.push({
    severity: 'Faible',
    text: en
      ? `Prune ${r.unusedExports.length} exports nobody imports — shrink the public surface.`
      : `Nettoyer ${r.unusedExports.length} exports que personne n'importe — réduire la surface publique.`,
  });
  if (!hasTests) out.push({
    severity: 'Élevée',
    text: en ? 'No test files detected — add a test suite before refactoring.' : 'Aucun fichier de test détecté — ajouter une suite de tests avant de refactorer.',
  });
  if (!out.length) out.push({
    severity: 'Faible',
    text: en ? 'Nothing structural to fix — keep the hygiene rules that got this score.' : 'Rien de structurel à corriger — garder les règles d\u2019hygiène qui ont produit ce score.',
  });
  return out;
}

export async function buildDeterministicReport(projectPath: string, lang: 'fr' | 'en' = 'fr'): Promise<string> {
  const en = lang === 'en';
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

  // --- Modules ------------------------------------------------------------
  const symbols = Object.values(index.files).reduce((s, f) => s + f.chunks.filter(c => c.name).length, 0);
  const hubs = [...graph.inDegree.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const entryPoints = graph.codeFiles.filter(f => looksLikeEntry(f, pkg)).slice(0, 10);
  const leaves = graph.codeFiles.filter(f => !graph.edges.some(e => e.from === f)).length;
  const hasTests = Object.keys(index.files).some(f => /test|spec|__tests__/i.test(f));

  const t = en
    ? {
        title: 'Deterministic report', genBy: 'generated by static analysis — no LLM, no network',
        summary: 'Executive summary', stack: 'Stack & structure', lang: 'Languages', deps: 'Runtime deps', devDeps: 'Dev deps', scripts: 'Scripts',
        arch: 'Module graph', hubs: 'Hub modules (most imported)', entries: 'Entry points', leaves: 'leaf modules', syms: 'symbols extracted',
        constraints: 'Product constraints', none: 'None declared',
        reco: 'Recommendations', sev: 'Severity', action: 'Action',
        verdict: (g: string) => ({ A: 'Excellent health — clean structure.', B: 'Good health — minor debt.', C: 'Correct — visible debt to watch.', D: 'Fragile — refactor before growing.', E: 'Critical — structural debt blocking.' }[g] ?? ''),
      }
    : {
        title: 'Rapport déterministe', genBy: 'généré par analyse statique — aucun LLM, aucun réseau',
        summary: 'Résumé exécutif', stack: 'Stack & structure', lang: 'Langages', deps: 'Dépendances runtime', devDeps: 'Dépendances dev', scripts: 'Scripts',
        arch: 'Graphe de modules', hubs: 'Modules hubs (les plus importés)', entries: 'Points d\u2019entrée', leaves: 'modules feuilles', syms: 'symboles extraits',
        constraints: 'Contraintes produit', none: 'Aucune déclarée',
        reco: 'Recommandations', sev: 'Sévérité', action: 'Action',
        verdict: (g: string) => ({ A: 'Excellente santé — structure propre.', B: 'Bonne santé — dette mineure.', C: 'Correct — dette visible à surveiller.', D: 'Fragile — refactorer avant de grossir.', E: 'Critique — dette structurelle bloquante.' }[g] ?? ''),
      };

  const out: string[] = [];
  out.push(`# 📊 ${t.title} — \`${name}\``);
  out.push(`_${t.genBy}_`, '');

  out.push(`## 1. ${t.summary}`);
  out.push(`**${bar(health.score)} ${health.score}/100 (${health.grade})** — ${t.verdict(health.grade)}`);
  out.push('');
  out.push(`- ${health.analyzedFiles} ${en ? 'code files' : 'fichiers de code'} · ${symbols} ${t.syms} · ${health.importEdges} ${en ? 'local imports' : 'imports locaux'} · ${leaves} ${t.leaves}`);
  out.push('');

  out.push(`## 2. ${t.stack}`);
  if (pkg.name) out.push(`- **${en ? 'Package' : 'Package'}** : \`${pkg.name}${pkg.version ? `@${pkg.version}` : ''}\``);
  if (langs.length) out.push(`- **${t.lang}** : ${langs.map(([l, n]) => `${l} (${n})`).join(', ')}`);
  if (deps.length) out.push(`- **${t.deps}** (${deps.length}) : ${deps.slice(0, 12).map(d => `\`${d}\``).join(', ')}${deps.length > 12 ? ' …' : ''}`);
  if (devDeps.length) out.push(`- **${t.devDeps}** (${devDeps.length}) : ${devDeps.slice(0, 8).map(d => `\`${d}\``).join(', ')}${devDeps.length > 8 ? ' …' : ''}`);
  if (scripts.length) out.push(`- **${t.scripts}** : ${scripts.map(s => `\`${s}\``).join(', ')}`);
  out.push('');

  out.push(`## 3. ${t.arch}`);
  if (hubs.length) {
    out.push(`**${t.hubs}** :`, '');
    for (const [f, n] of hubs) out.push(`- \`${f}\` ← ${n} ${en ? 'importers' : 'importeurs'}`);
    out.push('');
  }
  if (entryPoints.length) {
    out.push(`**${t.entries}** : ${entryPoints.map(f => `\`${f}\``).join(', ')}`, '');
  }

  out.push(`## 4. ${t.constraints}`);
  out.push(index.constraints.length ? index.constraints.map(c => `- ${c}`).join('\n') : t.none, '');

  out.push(formatHealthReportMd(health, lang).replace(/^## /, '## 5. ').replace(/\n### /g, '\n#### '), '');

  out.push(`## 6. ${t.reco}`, '');
  out.push(`| ${t.sev} | ${t.action} |`, '|---|---|');
  const SEV_ICON: Record<Reco['severity'], string> = { Critique: '🔴', 'Élevée': '🟠', Moyenne: '🟡', Faible: '🔵' };
  for (const r of recommendations(health, hasTests, lang)) out.push(`| ${SEV_ICON[r.severity]} ${r.severity} | ${r.text} |`);
  out.push('');
  out.push('---');
  out.push(`_${en ? 'Made with passion by shinzarou-eng' : 'Fait avec passion par shinzarou-eng'} — dsh-codebase-chat · ${en ? 'deterministic mode' : 'mode déterministe'}_`);

  return out.join('\n');
}
