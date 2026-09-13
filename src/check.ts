// --check — "verify my changes": blast radius + findings on the files changed
// vs a git ref, diffed against the committed baseline when one exists.
import { basename } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { findProjectRoot, resolveProjectPath } from './project.js';
import { getChangedFiles } from './diff.js';
import { collectAudit, hasDedicatedTest } from './report.js';
import { auditFindings } from './findings.js';
import { readBaseline, diffFindings } from './baseline.js';
import { readIgnores, splitIgnored } from './ignores.js';
import { analyzeImpact, type ImpactReport } from './impact.js';
import { isTestPath } from './analysis.js';
import type { AuditFinding, Severity } from './report-types.js';

const run = promisify(execFile);

export interface CheckFile {
  file: string;
  impact?: ImpactReport;
  complexity?: number;
  hasTest: boolean;
  /** Test files worth running for this change — dedicated spec + importers. */
  tests: string[];
  findings: AuditFinding[];
}

export interface CheckReport {
  project: string;
  base: string;
  head?: string;
  changedFiles: string[];
  files: CheckFile[];
  score: number;
  baselineScore?: number;
  diff: ReturnType<typeof diffFindings>;
  hasBaseline: boolean;
  /** Silenced findings still present — listed, never counted in the verdict. */
  ignored: AuditFinding[];
  verdict: 'red' | 'yellow' | 'green';
  reasons: string[];
  /** Set when the diff could not be computed (bad ref, not a git repo) — the
   *  check could not verify anything, so the verdict is never green. */
  scopeError?: string;
}

const isTestFile = isTestPath;

const RISK_RANK: Record<ImpactReport['risk'], number> = { high: 2, medium: 1, low: 0 };
const SEV_RANK: Record<Severity, number> = { 'Critique': 3, 'Élevée': 2, 'Moyenne': 1, 'Faible': 0 };

export async function runCheck(projectPath: string, opts: { base?: string; lang: 'fr' | 'en' }): Promise<CheckReport> {
  const base = opts.base ?? 'HEAD';
  const abs = await findProjectRoot(resolveProjectPath(projectPath));
  const scope = await getChangedFiles(abs, base);
  const data = await collectAudit(abs);

  const changed = scope.ok ? [...scope.files] : [];
  const targets = changed.filter(f => data.graph.codeFiles.includes(f));

  const allFindings = auditFindings(data, opts.lang);
  const ignores = await readIgnores(abs);
  const { active: findings, ignored } = splitIgnored(allFindings, ignores);
  const complexityByFile = new Map<string, number>();
  for (const h of data.health.hotspots) {
    complexityByFile.set(h.file, Math.max(complexityByFile.get(h.file) ?? 0, h.score));
  }

  // Test files that directly import a changed file — worth running.
  const testsByFile = new Map<string, Set<string>>();
  for (const e of data.graph.edges) {
    if (!isTestFile(e.from)) continue;
    let s = testsByFile.get(e.to);
    if (!s) testsByFile.set(e.to, s = new Set());
    s.add(e.from);
  }
  const dedicated = (f: string) => {
    const base = basename(f).replace(/\.[^.]+$/, '').toLowerCase();
    return data.testFiles.filter(t => basename(t).replace(/\.(test|spec)\.[^.]+$/i, '').toLowerCase() === base);
  };

  const files: CheckFile[] = [];
  for (const f of targets) {
    const r = await analyzeImpact(abs, f, data.graph);
    files.push({
      file: f,
      impact: r.ok ? r.report : undefined,
      complexity: complexityByFile.get(f),
      hasTest: hasDedicatedTest(data.testBases, f),
      tests: [...new Set([...dedicated(f), ...(testsByFile.get(f) ?? [])])].sort(),
      findings: findings.filter(x => x.file === f),
    });
  }
  const riskOf = (cf: CheckFile) => cf.impact ? RISK_RANK[cf.impact.risk] : -1;
  files.sort((a, b) => riskOf(b) - riskOf(a) || (b.complexity ?? 0) - (a.complexity ?? 0) || a.file.localeCompare(b.file));

  const baseline = await readBaseline(abs);
  // Diff against ALL findings so an ignored-but-still-present finding stays
  // "unchanged" rather than looking resolved; the verdict ignores them below.
  const diff = diffFindings(baseline, allFindings);
  const ignoredIds = new Set(ignored.map(f => f.id));
  // Added findings only matter for the verdict when they belong to a changed
  // file — or are file-less (deps/config findings caused by the change).
  const relevant = (baseline
    ? [...diff.added, ...diff.escalated].filter(f => !f.file || changed.includes(f.file))
    : files.flatMap(f => f.findings)
  ).filter(f => !ignoredIds.has(f.id));
  const maxAddedSev = relevant.reduce((m, f) => Math.max(m, SEV_RANK[f.severity]), -1);
  const maxRisk = files.reduce((m, f) => Math.max(m, riskOf(f)), -1);
  const scopeError = scope.ok ? undefined : (scope.error ?? 'diff failed');
  // Fail closed: when the change set cannot be established (bad ref, not a
  // git repo), the check verified nothing — green would be a lie.
  const verdict: CheckReport['verdict'] =
    !scope.ok ? 'red'
    : maxAddedSev >= SEV_RANK['Élevée'] || maxRisk === RISK_RANK.high ? 'red'
    : maxAddedSev >= SEV_RANK.Moyenne || maxRisk === RISK_RANK.medium ? 'yellow'
    : 'green';

  const en = opts.lang === 'en';
  const deps = (n: number) => en ? `${n} direct dependent${n === 1 ? '' : 's'}` : `${n} dépendant${n === 1 ? '' : 's'} direct${n === 1 ? '' : 's'}`;
  const reasons: string[] = [];
  for (const cf of files) {
    if (!cf.impact) continue;
    if (cf.impact.risk === 'high') reasons.push(en ? `High impact: \`${cf.file}\` (${deps(cf.impact.directCount)})` : `Impact élevé : \`${cf.file}\` (${deps(cf.impact.directCount)})`);
    else if (cf.impact.risk === 'medium') reasons.push(en ? `Medium impact: \`${cf.file}\` (${deps(cf.impact.directCount)})` : `Impact moyen : \`${cf.file}\` (${deps(cf.impact.directCount)})`);
  }
  if (scopeError) {
    reasons.push(en
      ? `Could not diff vs \`${base}\` — nothing was verified (${scopeError})`
      : `Diff impossible vs \`${base}\` — rien n'a été vérifié (${scopeError})`);
  }
  const grouped = new Map<string, { sev: Severity; n: number }>();
  for (const f of relevant) {
    if (SEV_RANK[f.severity] < SEV_RANK.Moyenne) continue;
    const k = `${f.rule}|${f.file ?? ''}`;
    const g = grouped.get(k) ?? { sev: f.severity, n: 0 };
    g.n++; grouped.set(k, g);
  }
  for (const [k, g] of grouped) {
    const [rule, file] = k.split('|');
    const lbl = en
      ? ({ Critique: 'critical', 'Élevée': 'high', Moyenne: 'medium', Faible: 'low' } as Record<Severity, string>)[g.sev]
      : g.sev;
    reasons.push(en
      ? `New ${lbl} finding${g.n > 1 ? `s (×${g.n})` : ''}: \`${rule}\`${file ? ` in \`${file}\`` : ''}`
      : `Nouveau${g.n > 1 ? 'x' : ''} finding${g.n > 1 ? 's' : ''} ${lbl} : \`${rule}\`${file ? ` dans \`${file}\`` : ''}${g.n > 1 ? ` (×${g.n})` : ''}`);
  }

  let head: string | undefined = baseline?.head;
  if (scope.ok) {
    try {
      head = (await run('git', ['-C', abs, 'rev-parse', '--short', 'HEAD'])).stdout.trim() || head;
    } catch { /* keep baseline head */ }
  }

  return { project: abs, base, head, changedFiles: changed, files, score: data.health.score, baselineScore: baseline?.score, diff, hasBaseline: !!baseline, ignored, verdict, reasons, scopeError };
}

const SEV_ICON: Record<Severity, string> = { Critique: '🔴', 'Élevée': '🟠', Moyenne: '🟡', Faible: '🔵' };

export function formatCheckMd(r: CheckReport, lang: 'fr' | 'en'): string {
  const en = lang === 'en';
  const out: string[] = [];
  const name = basename(r.project);
  const V = { red: '🔴', yellow: '🟡', green: '🟢' }[r.verdict];
  const verdictTxt = en
    ? { red: 'Blocking findings or high-impact changes — review before merging.', yellow: 'Watch out — new medium findings or medium-impact changes.', green: 'All clear — no blocking finding on the changed files.' }[r.verdict]
    : { red: 'Findings bloquants ou changements à fort impact — revue avant merge.', yellow: 'Vigilance — nouveaux findings moyens ou impact moyen.', green: 'RAS — aucun finding bloquant sur les fichiers modifiés.' }[r.verdict];

  out.push(`# ${V} ${en ? 'Check' : 'Check'} — \`${name}\``, '');
  out.push(`## 1. ${en ? 'Verdict' : 'Verdict'}`);
  out.push(`**${verdictTxt}${r.hasBaseline ? '' : (en ? ' (no baseline: every finding on the changed files counts)' : ' (sans baseline : tous les findings des fichiers modifiés comptent)')}**`);
  for (const rs of r.reasons) out.push(`- ${rs}`);
  out.push('');
  if (r.scopeError) {
    out.push(`> ⚠ ${en ? `The diff vs \`${r.base}\` failed — the file list is empty and the verdict cannot be trusted as a pass.` : `Le diff vs \`${r.base}\` a échoué — la liste de fichiers est vide et le verdict ne peut pas être lu comme un feu vert.`}`);
    out.push('');
  }
  const delta = r.baselineScore !== undefined ? ` (${en ? 'baseline' : 'baseline'} ${r.baselineScore}/100, ${r.score - r.baselineScore >= 0 ? '+' : ''}${r.score - r.baselineScore})` : '';
  out.push(`- ${r.changedFiles.length} ${en ? `file(s) changed vs \`${r.base}\`` : `fichier(s) modifié(s) vs \`${r.base}\``}${r.head ? ` · HEAD \`${r.head}\`` : ''}`);
  out.push(`- ${en ? 'Score' : 'Score'} : **${r.score}/100**${delta}`);
  out.push('');

  let n = 2;
  for (const cf of r.files) {
    out.push(`## ${n++}. \`${cf.file}\``);
    if (cf.impact) {
      const ri = { low: '🟢', medium: '🟡', high: '🔴' }[cf.impact.risk];
      out.push(`- ${en ? 'Impact' : 'Impact'} : ${ri} **${cf.impact.risk}** — ${cf.impact.directCount} ${en ? 'direct dependents' : 'dépendants directs'} · ${cf.impact.dependents.length}/${cf.impact.totalFiles} ${en ? 'blast radius' : 'rayon'} (${Math.round(cf.impact.percent * 100)}%)`);
    }
    if (cf.complexity !== undefined) out.push(`- ${en ? 'Complexity' : 'Complexité'} : ${cf.complexity}`);
    out.push(`- ${en ? 'Dedicated test' : 'Test dédié'} : ${cf.hasTest ? (en ? 'yes' : 'oui') : (en ? 'no' : 'non')}`);
    if (cf.tests.length) out.push(`- ${en ? 'Tests to run' : 'Tests à lancer'} : ${cf.tests.map(t => `\`${t}\``).join(', ')}`);
    out.push('');
    if (cf.findings.length) {
      out.push(`| ${en ? 'Severity' : 'Sévérité'} | ${en ? 'Rule' : 'Règle'} | ${en ? 'Line' : 'Ligne'} | ${en ? 'Finding' : 'Constat'} |`, '|---|---|---|---|');
      for (const f of cf.findings) out.push(`| ${SEV_ICON[f.severity]} ${f.severity} | \`${f.rule}\` | ${f.line ?? '—'} | ${f.message} |`);
    } else {
      out.push(en ? '_No finding._' : '_Aucun finding._');
    }
    out.push('');
  }

  out.push(`## ${n}. ${en ? 'Vs baseline' : 'Vs baseline'}`);
  if (!r.hasBaseline) {
    out.push(en
      ? '_No baseline — run `--baseline` to create one._'
      : '_Aucune baseline — `--baseline` pour en créer une._');
  } else {
    const ignoredIds = new Set(r.ignored.map(f => f.id));
    const added = r.diff.added.filter(f => !ignoredIds.has(f.id));
    if (added.length) {
      out.push('', en ? '**New findings** :' : '**Nouveaux findings** :', '');
      out.push(`| ${en ? 'Severity' : 'Sévérité'} | ${en ? 'Rule' : 'Règle'} | ${en ? 'Line' : 'Ligne'} | ${en ? 'Finding' : 'Constat'} |`, '|---|---|---|---|');
      for (const f of added) out.push(`| ${SEV_ICON[f.severity]} ${f.severity} | \`${f.rule}\` | ${f.line ?? '—'} | ${f.message} |`);
    }
    const escalated = r.diff.escalated.filter(f => !ignoredIds.has(f.id));
    if (escalated.length) {
      out.push('', en ? '**Severity increased since baseline** :' : '**Sévérité aggravée depuis la baseline** :', '');
      out.push(`| ${en ? 'Severity' : 'Sévérité'} | ${en ? 'Rule' : 'Règle'} | ${en ? 'Line' : 'Ligne'} | ${en ? 'Finding' : 'Constat'} |`, '|---|---|---|---|');
      for (const f of escalated) out.push(`| ${SEV_ICON[f.severity]} ${f.severity} | \`${f.rule}\` | ${f.line ?? '—'} | ${f.message} |`);
    }
    if (r.diff.resolved.length) {
      out.push('', en ? '**Resolved** :' : '**Résolus** :', '');
      for (const f of r.diff.resolved) out.push(`- ${SEV_ICON[f.severity]} \`${f.rule}\`${f.file ? ` — \`${f.file}\`` : ''}`);
    }
    out.push('', en ? `_${r.diff.unchanged} unchanged finding(s)._` : `_${r.diff.unchanged} finding(s) inchangé(s)._`);
  }
  if (r.ignored.length) {
    out.push('', `## ${++n}. ${en ? 'Ignored' : 'Ignorés'}`);
    out.push(en ? '_Silenced with a justification — never counted in the verdict._' : '_Passés sous silence avec justification — jamais comptés dans le verdict._', '');
    for (const f of r.ignored) out.push(`- ${SEV_ICON[f.severity]} \`${f.rule}\`${f.file ? ` — \`${f.file}\`` : ''}`);
  }
  out.push('', '---');
  out.push(`_${en ? 'Made with passion by shinzarou-eng' : 'Fait avec passion par shinzarou-eng'} — dsh-codebase-chat · ${en ? 'deterministic mode' : 'mode déterministe'}_`);
  return out.join('\n');
}
