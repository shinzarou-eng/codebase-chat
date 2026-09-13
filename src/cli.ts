#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { watch } from 'node:fs';
import { sep, basename } from 'node:path';
import { buildContext } from './context.js';
import { getIndex } from './indexer.js';
import { findProjectRoot, getWalkOptions, resolveProjectPath } from './project.js';
import { analyzeProject, formatHealthReport } from './analysis.js';
import { analyzeImpact, formatImpactReport } from './impact.js';
import { buildToolPrompt } from './prompts.js';
import { buildDeterministicReport } from './report.js';
import { getChangedFiles } from './diff.js';
import { loadProjectConfig } from './config.js';
import { disposeTreeSitter } from './treesitter.js';
import { computeStats } from './stats.js';
import { collectAudit } from './report.js';
import { auditFindings } from './findings.js';
import { writeBaseline, BASELINE_REL } from './baseline.js';
import { runCheck, formatCheckMd } from './check.js';
import { runDoctor, formatDoctorMd } from './doctor.js';
import { countTokens } from './tokenizer.js';
import { matchModelPrice, callCost, fmtCost, CALL_INPUT_TOKENS, CALL_OUTPUT_TOKENS } from './pricing.js';

// Minimal Markdown→ANSI renderer so --call/--no-llm answers read like a real
// report in the terminal instead of raw `##`/`**`/backticks. Only used when
// stdout is a TTY — piped output stays plain Markdown.
const ANSI = { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', cyan: '\x1b[36m', yellow: '\x1b[33m', magenta: '\x1b[35m', green: '\x1b[32m' };

function renderAnswerTerminal(md: string): string {
  let inCode = false;
  const inline = (s: string) => s
    .replace(/\*\*([^*]+)\*\*/g, `${ANSI.bold}$1${ANSI.reset}`)
    .replace(/`([^`]+)`/g, `${ANSI.cyan}$1${ANSI.reset}`)
    .replace(/\[source: ([^\]]+)\]/g, `${ANSI.dim}${ANSI.cyan}[source: $1]${ANSI.reset}`);
  return md.split('\n').map((line) => {
    if (/^\s*```/.test(line)) {
      inCode = !inCode;
      return `${ANSI.dim}  ────────────────────────────${ANSI.reset}`;
    }
    if (inCode) return `${ANSI.dim}  ${line}${ANSI.reset}`;
    const h = line.match(/^(#{1,6})\s+(.*)/);
    if (h) {
      const color = h[1].length <= 2 ? `${ANSI.bold}${ANSI.magenta}` : `${ANSI.bold}${ANSI.yellow}`;
      return `\n${color}${h[2]}${ANSI.reset}`;
    }
    const bullet = line.match(/^(\s*)([-*•]|\d+\.)\s+(.*)/);
    if (bullet) return `${bullet[1]}${ANSI.cyan}${bullet[2]}${ANSI.reset} ${inline(bullet[3])}`;
    if (/^\s*>/.test(line)) return `${ANSI.dim}${ANSI.green}│${ANSI.reset}${ANSI.dim} ${inline(line.replace(/^\s*>\s?/, ''))}${ANSI.reset}`;
    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) return `${ANSI.dim}${'─'.repeat(60)}${ANSI.reset}`;
    return inline(line);
  }).join('\n');
}

class ExitSignal {
  constructor(public code: number) {}
}

function exit(code: number): never {
  disposeTreeSitter();
  // Natural exit preferred (avoids a libuv assert while Emscripten handles
  // close); the unref'd timer only forces it if the loop stays alive.
  setTimeout(() => process.exit(code), 2000).unref();
  throw new ExitSignal(code);
}

function printHelp() {
  console.log(`
dsh-codebase-chat CLI

Usage:
  npx dsh-codebase-chat --project <path> --ask "Explain auth flow"
  npx dsh-codebase-chat --project <path> --search "rate limiting"
  npx dsh-codebase-chat --project <path> --file src/auth.ts
  npx dsh-codebase-chat --project <path> --index
  npx dsh-codebase-chat --project <path> --stats
  npx dsh-codebase-chat --project <path> --health
  npx dsh-codebase-chat --project <path> --impact src/store.ts
  npx dsh-codebase-chat --project <path> --health --diff main
  npx dsh-codebase-chat --project <path> --check [--diff main] [--strict]
  npx dsh-codebase-chat --project <path> --baseline
  npx dsh-codebase-chat --project <path> --doctor
  npx dsh-codebase-chat --project <path> --watch
  npx dsh-codebase-chat --project <path> --prompt intelligence
  npx dsh-codebase-chat --project <path> --prompt intelligence --call   # answered via DEEPSEEK_API_KEY
  npx dsh-codebase-chat --project <path> --prompt intelligence --no-llm # deterministic report, zero model

Options:
  -p, --project <path>   Project directory (default: current directory)
  -a, --ask <question>   Ask a question about the codebase
  -s, --search <query>   Search code by semantic terms
  -f, --file <path>      Focus on a specific file
  -i, --index            Force re-index the project
  -t, --stats            Print indexing stats
  -H, --health           Deterministic static analysis (cycles, dead code, dupes, complexity)
  --check                Verify your changes: impact, findings, delta vs baseline
  --baseline             Write .codebase-chat/baseline.json (findings + score snapshot)
  --strict               With --check: exit 1 when the verdict is red
  --json                 With --check/--doctor: print the report as JSON
  --doctor               Diagnose the install: node, index cache, LLM keys, MCP clients
  --impact [file]        Blast radius — which files transitively depend on <file>;
                         bare --impact = every file changed vs HEAD
  -d, --diff <ref>       Scope --ask/--search/--health to files changed vs a git ref
  --prompt <mode>        Print the full LLM prompt (banner + instructions) for a
                         report mode: intelligence, report, audit, tasks, ceo,
                         player, chat, search, explain, refactor, crea.
                         Pipe it to any LLM (e.g. ... --prompt intelligence | dsh).
                         Query modes read --ask/--search/--file; --focus and
                         --style (ouf|punchy|dense|pedagogique|minimal) apply.
  --call                 With --prompt: send it to the API (needs DEEPSEEK_API_KEY
                         or OPENAI_API_KEY; DEEPSEEK_BASE_URL / CODEBASE_MODEL
                         customize endpoint/model) instead of printing it.
  --no-llm               With --prompt: deterministic full report — pure static
  --ui                   Local web dashboard of the deterministic report (no LLM)
                         analysis, no model, no key, no network.
  -w, --watch            Keep the index hot — rebuild incrementally on file changes
  -e, --embed            Enable local semantic embeddings (slower, more relevant)
  --lang <en|fr>         Language for headings (default: .codebase-chat.json lang, else fr)
  -h, --help             Show this help

Config:
  .codebase-chat.json    Per-project settings: lang, maxTokens, ignoreDirs,
                         ignoreFiles, ignoreGlobs, protectedPaths

Environment:
  CODEBASE_CACHE_DIR     Directory for the index cache
`);
}

async function main() {
  // Bare `--impact` (no value) → impact of uncommitted changes vs HEAD.
  const argv = process.argv.slice(2).map(a => (a === '--impact' ? '--impact=' : a));
  const { values } = parseArgs({
    args: argv,
    options: {
      project: { type: 'string', short: 'p', default: '.' },
      ask: { type: 'string', short: 'a' },
      search: { type: 'string', short: 's' },
      file: { type: 'string', short: 'f' },
      index: { type: 'boolean', short: 'i', default: false },
      stats: { type: 'boolean', short: 't', default: false },
      health: { type: 'boolean', short: 'H', default: false },
      impact: { type: 'string' },
      diff: { type: 'string', short: 'd' },
      prompt: { type: 'string' },
      focus: { type: 'string' },
      style: { type: 'string' },
      call: { type: 'boolean', default: false },
      'no-llm': { type: 'boolean', default: false },
      ui: { type: 'boolean', default: false },
      check: { type: 'boolean', default: false },
      baseline: { type: 'boolean', default: false },
      doctor: { type: 'boolean', default: false },
      strict: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      watch: { type: 'boolean', short: 'w', default: false },
      embed: { type: 'boolean', short: 'e', default: false },
      lang: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    printHelp();
    exit(0);
  }

  const project = resolveProjectPath(values.project);
  const cfg = await loadProjectConfig(project);
  const lang = values.lang === 'en' || values.lang === 'fr' ? values.lang : (cfg.lang ?? 'fr');

  if (values.index) {
    await getIndex(project, m => console.log(m), true);
    exit(0);
  }

  if (values.stats) {
    const index = await getIndex(project, m => console.log(m));
    const s = computeStats(index);
    const fmt = (n: number) => n.toLocaleString('en-US');
    console.log(`Project: ${s.projectPath}`);
    console.log(`Files:   ${s.files}  (${s.chunks} chunks, ${fmt(s.bytes)} bytes)`);
    console.log(`Tokens:  ${fmt(s.o200k)} (o200k) / ${fmt(s.cl100k)} (cl100k)`);
    console.log(`Terms:   ${fmt(s.terms)}`);
    console.log(`Cache:   ${s.projectHash}`);
    console.log('');
    console.log('Token count per model family (code-heavy text):');
    for (const m of s.models)
      console.log(`  ${m.family.padEnd(21)} ${m.tokenizer.padEnd(14)} ${(m.exact ? '' : '~') + fmt(m.tokens)}  ${m.exact ? 'exact' : 'est. — ' + m.note}`);
    console.log('');
    console.log('Context-window fit if you sent the whole codebase:');
    for (const w of s.windows)
      console.log(`  ${w.model.padEnd(29)} ${fmt(w.window).padStart(9)}   ${w.fits ? `fits (${w.usedPct}% used)` : `exceeds (${w.usedPct}%)`}`);
    console.log('  Retrieval keeps each call under --maxTokens (default 60k).');
    console.log('');
    console.log(`Cost per --call (≈${fmt(CALL_INPUT_TOKENS)} tok in + ≤${fmt(CALL_OUTPUT_TOKENS)} out — Sept 2026 list prices):`);
    for (const c of s.costs) {
      const price = c.free ? 'local' : `$${c.priceIn}/$${c.priceOut}`;
      const est = c.free ? 'free' : `~${fmtCost(c.estCost)}`;
      console.log(`  ${c.label.padEnd(19)} ${price.padEnd(13)} ${est.padEnd(9)}${c.context ?? ''}`);
    }
    console.log('  Estimates only — caching, batch and intro tiers change the real bill.');
    exit(0);
  }

  if (values.watch) {
    const abs = await findProjectRoot(project);
    const walk = await getWalkOptions(abs);
    await getIndex(abs, m => console.log(m), true);
    console.log(lang === 'en'
      ? 'Watch mode — the index stays hot while you code. (Ctrl+C to quit)'
      : 'Mode watch — l\u2019index reste à jour pendant que tu codes. (Ctrl+C pour quitter)');
    let timer: NodeJS.Timeout | undefined;
    let pending = new Set<string>();
    const watcher = watch(abs, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const rel = filename.split(sep).join('/');
      if (rel.split('/').some(p => walk.skipDirs.has(p))) return;
      pending.add(rel);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const changed = [...pending];
        pending = new Set();
        const t0 = Date.now();
        // Freshness check rebuilds only the files whose signature changed.
        void getIndex(abs, () => {}).then(() => {
          const dt = ((Date.now() - t0) / 1000).toFixed(1);
          const list = changed.slice(0, 4).join(', ') + (changed.length > 4 ? ` +${changed.length - 4}` : '');
          console.log(lang === 'en'
            ? `Changed: ${list} → index refreshed (${dt}s)`
            : `Modifié : ${list} → index à jour (${dt}s)`);
        });
      }, 500);
    });
    process.on('SIGINT', () => { watcher.close(); exit(0); });
    await new Promise(() => {});
  }

  if (values.baseline) {
    const abs = await findProjectRoot(project);
    const data = await collectAudit(abs);
    const findings = auditFindings(data, lang);
    const b = await writeBaseline(abs, data, findings);
    console.log(lang === 'en'
      ? `Baseline written: ${BASELINE_REL} — ${b.findings.length} findings, score ${b.score}/100${b.head ? ` (HEAD ${b.head})` : ''}`
      : `Baseline écrite : ${BASELINE_REL} — ${b.findings.length} findings, score ${b.score}/100${b.head ? ` (HEAD ${b.head})` : ''}`);
    exit(0);
  }

  if (values.doctor) {
    const report = await runDoctor(project, lang);
    if (values.json) console.log(JSON.stringify(report, null, 2));
    else console.log(process.stdout.isTTY ? renderAnswerTerminal(formatDoctorMd(report, lang)) : formatDoctorMd(report, lang));
    exit(report.ok ? 0 : 1);
  }

  if (values.check) {
    const report = await runCheck(project, { base: values.diff ?? 'HEAD', lang });
    if (values.json) console.log(JSON.stringify(report, null, 2));
    else console.log(process.stdout.isTTY ? renderAnswerTerminal(formatCheckMd(report, lang)) : formatCheckMd(report, lang));
    exit(values.strict && report.verdict === 'red' ? 1 : 0);
  }

  if (values.health) {
    let scope;
    if (values.diff) {
      const s = await getChangedFiles(await findProjectRoot(project), values.diff);
      if (s.ok) {
        scope = { files: s.files };
        console.log(lang === 'en'
          ? `Diff scope: ${s.files.size} file(s) changed vs ${values.diff}`
          : `Périmètre diff : ${s.files.size} fichier(s) modifié(s) vs ${values.diff}`);
      } else {
        console.error(lang === 'en'
          ? `warning: diff vs "${values.diff}" unavailable (${s.error}) — full project`
          : `attention : diff vs "${values.diff}" indisponible (${s.error}) — projet complet`);
      }
    }
    const report = await analyzeProject(project, scope);
    console.log(formatHealthReport(report, lang));
    exit(0);
  }

  if (values.impact !== undefined) {
    if (!values.impact) {
      // Bare --impact: blast radius of files changed vs HEAD.
      const abs = await findProjectRoot(project);
      const s = await getChangedFiles(abs, 'HEAD');
      if (!s.ok || !s.files.size) {
        console.log(lang === 'en'
          ? 'No changed files (or not a git repo) — pass --impact <file>.'
          : 'Aucun fichier modifié (ou pas un repo git) — passe --impact <fichier>.');
        exit(s.ok ? 0 : 1);
      }
      console.log(lang === 'en'
        ? `Changed files vs HEAD: ${s.files.size}`
        : `Fichiers modifiés vs HEAD : ${s.files.size}`);
      let any = false;
      for (const f of [...s.files].sort()) {
        const r = await analyzeImpact(project, f);
        if (!r.ok) continue;
        any = true;
        console.log('\n' + formatImpactReport(r.report, lang));
      }
      if (!any) console.log(lang === 'en'
        ? 'None of the changed files are indexed code files.'
        : 'Aucun des fichiers modifiés n\u2019est un fichier de code indexé.');
      exit(0);
    }
    const r = await analyzeImpact(project, values.impact);
    if (!r.ok) {
      console.log(lang === 'en'
        ? r.candidates.length
          ? `Ambiguous target "${values.impact}" — candidates:\n  ${r.candidates.join('\n  ')}`
          : `No code file matches "${values.impact}".`
        : r.candidates.length
          ? `Cible ambiguë "${values.impact}" — candidats :\n  ${r.candidates.join('\n  ')}`
          : `Aucun fichier de code ne correspond à "${values.impact}".`);
      exit(1);
    }
    console.log(formatImpactReport(r.report, lang));
    exit(0);
  }

  if (values.ui) {
    const { startDashboard } = await import('./dashboard.js');
    const { url, server } = await startDashboard(resolveProjectPath(values.project), lang);
    console.log(lang === 'en' ? `Dashboard: ${url} (Ctrl+C to quit)` : `Dashboard : ${url} (Ctrl+C pour quitter)`);
    const { execFile } = await import('node:child_process');
    const opener = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
    execFile(opener, args, () => {});
    process.on('SIGINT', () => { server.close(); exit(0); });
    await new Promise(() => {});
  }

  if (values.prompt) {
    const mode = values.prompt.toLowerCase();
    const tool = `codebase_${mode}`;
    const needsQuery = new Set(['chat', 'search', 'explain', 'refactor', 'crea']);
    const query = values.ask ?? values.search ?? values.focus ?? '';
    if (needsQuery.has(mode) && !query && !values.file) {
      console.error(lang === 'en'
        ? `--prompt ${mode} needs a query: add --ask/--search/--file (or --focus)`
        : `--prompt ${mode} nécessite une requête : ajoute --ask/--search/--file (ou --focus)`);
      exit(1);
    }
    // --no-llm: the deterministic report needs no context assembly at all.
    if (values['no-llm']) {
      const report = await buildDeterministicReport(values.project, lang);
      console.log(process.stdout.isTTY ? renderAnswerTerminal(report) : report);
      exit(0);
    }
    const result = await buildContext({
      project: values.project,
      query,
      searchQuery: values.search,
      filePath: values.file,
      lang,
      embed: values.embed,
      diff: values.diff,
    });
    if (result.noMatch) console.error(lang === 'en'
      ? `No code chunk matches "${values.search}" — context holds the file tree only.`
      : `Aucun fragment ne correspond à « ${values.search} » — le contexte ne contient que l'arborescence.`);
    // Same parity as the MCP server: report modes get the deterministic
    // static analysis appended to the retrieved context.
    let staticSection = '';
    if (new Set(['intelligence', 'report', 'audit', 'tasks', 'ceo']).has(mode)) {
      try {
        const report = await analyzeProject(result.absProject);
        staticSection = `\n\n== ${lang === 'en' ? 'STATIC ANALYSIS (deterministic)' : 'ANALYSE STATIQUE (déterministe)'} ==\n${formatHealthReport(report, lang)}`;
      } catch {
        // best-effort
      }
    }
    const projectName = basename(result.absProject);
    let prompt: string;
    try {
      prompt = buildToolPrompt(tool, {
        context: `${result.context}${staticSection}`,
        projectName,
        lang,
        style: values.style,
        query,
        focus: values.focus ?? query,
        filePath: values.file ?? '',
        description: query,
      });
    } catch {
      console.error(lang === 'en'
        ? `unknown prompt mode "${mode}" — expected: intelligence, report, audit, tasks, ceo, player, chat, search, explain, refactor, crea`
        : `mode de prompt inconnu "${mode}" — attendu : intelligence, report, audit, tasks, ceo, player, chat, search, explain, refactor, crea`);
      exit(1);
    }

    if (values.call) {
      const apiKey = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || '';
      if (!apiKey) {
        console.error(lang === 'en'
          ? '--call needs DEEPSEEK_API_KEY or OPENAI_API_KEY in the environment'
          : '--call nécessite DEEPSEEK_API_KEY ou OPENAI_API_KEY dans l\u2019environnement');
        exit(1);
      }
      const baseUrl = process.env.DEEPSEEK_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.deepseek.com/v1';
      const model = process.env.CODEBASE_MODEL || 'deepseek-chat';
      // Cost preview on stderr — say what the call will burn before sending it.
      const promptTok = countTokens(prompt);
      const mp = matchModelPrice(model);
      const inTokAdj = Math.round(promptTok * (mp?.tokMult ?? 1));
      console.error(mp?.free
        ? `→ ${model} · ~${promptTok.toLocaleString('en-US')} tok in · local, free`
        : mp
          ? `→ ${model} (${mp.label}) · ~${inTokAdj.toLocaleString('en-US')} tok in + ≤${CALL_OUTPUT_TOKENS.toLocaleString('en-US')} out · est. ${fmtCost(callCost(mp, inTokAdj, CALL_OUTPUT_TOKENS))}/call`
          : `→ ${model} · ~${promptTok.toLocaleString('en-US')} tok in · unknown model — cost not estimated`);
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        signal: AbortSignal.timeout(120_000),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: lang === 'en' ? 'You are a senior codebase analyst. Be precise and cite files.' : 'Tu es un analyste codebase senior. Sois précis et cite les fichiers.' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.3,
          max_tokens: 8192,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.error(`API error ${res.status}: ${text}`);
        exit(1);
      }
      const data = await res.json() as { choices?: { message?: { content?: string } }[] };
      const answer = data.choices?.[0]?.message?.content || '';
      console.log(process.stdout.isTTY ? renderAnswerTerminal(answer) : answer);
      exit(0);
    }

    console.log(prompt);
    exit(0);
  }

  if (values.ask || values.search || values.file) {
    const result = await buildContext({
      project: values.project,
      query: values.ask ?? values.search ?? '',
      searchQuery: values.search,
      filePath: values.file,
      lang,
      embed: values.embed,
      diff: values.diff,
    });
    if (result.noMatch) console.error(lang === 'en'
      ? `No code chunk matches "${values.search}" — context holds the file tree only.`
      : `Aucun fragment ne correspond à « ${values.search} » — le contexte ne contient que l'arborescence.`);
    console.log(result.context);
    console.log(`\n--- Stats ---`);
    console.log(`Project: ${result.absProject}`);
    console.log(`Chunks:  ${result.chunks.length}`);
    console.log(`Tokens:  ${result.tokenCount}`);
    exit(0);
  }

  printHelp();
  exit(0);
}

main().catch(err => {
  disposeTreeSitter();
  if (err instanceof ExitSignal) {
    process.exitCode = err.code;
    return;
  }
  console.error(err?.message ?? err);
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 2000).unref();
});
