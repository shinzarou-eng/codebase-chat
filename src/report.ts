// Deterministic full report — a complete structured audit built purely from
// static analysis: index stats, import graph, package manifest, health report.
// Zero LLM, zero network — same project in → same report out.
import { readFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getIndex } from './indexer.js';
import { analyzeProject, collectImportGraph, formatHealthReportMd, looksLikeEntry } from './analysis.js';
import type { HealthReport } from './analysis.js';

const run = promisify(execFile);

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

// --- Deterministic smell & security scan ---------------------------------
// Every finding is a real file:line hit — grep-grade evidence, no guessing.

export interface Finding { file: string; line: number; sample: string; }
export interface SmellScan { [key: string]: Finding[]; }

const SMELL_PATS: [string, RegExp][] = [
  ['todo', /\b(?:TODO|FIXME|HACK|XXX|WIP)\b/i],
  ['console', /\bconsole\.(log|warn|error|debug|info)\s*\(/],
  ['tsIgnore', /@ts-(ignore|expect-error|nocheck)\b/],
  ['any', /:\s*any\b/],
  ['emptyCatch', /catch\s*\([^)]*\)\s*\{\s*\}/],
  ['debugger', /\bdebugger\s*;/],
];

const SEC_PATS: [string, RegExp][] = [
  ['secret', /(?:api[_-]?key|secret|passwd|password|token|private[_-]?key)\s*[:=]\s*['"`][A-Za-z0-9_\/+\-.]{8,}['"`]/i],
  ['eval', /\beval\s*\(|new\s+Function\s*\(/],
  ['exec', /\bexecSync\s*\(|child_process/],
  ['innerHTML', /\.innerHTML\s*=/],
  ['unsafeRegex', /new\s+RegExp\s*\([^'"`]/],
];

export function scanCode(fileTexts: Map<string, string>, pats: [string, RegExp][], perFileCap = 3): SmellScan {
  const out: SmellScan = {};
  for (const [file, text] of fileTexts) {
    if (/test|spec|__tests__|\.d\.ts$/i.test(file)) continue; // tests legitimately console/TODO
    const lines = text.split('\n');
    for (const [key, re] of pats) {
      let found = 0;
      for (let i = 0; i < lines.length && found < perFileCap; i++) {
        if (re.test(lines[i])) {
          (out[key] ??= []).push({ file, line: i + 1, sample: lines[i].trim().slice(0, 90) });
          found++;
        }
      }
    }
  }
  return out;
}

function countHits(scan: SmellScan): number {
  return Object.values(scan).reduce((s, f) => s + f.length, 0);
}

// --- Git activity (local, deterministic — no network) ----------------------

export interface GitStats {
  commits: number;
  authors: Map<string, number>;
  lastDate: string;
  /** file -> total added+deleted lines across history */
  churn: Map<string, number>;
  /** file -> distinct authors */
  fileAuthors: Map<string, Set<string>>;
}

async function gitActivity(abs: string): Promise<GitStats | null> {
  try {
    const { stdout } = await run('git', [
      '-C', abs, 'log', '--numstat', '--format=@@@%an|%ad', '--date=short', '-n', '400',
    ], { maxBuffer: 32 * 1024 * 1024 });
    const stats: GitStats = { commits: 0, authors: new Map(), lastDate: '', churn: new Map(), fileAuthors: new Map() };
    let author = '';
    for (const line of stdout.split('\n')) {
      if (line.startsWith('@@@')) {
        stats.commits++;
        const [a, d] = line.slice(3).split('|');
        author = a;
        if (!stats.lastDate) stats.lastDate = d;
        stats.authors.set(a, (stats.authors.get(a) ?? 0) + 1);
        continue;
      }
      const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
      if (!m || m[1] === '-') continue; // binary
      const file = m[3].replace(/\\/g, '/');
      const delta = Number(m[1]) + Number(m[2]);
      stats.churn.set(file, (stats.churn.get(file) ?? 0) + delta);
      if (author) (stats.fileAuthors.get(file) ?? stats.fileAuthors.set(file, new Set()).get(file)!).add(author);
    }
    return stats;
  } catch {
    return null; // not a git repo / no git
  }
}

/** Docstring coverage: exported declarations preceded by a comment line. */
function docCoverage(fileTexts: Map<string, string>): { documented: number; total: number } {
  let documented = 0, total = 0;
  const EXPORT_LINE = /^\s*export\s+(?:async\s+)?(?:function|class|const|let|interface|type|enum|default)\b/;
  for (const [file, text] of fileTexts) {
    if (/test|spec|__tests__|\.d\.ts$/i.test(file)) continue;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!EXPORT_LINE.test(lines[i])) continue;
      total++;
      let j = i - 1;
      while (j >= 0 && !lines[j].trim()) j--;
      if (j >= 0 && /^\s*(\/\/|\/\*|\*)/.test(lines[j])) documented++;
    }
  }
  return { documented, total };
}

/** Infra/config presence from indexed paths. */
function detectInfra(indexPaths: Set<string>): string[] {
  const found: string[] = [];
  const has = (p: string) => indexPaths.has(p) || [...indexPaths].some(f => f.startsWith(p));
  if (has('.github/workflows')) found.push('CI (GitHub Actions)');
  if (has('dockerfile') || has('docker-compose.yml')) found.push('Docker');
  if (has('tsconfig.json')) found.push('TypeScript config');
  if (has('pnpm-lock.yaml') || has('package-lock.json') || has('yarn.lock')) found.push('lockfile');
  if (has('vitest.config') || has('jest.config')) found.push('test runner config');
  if (has('.env.example') || has('.env.sample')) found.push('.env template');
  if (has('dockerfile')) found.push('container');
  if (has('vercel.json') || has('netlify.toml')) found.push('deploy config');
  if (has('eslint.config') || has('.eslintrc')) found.push('linter config');
  if (has('.prettierrc') || has('prettier.config')) found.push('formatter config');
  return [...new Set(found)];
}

interface Reco { severity: 'Critique' | 'Élevée' | 'Moyenne' | 'Faible'; text: string; }

function recommendations(r: HealthReport, hasTests: boolean, smells: SmellScan, sec: SmellScan, git: GitStats | null, infra: string[], riskFiles: { file: string; churn: number; score: number }[], lang: 'fr' | 'en'): Reco[] {
  const en = lang === 'en';
  const out: Reco[] = [];
  if (sec.secret?.length) out.push({
    severity: 'Critique',
    text: en
      ? `${sec.secret.length} potential hardcoded secret${sec.secret.length > 1 ? 's' : ''} — e.g. \`${sec.secret[0].file}:${sec.secret[0].line}\`. Move to env vars, rotate if ever committed.`
      : `${sec.secret.length} secret${sec.secret.length > 1 ? 's' : ''} potentiellement codé${sec.secret.length > 1 ? 's' : ''} en dur — ex. \`${sec.secret[0].file}:${sec.secret[0].line}\`. Déplacer en variables d'env, révoquer si déjà commité.`,
  });
  if (sec.eval?.length || sec.exec?.length || sec.innerHTML?.length) {
    const f = [...(sec.eval ?? []), ...(sec.exec ?? []), ...(sec.innerHTML ?? [])][0];
    out.push({
      severity: 'Élevée',
      text: en
        ? `Dangerous sinks detected (eval/exec/innerHTML) — e.g. \`${f.file}:${f.line}\`. Audit each call site.`
        : `Sinks dangereux détectés (eval/exec/innerHTML) — ex. \`${f.file}:${f.line}\`. Auditer chaque site d'appel.`,
    });
  }
  if (riskFiles.length) out.push({
    severity: 'Élevée',
    text: en
      ? `\`${riskFiles[0].file}\` changes constantly AND is complex (churn ${riskFiles[0].churn}, complexity ${riskFiles[0].score}) — the classic defect magnet. Cover it with tests before touching it.`
      : `\`${riskFiles[0].file}\` change sans cesse ET est complexe (churn ${riskFiles[0].churn}, complexité ${riskFiles[0].score}) — l'aimant à bugs classique. Couvrir de tests avant d'y toucher.`,
  });
  if (git && git.fileAuthors.size) {
    const soloHubs = riskFiles.filter(f => (git.fileAuthors.get(f.file)?.size ?? 0) <= 1);
    const solo = [...git.fileAuthors.entries()].filter(([, a]) => a.size === 1).length;
    if (soloHubs.length || (git.churn.size && solo / git.fileAuthors.size > 0.7)) out.push({
      severity: 'Moyenne',
      text: en
        ? `Bus factor: ${solo} file${solo > 1 ? 's' : ''} touched by a single author${soloHubs.length ? `, including hot \`${soloHubs[0].file}\`` : ''} — spread knowledge via reviews/pairing.`
        : `Bus factor : ${solo} fichier${solo > 1 ? 's' : ''} touché${solo > 1 ? 's' : ''} par un seul auteur${soloHubs.length ? `, dont le chaud \`${soloHubs[0].file}\`` : ''} — diffuser la connaissance via reviews/pairing.`,
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

  // --- Modules, smells, security -------------------------------------------
  const symbols = Object.values(index.files).reduce((s, f) => s + f.chunks.filter(c => c.name).length, 0);
  const hubs = [...graph.inDegree.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const entryPoints = graph.codeFiles.filter(f => looksLikeEntry(f, pkg)).slice(0, 10);
  const leaves = graph.codeFiles.filter(f => !graph.edges.some(e => e.from === f)).length;
  const testFiles = Object.keys(index.files).filter(f => /test|spec|__tests__/i.test(f));
  const srcFiles = graph.codeFiles.filter(f => !/test|spec|__tests__/i.test(f));
  const testRatio = srcFiles.length ? Math.round((testFiles.length / srcFiles.length) * 100) : 0;
  const largest = graph.codeFiles
    .map(f => ({ f, lines: graph.fileTexts.get(f)!.split('\n').length }))
    .sort((a, b) => b.lines - a.lines).slice(0, 5);
  const indexPaths = new Set(Object.keys(index.files).map(f => f.toLowerCase()));
  const docs = ['readme.md', 'license', 'license.md', 'changelog.md', 'contributing.md', 'security.md', 'agents.md']
    .filter(d => indexPaths.has(d));
  const smells = scanCode(graph.fileTexts, SMELL_PATS);
  const sec = scanCode(graph.fileTexts, SEC_PATS, 5);
  const hasTests = testFiles.length > 0;
  const git = await gitActivity(health.projectPath);
  const infra = detectInfra(indexPaths);
  const docCov = docCoverage(graph.fileTexts);
  const docPct = docCov.total ? Math.round((docCov.documented / docCov.total) * 100) : 0;
  // Risk = churn × complexity — files that change often AND are hard to read.
  const complexityByFile = new Map(health.hotspots.map(h => [h.file, h.score]));
  const riskFiles = git
    ? [...git.churn.entries()]
        .filter(([f]) => complexityByFile.has(f))
        .map(([file, churn]) => ({ file, churn, score: complexityByFile.get(file)! }))
        .sort((a, b) => b.churn * b.score - a.churn * a.score)
        .slice(0, 5)
    : [];
  const topChurn = git
    ? [...git.churn.entries()]
        .filter(([f]) => !/lock|\.min\.|dist\/|generated/i.test(f))
        .sort((a, b) => b[1] - a[1]).slice(0, 8)
    : [];

  const t = en
    ? {
        title: 'Deterministic report', genBy: 'generated by static analysis — no LLM, no network',
        summary: 'Executive summary', stack: 'Stack & structure', lang: 'Languages', deps: 'Runtime deps', devDeps: 'Dev deps', scripts: 'Scripts',
        arch: 'Module graph', hubs: 'Hub modules (most imported)', entries: 'Entry points', leaves: 'leaf modules', syms: 'symbols extracted',
        constraints: 'Product constraints', none: 'None declared',
        debt: 'Debt & smells', secu: 'Security signals', secuNone: 'No risky pattern detected in scanned code.',
        tests: 'test/src file ratio', largest: 'Largest files', docs: 'Docs present', infra: 'Infra detected',
        gitTitle: 'Git activity & risk', gitCommits: 'commits', gitAuthors: 'authors', gitLast: 'last commit',
        gitChurn: 'Most churned files', gitRisk: 'Risk hotspots (churn × complexity)', gitSolo: 'single-author files',
        docCov: 'docstring coverage',
        reco: 'Recommendations', sev: 'Severity', action: 'Action',
        labels: {
          todo: 'TODO/FIXME markers', console: 'console.* calls', tsIgnore: '@ts-ignore/-expect-error',
          any: '`any` types', emptyCatch: 'empty catch blocks', debugger: 'debugger statements',
          secret: 'hardcoded secrets (suspected)', eval: 'eval / new Function', exec: 'child_process / execSync',
          innerHTML: 'innerHTML assignments', unsafeRegex: 'dynamic RegExp',
        },
        verdict: (g: string) => ({ A: 'Excellent health — clean structure.', B: 'Good health — minor debt.', C: 'Correct — visible debt to watch.', D: 'Fragile — refactor before growing.', E: 'Critical — structural debt blocking.' }[g] ?? ''),
      }
    : {
        title: 'Rapport déterministe', genBy: 'généré par analyse statique — aucun LLM, aucun réseau',
        summary: 'Résumé exécutif', stack: 'Stack & structure', lang: 'Langages', deps: 'Dépendances runtime', devDeps: 'Dépendances dev', scripts: 'Scripts',
        arch: 'Graphe de modules', hubs: 'Modules hubs (les plus importés)', entries: 'Points d\u2019entrée', leaves: 'modules feuilles', syms: 'symboles extraits',
        constraints: 'Contraintes produit', none: 'Aucune déclarée',
        debt: 'Dette & smells', secu: 'Signaux sécurité', secuNone: 'Aucun pattern risqué détecté dans le code scanné.',
        tests: 'ratio tests/src', largest: 'Plus gros fichiers', docs: 'Docs présentes', infra: 'Infra détectée',
        gitTitle: 'Activité Git & risque', gitCommits: 'commits', gitAuthors: 'auteurs', gitLast: 'dernier commit',
        gitChurn: 'Fichiers les plus modifiés', gitRisk: 'Hotspots de risque (churn × complexité)', gitSolo: 'fichiers mono-auteur',
        docCov: 'couverture docstrings',
        reco: 'Recommandations', sev: 'Sévérité', action: 'Action',
        labels: {
          todo: 'Marqueurs TODO/FIXME', console: 'Appels console.*', tsIgnore: '@ts-ignore/-expect-error',
          any: 'Types `any`', emptyCatch: 'catch vides', debugger: 'Instructions debugger',
          secret: 'Secrets en dur (suspectés)', eval: 'eval / new Function', exec: 'child_process / execSync',
          innerHTML: 'Affectations innerHTML', unsafeRegex: 'RegExp dynamiques',
        },
        verdict: (g: string) => ({ A: 'Excellente santé — structure propre.', B: 'Bonne santé — dette mineure.', C: 'Correct — dette visible à surveiller.', D: 'Fragile — refactorer avant de grossir.', E: 'Critique — dette structurelle bloquante.' }[g] ?? ''),
      };

  const out: string[] = [];
  out.push(`# 📊 ${t.title} — \`${name}\``);
  out.push(`_${t.genBy}_`, '');

  out.push(`## 1. ${t.summary}`);
  out.push(`**${bar(health.score)} ${health.score}/100 (${health.grade})** — ${t.verdict(health.grade)}`);
  out.push('');
  out.push(`- ${health.analyzedFiles} ${en ? 'code files' : 'fichiers de code'} · ${symbols} ${t.syms} · ${health.importEdges} ${en ? 'local imports' : 'imports locaux'} · ${leaves} ${t.leaves}`);
  out.push(`- ${testFiles.length} ${en ? 'test files' : 'fichiers de test'} (${testRatio}% ${t.tests}) · ${countHits(smells)} ${en ? 'smell hits' : 'smells détectés'} · ${countHits(sec)} ${en ? 'security signals' : 'signaux sécurité'}`);
  out.push(`- ${docCov.documented}/${docCov.total} ${en ? 'exports documented' : 'exports documentés'} (${docPct}% ${t.docCov})`);
  if (git) out.push(`- ${git.commits} ${t.gitCommits} · ${git.authors.size} ${en ? 'author(s)' : 'auteur(s)'} · ${t.gitLast} : ${git.lastDate}`);
  out.push('');

  out.push(`## 2. ${t.stack}`);
  if (pkg.name) out.push(`- **${en ? 'Package' : 'Package'}** : \`${pkg.name}${pkg.version ? `@${pkg.version}` : ''}\``);
  if (langs.length) out.push(`- **${t.lang}** : ${langs.map(([l, n]) => `${l} (${n})`).join(', ')}`);
  if (deps.length) out.push(`- **${t.deps}** (${deps.length}) : ${deps.slice(0, 12).map(d => `\`${d}\``).join(', ')}${deps.length > 12 ? ' …' : ''}`);
  if (devDeps.length) out.push(`- **${t.devDeps}** (${devDeps.length}) : ${devDeps.slice(0, 8).map(d => `\`${d}\``).join(', ')}${devDeps.length > 8 ? ' …' : ''}`);
  if (scripts.length) out.push(`- **${t.scripts}** : ${scripts.map(s => `\`${s}\``).join(', ')}`);
  if (docs.length) out.push(`- **${t.docs}** : ${docs.map(d => `\`${d}\``).join(', ')}`);
  if (infra.length) out.push(`- **${t.infra}** : ${infra.map(i => `\`${i}\``).join(', ')}`);
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
  if (largest.length) {
    out.push(`**${t.largest}** : ${largest.map(x => `\`${x.f}\` (${x.lines}l)`).join(', ')}`, '');
  }

  if (git) {
    out.push(`## 4. ${t.gitTitle}`, '');
    const topAuthors = [...git.authors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([a, n]) => `${a} (${n})`).join(', ');
    const soloCount = [...git.fileAuthors.values()].filter(a => a.size === 1).length;
    out.push(`- ${git.commits} ${t.gitCommits} · **${t.gitAuthors}** : ${topAuthors}`);
    out.push(`- ${soloCount} ${t.gitSolo}`, '');
    out.push(`**${t.gitChurn}** :`, '');
    for (const [f, c] of topChurn) {
      const n = git.fileAuthors.get(f)?.size ?? 0;
      out.push(`- \`${f}\` — ${c} ${en ? 'lines changed' : 'lignes modifiées'} · ${n} ${en ? 'author(s)' : 'auteur(s)'}`);
    }
    out.push('');
    if (riskFiles.length) {
      out.push(`**${t.gitRisk}** :`, '');
      for (const r of riskFiles) out.push(`- \`${r.file}\` — churn ${r.churn} × ${en ? 'complexity' : 'complexité'} ${r.score}`);
      out.push('');
    }
  }

  out.push(`## 5. ${t.debt}`);
  const smellKeys = Object.keys(smells);
  if (!smellKeys.length) out.push(en ? '_Nothing detected._' : '_Rien détecté._');
  for (const key of smellKeys) {
    const hits = smells[key];
    out.push(`- **${t.labels[key as keyof typeof t.labels] ?? key}** — ${hits.length}${en ? ' hit' + (hits.length > 1 ? 's' : '') : ''}`);
    for (const h of hits.slice(0, 4)) out.push(`  - \`${h.file}:${h.line}\` — ${h.sample}`);
    if (hits.length > 4) out.push(`  - _…${hits.length - 4} ${en ? 'more' : 'autres'}_`);
  }
  out.push('');

  out.push(`## 6. ${t.secu}`);
  const secKeys = Object.keys(sec);
  if (!secKeys.length) out.push(`_${t.secuNone}_`);
  for (const key of secKeys) {
    const hits = sec[key];
    out.push(`- **${t.labels[key as keyof typeof t.labels] ?? key}** — ${hits.length}`);
    for (const h of hits.slice(0, 5)) out.push(`  - \`${h.file}:${h.line}\` — ${h.sample}`);
    if (hits.length > 5) out.push(`  - _…${hits.length - 5} ${en ? 'more' : 'autres'}_`);
  }
  out.push('');

  out.push(`## 7. ${t.constraints}`);
  out.push(index.constraints.length ? index.constraints.map(c => `- ${c}`).join('\n') : t.none, '');

  out.push(formatHealthReportMd(health, lang).replace(/^## /, '## 8. ').replace(/\n### /g, '\n#### '), '');

  out.push(`## 9. ${t.reco}`, '');
  out.push(`| ${t.sev} | ${t.action} |`, '|---|---|');
  const SEV_ICON: Record<Reco['severity'], string> = { Critique: '🔴', 'Élevée': '🟠', Moyenne: '🟡', Faible: '🔵' };
  for (const r of recommendations(health, hasTests, smells, sec, git, infra, riskFiles, lang)) out.push(`| ${SEV_ICON[r.severity]} ${r.severity} | ${r.text} |`);
  out.push('');
  out.push('---');
  out.push(`_${en ? 'Made with passion by shinzarou-eng' : 'Fait avec passion par shinzarou-eng'} — dsh-codebase-chat · ${en ? 'deterministic mode' : 'mode déterministe'}_`);

  return out.join('\n');
}
