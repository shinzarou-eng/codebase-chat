// Severity-ranked recommendations for the deterministic report - pure function,
// every finding already collected by report.ts scanners. Extracted so it can be
// unit-tested without running the whole audit.
import type { HealthReport } from './analysis.js';
import type { Finding, GitStats, SmellScan } from './report-types.js';

export interface Reco { severity: 'Critique' | 'Élevée' | 'Moyenne' | 'Faible'; text: string; }

export interface RecoExtras {
  sensitive: string[]; envUndoc: string[]; deadDeps: string[]; tsStrict: boolean | null;
  untestedRisk: string[]; brokenEntries: string[]; deepRel: number; deepNest: string[];
  commitConv: number | null; missingDeps: string[]; lockDrift: string[];
  /** True hit counts per sink kind (uncapped) - samples in `sec` are per-file capped */
  secTotals?: Record<string, number>;
}

export function recommendations(r: HealthReport, hasTests: boolean, smells: SmellScan, sec: SmellScan, git: GitStats | null, infra: string[], riskFiles: { file: string; churn: number; commits?: number; score: number }[], extras: RecoExtras, lang: 'fr' | 'en'): Reco[] {
  const en = lang === 'en';
  const out: Reco[] = [];
  if (extras.missingDeps.length) out.push({
    severity: 'Critique',
    text: en
      ? `${extras.missingDeps.length} package${extras.missingDeps.length > 1 ? 's' : ''} imported but absent from package.json: ${extras.missingDeps.map(d => `\`${d}\``).join(', ')} — installs will break for everyone else.`
      : `${extras.missingDeps.length} package${extras.missingDeps.length > 1 ? 's' : ''} importé${extras.missingDeps.length > 1 ? 's' : ''} mais absent${extras.missingDeps.length > 1 ? 's' : ''} de package.json : ${extras.missingDeps.map(d => `\`${d}\``).join(', ')} — l’install cassera chez les autres.`,
  });
  if (extras.brokenEntries.length) out.push({
    severity: 'Critique',
    text: en
      ? `package.json points to missing files: ${extras.brokenEntries.map(e => `\`${e}\``).join(', ')} — the package is broken for consumers.`
      : `package.json pointe vers des fichiers absents : ${extras.brokenEntries.map(e => `\`${e}\``).join(', ')} — le package est cassé pour les consommateurs.`,
  });
  if (extras.sensitive.length) out.push({
    severity: 'Critique',
    text: en
      ? `Sensitive file${extras.sensitive.length > 1 ? 's' : ''} in the repo — e.g. \`${extras.sensitive[0]}\`${git?.sensitiveTracked.includes(extras.sensitive[0]) ? ' (tracked by git — purge history + rotate secrets)' : ''}. Add to .gitignore.`
      : `Fichier${extras.sensitive.length > 1 ? 's' : ''} sensible${extras.sensitive.length > 1 ? 's' : ''} dans le dépôt — ex. \`${extras.sensitive[0]}\`${git?.sensitiveTracked.includes(extras.sensitive[0]) ? ' (suivi par git — purger l’historique + révoquer les secrets)' : ''}. Ajouter au .gitignore.`,
  });
  if (sec.secret?.length) out.push({
    severity: 'Critique',
    text: en
      ? `${sec.secret.length} potential hardcoded secret${sec.secret.length > 1 ? 's' : ''} — e.g. \`${sec.secret[0].file}:${sec.secret[0].line}\`. Move to env vars, rotate if ever committed.`
      : `${sec.secret.length} secret${sec.secret.length > 1 ? 's' : ''} potentiellement codé${sec.secret.length > 1 ? 's' : ''} en dur — ex. \`${sec.secret[0].file}:${sec.secret[0].line}\`. Déplacer en variables d'env, révoquer si déjà commité.`,
  });
  if (sec.eval?.length || sec.exec?.length || sec.innerHTML?.length) {
    const detected = [['eval', sec.eval], ['exec', sec.exec], ['innerHTML', sec.innerHTML]]
      .filter(([, v]) => (v as Finding[] | undefined)?.length) as [string, Finding[]][];
    const kinds = detected.map(([k]) => k).join('/');
    const all = detected.flatMap(([, v]) => v);
    const f = all[0];
    const onlyMarkup = !sec.eval?.length && !sec.exec?.length;
    const n = extras.secTotals
      ? detected.reduce((s, [k]) => s + (extras.secTotals![k] ?? 0), 0)
      : all.length;
    const fileCount = new Set(all.map(x => x.file)).size;
    out.push({
      // innerHTML alone is a review item, not an alarm - eval/exec can execute
      // injected code directly, innerHTML needs an unescaped injection surface.
      severity: onlyMarkup ? 'Moyenne' : 'Élevée',
      text: en
        ? `${n} ${kinds} sink${n > 1 ? 's' : ''} across ${fileCount} file${fileCount > 1 ? 's' : ''} — e.g. \`${f.file}:${f.line}\`. ${onlyMarkup ? 'Verify every interpolated value is escaped.' : 'Audit each call site.'}`
        : `${n} sink${n > 1 ? 's' : ''} ${kinds} dans ${fileCount} fichier${fileCount > 1 ? 's' : ''} — ex. \`${f.file}:${f.line}\`. ${onlyMarkup ? 'Vérifier que chaque valeur interpolée est échappée.' : 'Auditer chaque site d\'appel.'}`,
    });
  }
  if (riskFiles.length) {
    const top = riskFiles[0];
    const commitInfo = top.commits ? (en ? ` across ${top.commits} commits` : ` sur ${top.commits} commits`) : '';
    out.push({
      severity: 'Élevée',
      text: en
        ? `\`${top.file}\` changes constantly AND is complex (${top.churn} lines churned${commitInfo}, complexity ${top.score})${extras.untestedRisk.includes(top.file) ? ' and has no dedicated test' : ''} — the classic defect magnet. Split it into focused modules and cover it with tests before touching it.`
        : `\`${top.file}\` est remanié souvent ET est complexe (${top.churn} lignes modifiées${commitInfo}, complexité ${top.score})${extras.untestedRisk.includes(top.file) ? ' et n’a pas de test dédié' : ''} — l'aimant à bugs classique. Le découper en modules ciblés et le couvrir de tests avant d'y toucher.`,
    });
  }
  if (extras.envUndoc.length) out.push({
    severity: 'Moyenne',
    text: en
      ? `${extras.envUndoc.length} env var${extras.envUndoc.length > 1 ? 's' : ''} used but absent from .env.example (e.g. \`${extras.envUndoc[0]}\`) — document them or setup will break for the next dev.`
      : `${extras.envUndoc.length} variable${extras.envUndoc.length > 1 ? 's' : ''} d’env utilisée${extras.envUndoc.length > 1 ? 's' : ''} mais absente${extras.envUndoc.length > 1 ? 's' : ''} de .env.example (ex. \`${extras.envUndoc[0]}\`) — les documenter sinon le setup cassera pour le prochain dev.`,
  });
  if (extras.lockDrift.length) out.push({
    severity: 'Moyenne',
    text: en
      ? `${extras.lockDrift.length} declared dep${extras.lockDrift.length > 1 ? 's' : ''} absent from the lockfile (${extras.lockDrift.map(d => `\`${d}\``).join(', ')}) — run the package manager to resync.`
      : `${extras.lockDrift.length} dépendance${extras.lockDrift.length > 1 ? 's' : ''} déclarée${extras.lockDrift.length > 1 ? 's' : ''} absente${extras.lockDrift.length > 1 ? 's' : ''} du lockfile (${extras.lockDrift.map(d => `\`${d}\``).join(', ')}) — relancer le package manager pour resynchroniser.`,
  });
  if (extras.tsStrict === false) out.push({
    severity: 'Moyenne',
    text: en ? 'TypeScript `strict` is off — enable it progressively (`strict: true` or `strictNullChecks` first).' : 'Le `strict` TypeScript est désactivé — l’activer progressivement (`strict: true` ou `strictNullChecks` d’abord).',
  });
  if (extras.deepRel > 3) out.push({
    severity: 'Moyenne',
    text: en
      ? `${extras.deepRel} deep relative imports (\`../../..\` 3+ levels) — expose a public barrel or move the module closer.`
      : `${extras.deepRel} imports relatifs profonds (\`../../..\` 3+ niveaux) — exposer un barrel public ou rapprocher le module.`,
  });
  if (extras.deepNest.length) out.push({
    severity: 'Moyenne',
    text: en
      ? `Nesting ≥6 levels in ${extras.deepNest.map(d => `\`${d}\``).join(', ')} — early returns / extraction will flatten it.`
      : `Imbrication ≥6 niveaux dans ${extras.deepNest.map(d => `\`${d}\``).join(', ')} — early returns / extraction pour aplatir.`,
  });
  if (extras.commitConv !== null && extras.commitConv < 50) out.push({
    severity: 'Faible',
    text: en
      ? `Only ${extras.commitConv}% of commits are conventional — a shared format makes history machine-readable.`
      : `Seulement ${extras.commitConv}% des commits sont conventionnels — un format partagé rend l'historique lisible par machine.`,
  });
  if (extras.deadDeps.length) out.push({
    severity: 'Faible',
    text: en
      ? `${extras.deadDeps.length} declared dependenc${extras.deadDeps.length > 1 ? 'ies are' : 'y is'} never imported (e.g. \`${extras.deadDeps[0]}\`) — remove to shrink install + audit surface.`
      : `${extras.deadDeps.length} dépendance${extras.deadDeps.length > 1 ? 's' : ''} déclarée${extras.deadDeps.length > 1 ? 's' : ''} jamais importée${extras.deadDeps.length > 1 ? 's' : ''} (ex. \`${extras.deadDeps[0]}\`) — retirer pour réduire l’install + la surface d’audit.`,
  });
  if (git && git.fileAuthors.size) {
    const soloHubs = riskFiles.filter(f => (git.fileAuthors.get(f.file)?.size ?? 0) <= 1);
    const solo = [...git.fileAuthors.entries()].filter(([, a]) => a.size === 1).length;
    const loneAuthor = git.authors.size <= 1;
    if (soloHubs.length || (git.churn.size && solo / git.fileAuthors.size > 0.7)) out.push({
      // One author total: "spread knowledge" is impossible - document instead.
      severity: loneAuthor ? 'Faible' : 'Moyenne',
      text: loneAuthor
        ? (en
          ? `Solo project: all ${solo} file${solo > 1 ? 's' : ''} known by one author${soloHubs.length ? ` — document the hot zones (e.g. \`${soloHubs[0].file}\`)` : ' — document the hot zones'} so a future contributor (or you in 6 months) can pick them up.`
          : `Projet solo : les ${solo} fichier${solo > 1 ? 's' : ''} ne sont connus que d’un auteur${soloHubs.length ? ` — documenter les zones chaudes (ex. \`${soloHubs[0].file}\`)` : ' — documenter les zones chaudes'} pour le futur contributeur (ou toi dans 6 mois).`)
        : (en
          ? `Bus factor: ${solo} file${solo > 1 ? 's' : ''} touched by a single author${soloHubs.length ? `, including hot \`${soloHubs[0].file}\`` : ''} — spread knowledge via reviews/pairing.`
          : `Bus factor : ${solo} fichier${solo > 1 ? 's' : ''} touché${solo > 1 ? 's' : ''} par un seul auteur${soloHubs.length ? `, dont le chaud \`${soloHubs[0].file}\`` : ''} — diffuser la connaissance via reviews/pairing.`),
    });
  }
  if (!infra.some(i => i.startsWith('CI'))) out.push({
    severity: 'Moyenne',
    text: en ? 'No CI pipeline detected — add one (tests + typecheck on every push).' : 'Aucune CI détectée — en ajouter une (tests + typecheck à chaque push).',
  });
  if (r.cycles.length) out.push({
    severity: 'Critique',
    text: en
      ? `Break ${r.cycles.length} circular dependenc${r.cycles.length > 1 ? 'ies' : 'y'} — e.g. \`${r.cycles[0].path[0]}\` ↔ \`${r.cycles[0].path[1] ?? r.cycles[0].path[0]}\`. Extract the shared contract into a leaf module.`
      : `Casser ${r.cycles.length} dépendance${r.cycles.length > 1 ? 's' : ''} circulaire${r.cycles.length > 1 ? 's' : ''} — ex. \`${r.cycles[0].path[0]}\` ↔ \`${r.cycles[0].path[1] ?? r.cycles[0].path[0]}\`. Extraire le contrat partagé dans un module feuille.`,
  });
  for (const h of r.hotspots.slice(0, 3)) {
    if (riskFiles[0]?.file === h.file) continue; // already covered by the churn × complexity reco
    out.push({
      severity: 'Élevée',
      text: en
        ? `Split \`${h.file}\` (complexity ${h.score}) — extract independent blocks into focused modules.`
        : `Découper \`${h.file}\` (complexité ${h.score}) — extraire les blocs indépendants dans des modules ciblés.`,
    });
  }
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
  if (smells.console && smells.console.length > 5) out.push({
    severity: 'Faible',
    text: en
      ? `${smells.console.length} console.* calls in production code — route through a logger (e.g. \`${smells.console[0].file}:${smells.console[0].line}\`).`
      : `${smells.console.length} appels console.* dans le code de prod — passer par un logger (ex. \`${smells.console[0].file}:${smells.console[0].line}\`).`,
  });
  if (smells.todo && smells.todo.length > 5) out.push({
    severity: 'Faible',
    text: en
      ? `${smells.todo.length} TODO/FIXME markers — triage into tracked issues.`
      : `${smells.todo.length} marqueurs TODO/FIXME — trier en tickets suivis.`,
  });
  if (!out.length) out.push({
    severity: 'Faible',
    text: en ? 'Nothing structural to fix — keep the hygiene rules that got this score.' : 'Rien de structurel à corriger — garder les règles d’hygiène qui ont produit ce score.',
  });
  return out;
}
