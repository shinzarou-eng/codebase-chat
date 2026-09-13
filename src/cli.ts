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
import { encode as encodeCl100k } from 'gpt-tokenizer/encoding/cl100k_base';

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
  --impact <file>        Blast radius — which files transitively depend on <file>
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
  const { values } = parseArgs({
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
    const files = Object.values(index.files);
    const fileCount = files.length;
    const o200k = files.reduce((sum, f) => sum + f.chunks.reduce((s, c) => s + c.tokens, 0), 0);
    const termCount = Object.keys(index.terms).length;
    const allText = files.flatMap(f => f.chunks.map(c => c.content)).join('\n');
    const cl100k = encodeCl100k(allText).length;
    const fmt = (n: number) => n.toLocaleString('en-US');
    const est = (mult: number) => `~${fmt(Math.round(cl100k * mult))}`;
    console.log(`Project: ${index.projectPath}`);
    console.log(`Files:   ${fileCount}`);
    console.log(`Tokens:  ${fmt(o200k)} (o200k)`);
    console.log(`Terms:   ${fmt(termCount)}`);
    console.log(`Cache:   ${index.projectHash}`);
    console.log('');
    console.log('Token count per model family (code-heavy text):');
    console.log(`  OpenAI GPT-4o/5     o200k         ${fmt(o200k)}  exact`);
    console.log(`  OpenAI GPT-4 era    cl100k        ${fmt(cl100k)}  exact`);
    console.log(`  DeepSeek V4         custom BPE    ${est(1.0)}  est. — close to cl100k on code`);
    console.log(`  Claude Sonnet/Opus  proprietary   ${est(1.2)}  est. — ~15-25% above cl100k on code`);
    console.log(`  Gemini Flash/Pro    SentencePiece ${est(0.95)}  est. — within ±10% of cl100k`);
    console.log(`  Llama 3 / Mistral   BPE           ${est(1.05)}  est. — within ±10% of cl100k`);
    console.log('');
    console.log('Context-window fit if you sent the whole codebase:');
    console.log(`  Gemini 1M / DeepSeek V4 1M   ${cl100k < 1_000_000 ? 'fits' : 'exceeds'}   |   Claude 200k / GPT-4o 128k   ${cl100k < 200_000 ? 'fits' : 'exceeds'}`);
    console.log('  Retrieval keeps each call under --maxTokens (default 60k).');
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

  if (values.impact) {
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
