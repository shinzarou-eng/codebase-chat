// Deterministic Markdown rendering - same AuditData in → same report out.
import { formatHealthReportMd } from './analysis.js';
import { recommendations } from './recommendations.js';
import type { Reco } from './recommendations.js';
import { countHits } from './report-scan.js';
import { collectAudit, hasDedicatedTest } from './report-collect.js';
import { auditStrings } from './report-i18n.js';
import type { AuditData } from './report-types.js';

function bar(score: number): string {
  const filled = Math.round(score / 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

export function renderAuditMd(data: AuditData, lang: 'fr' | 'en' = 'fr'): string {
  const en = lang === 'en';
  const { index, graph, health, name, pkg, langs, deps, devDeps, scripts, symbols, hubs, entryPoints, leaves, testFiles, testRatio, largest, docs, smells, sec, secTotals, hasTests, git, infra, env, deadDeps, missing, lockDrift, fnComplex, dupNames, asyncNoAwait, maxDepth, cfg, longFns, brokenEntries, deepRel, shape, readme, commitQ, typedFiles, typedPct, staleHubs, sensitive, docCov, docPct, riskFiles, untestedRisk, testBases, topChurn } = data;

  const t = auditStrings(lang);

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
  out.push(`_${en ? 'Made with passion by shinzarou-eng' : 'Fait avec passion par shinzarou-eng'} — codebase-chat · ${en ? 'deterministic mode' : 'mode déterministe'}_`);

  return out.join('\n');
}

export async function buildDeterministicReport(projectPath: string, lang: 'fr' | 'en' = 'fr'): Promise<string> {
  return renderAuditMd(await collectAudit(projectPath), lang);
}
