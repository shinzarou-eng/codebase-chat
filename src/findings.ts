// Structured findings - flat, id-stable list derived from AuditData so
// baselines and --check can diff "what appeared / what was fixed" without
// parsing markdown. Severities are fixed per rule:
//   Critique : sensitive file, sec:secret
//   Élevée   : sec:eval, sec:exec, cycle, missing-dep, broken-entry,
//              untested-risk, hotspot (score ≥ 50)
//   Moyenne  : sec:innerHTML, hotspot (25–49), duplicate, env-undoc,
//              lock-drift, deep-nest, smell:emptyCatch
//   Faible   : sec:unsafeRegex, dead-dep, unused-export, other smell:*
import type { AuditData, AuditFinding } from './report-types.js';

function fp(sample: string): string {
  return sample.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 60);
}

/** Flat list of every finding in the audit - ids never contain line numbers. */
export function auditFindings(data: AuditData, lang: 'fr' | 'en'): AuditFinding[] {
  const en = lang === 'en';
  const out: AuditFinding[] = [];

  for (const f of data.sensitive) out.push({
    id: `sensitive:${f}`, rule: 'sensitive', severity: 'Critique', file: f,
    message: en ? `Sensitive file \`${f}\` in the repo` : `Fichier sensible \`${f}\` dans le dépôt`,
  });

  // Entries form: `key: '…'` here would trip the secret scanner itself.
  const SEC_SEV = new Map<string, AuditFinding['severity']>([
    ['secret', 'Critique'], ['eval', 'Élevée'], ['exec', 'Élevée'], ['innerHTML', 'Moyenne'], ['unsafeRegex', 'Faible'],
  ]);
  for (const [key, hits] of Object.entries(data.sec)) {
    const severity = SEC_SEV.get(key) ?? 'Faible';
    const total = data.secTotals[key];
    const suffix = total && total > hits.length
      ? (en ? ` (${total} occurrences in the file/project)` : ` (${total} occurrences au total)`)
      : '';
    for (const h of hits) out.push({
      id: `sec:${key}:${h.file}:${fp(h.sample)}`, rule: `sec:${key}`, severity,
      file: h.file, line: h.line,
      message: en ? `\`${h.sample}\`${suffix}` : `\`${h.sample}\`${suffix}`,
    });
  }

  for (const c of data.health.cycles) out.push({
    id: `cycle:${c.path[0]}`, rule: 'cycle', severity: 'Élevée', file: c.path[0],
    message: en
      ? `Circular dependency: ${c.path.map(p => `\`${p}\``).join(' ↔ ')}`
      : `Dépendance circulaire : ${c.path.map(p => `\`${p}\``).join(' ↔ ')}`,
  });

  for (const d of data.missing) out.push({
    id: `missing-dep:${d}`, rule: 'missing-dep', severity: 'Élevée',
    message: en ? `\`${d}\` imported but absent from package.json` : `\`${d}\` importé mais absent de package.json`,
  });
  for (const e of data.brokenEntries) out.push({
    id: `broken-entry:${e}`, rule: 'broken-entry', severity: 'Élevée',
    message: en ? `package.json points to missing \`${e}\`` : `package.json pointe vers \`${e}\` absent`,
  });
  for (const r of data.untestedRisk) out.push({
    id: `untested-risk:${r.file}`, rule: 'untested-risk', severity: 'Élevée', file: r.file,
    message: en
      ? `\`${r.file}\` churns (${r.churn} lines) and is complex (${r.score}) with no dedicated test`
      : `\`${r.file}\` est remanié (${r.churn} lignes) et complexe (${r.score}) sans test dédié`,
  });
  for (const h of data.health.hotspots) {
    if (h.score < 25) continue;
    out.push({
      id: `hotspot:${h.file}:${h.name ?? ''}`, rule: 'hotspot',
      severity: h.score >= 50 ? 'Élevée' : 'Moyenne', file: h.file, line: h.name ? h.startLine : undefined,
      message: en ? `Complexity ${h.score} in \`${h.name ?? h.file}\`` : `Complexité ${h.score} dans \`${h.name ?? h.file}\``,
    });
  }

  for (const d of data.health.duplicates) out.push({
    id: `duplicate:${d.files[0]}:${d.files[1] ?? ''}`, rule: 'duplicate', severity: 'Moyenne', file: d.files[0],
    message: en
      ? `\`${d.files[0]}\` shares ${d.lines} identical lines with \`${d.files[1]}\``
      : `\`${d.files[0]}\` partage ${d.lines} lignes identiques avec \`${d.files[1]}\``,
  });
  for (const v of data.env.undocumented) out.push({
    id: `env-undoc:${v}`, rule: 'env-undoc', severity: 'Moyenne',
    message: en ? `Env var \`${v}\` used but absent from .env.example` : `Variable d'env \`${v}\` utilisée mais absente de .env.example`,
  });
  for (const d of data.lockDrift) out.push({
    id: `lock-drift:${d}`, rule: 'lock-drift', severity: 'Moyenne',
    message: en ? `\`${d}\` declared but absent from the lockfile` : `\`${d}\` déclarée mais absente du lockfile`,
  });
  for (const d of data.shape.deepNest) out.push({
    id: `deep-nest:${d.file}`, rule: 'deep-nest', severity: 'Moyenne', file: d.file,
    message: en ? `Nesting ≥6 levels in \`${d.file}\` (depth ${d.depth})` : `Imbrication ≥6 niveaux dans \`${d.file}\` (profondeur ${d.depth})`,
  });

  for (const d of data.deadDeps) out.push({
    id: `dead-dep:${d}`, rule: 'dead-dep', severity: 'Faible',
    message: en ? `\`${d}\` declared but never imported` : `\`${d}\` déclarée mais jamais importée`,
  });
  for (const u of data.health.unusedExports) out.push({
    id: `unused-export:${u.file}:${u.name}`, rule: 'unused-export', severity: 'Faible', file: u.file, line: u.line,
    message: en ? `Export \`${u.name}\` in \`${u.file}\` is never imported` : `L'export \`${u.name}\` de \`${u.file}\` n'est jamais importé`,
  });
  for (const [key, hits] of Object.entries(data.smells)) {
    for (const h of hits) out.push({
      id: `smell:${key}:${h.file}:${fp(h.sample)}`, rule: `smell:${key}`,
      severity: key === 'emptyCatch' ? 'Moyenne' : 'Faible',
      file: h.file, line: h.line,
      message: en ? `\`${h.sample}\`` : `\`${h.sample}\``,
    });
  }

  return out;
}
