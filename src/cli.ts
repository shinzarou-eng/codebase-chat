#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { watch } from 'node:fs';
import { sep } from 'node:path';
import { buildContext } from './context.js';
import { getIndex } from './indexer.js';
import { findProjectRoot, getWalkOptions, resolveProjectPath } from './project.js';
import { analyzeProject, formatHealthReport } from './analysis.js';
import { analyzeImpact, formatImpactReport } from './impact.js';
import { getChangedFiles } from './diff.js';
import { loadProjectConfig } from './config.js';
import { disposeTreeSitter } from './treesitter.js';

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
    const fileCount = Object.keys(index.files).length;
    const totalTokens = Object.values(index.files).reduce((sum, f) => sum + f.chunks.reduce((s, c) => s + c.tokens, 0), 0);
    const termCount = Object.keys(index.terms).length;
    console.log(`Project: ${index.projectPath}`);
    console.log(`Files:   ${fileCount}`);
    console.log(`Tokens:  ${totalTokens}`);
    console.log(`Terms:   ${termCount}`);
    console.log(`Cache:   ${index.projectHash}`);
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
  exit(1);
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
