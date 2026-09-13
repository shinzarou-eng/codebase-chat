# Changelog

## 0.29.0 / mcp 0.10.0 — local dashboard, verified fixes & 18 tools

**New**

- `--ui` — launches a Fluent web dashboard on `127.0.0.1`: run deep audit / health / stats / impact, ask a question and copy the built prompt, switch projects, filter by severity or text, collapse sections, export `.md`/`.html`, "My changes" view with one-click baseline — all clicks, no terminal, fully local, FR/EN.
- `codebase_fix` / `--fix` — verified mechanical repairs where the fix is unambiguous: undocumented env vars appended to `.env.example`, dead deps removed, unused exports un-exported, console/debugger lines deleted. Each fix re-checks itself; `dry` previews without writing.
- `codebase_deep_audit` — deterministic MCP tool running the full 9-section, ~30-metric audit; `ui: true` also returns a `ui://` HTML dashboard resource for MCP-UI clients.
- Rich `--stats` — exact `o200k`/`cl100k` token counts, per-model-family estimates (DeepSeek, Claude, Gemini, Llama), context-window fit, estimated cost per `--call`, top files, extension distribution. Shared `src/stats.ts` engine powers CLI + dashboard.
- Ignores, check history, symbol-level impact, suggested tests, SARIF export for PR annotations, pre-commit hook + self-audit gate in CI (`--check --strict`).
- `setup` also installs the `/codebase` skill for compatible agents; intent-first `/codebase` menu and `/codebase help` reference.

**Correctness & DSH parity**

**Fixes**

- `--check` / `codebase_check` fail closed: an invalid git ref (or non-git project) now yields a **red** verdict with `scopeError` instead of a silent green with zero files.
- `maxTokens` is actually enforced: the file tree and product-constraints blocks are budgeted too (was: head could exceed the whole budget). New `--maxTokens <n>` CLI flag.
- Test-file detection no longer treats `src/latest.ts`, `contest.ts`, `protest.ts` as tests — shared `isTestPath`/`isSkippablePath` match dir segments and filename conventions only.
- `codebase_apply` (DSH) now supports **line insertions and deletions** — `computePatch` emits insert/delete/replace ops instead of silently dropping them.
- MCP `prompts/get ignore` no longer returns an empty text block; `check` prompt exposes the `base` arg; `health` prompt honours `diff`.
- Baseline diff detects **severity escalations** (a finding that went from Faible → Critique is flagged, not counted as unchanged).

**DSH plugin parity**

- New deterministic tools: `codebase_check`, `codebase_doctor`, `codebase_deep_audit`, `codebase_ignore`.
- `collectCodebaseContext` delegates to the shared `buildContext` engine (symbol-chunk retrieval + real token budget) when `dist/` is built — same context quality as CLI/MCP; the byte-walker stays as the unbuilt-checkout fallback.

**Performance**

- `collectAudit` and `analyzeProject` are memoized per process on a stat-only file signature (10s TTL) — repeat MCP/dashboard/plugin calls go from ~400ms to ~7ms.
- `collectAudit` no longer walks+reads the project twice (analyzeProject re-ran the import-graph collection internally).
- `collectImportGraph` reads files in parallel; `getIndex` freshness stats run in parallel.
- `buildIndex` reuses token counts and embeddings for chunks whose content survived a file edit (was: whole file re-tokenized).

## 0.28.0 / mcp 0.9.0 — `--no-llm` report, ultra edition

**New**

- `--no-llm` becomes a full static audit (~30 analyses, 9 sections):
  - **Git activity & risk** — per-file churn, authors, bus factor (single-author files), churn × complexity hotspots, commit timeline, commit size stats, commit message quality, stale core (untouched hubs)
  - **Dependencies** — imported-but-undeclared packages (install breakage), declared-but-never-imported deps, lockfile drift, broken `bin`/`main`/`exports` entries
  - **Code quality** — per-function cyclomatic complexity (branch counting on tree-sitter chunks), longest functions, `async` without `await`, sync I/O calls, deep relative imports, deep nesting, duplicate file names, comment density, docstring coverage of exports
  - **Security** — hardcoded secrets, dangerous sinks, sensitive files (`*.env`, `*.pem`, keys) including git-tracked detection
  - **Hygiene** — env vars used vs `.env.example`, tsconfig strict, `.gitignore`, package.json completeness, README audit (install/usage/code blocks/badges), infra detection (CI, Docker, lockfiles, test runners), typed-file ratio
- Every finding still cited `file:line`, severity-ranked recommendations, FR/EN, zero LLM, zero network.

## 0.27.0 / mcp 0.9.0 — `--no-llm` deep scan + local LLM removed

**New**

- `--no-llm` goes deep: debt & smells scan (TODO/FIXME, console.*, `@ts-ignore`, `any`, empty catch, `debugger`), security signals (hardcoded secrets, eval/Function, child_process, innerHTML, dynamic RegExp), test/src ratio, largest files, docs presence — every finding cited `file:line`, all deterministic.

**Removed**

- The embedded 1.5B local model (`--local`, `localLlm`, `CODEBASE_LOCAL_LLM`, `node-llama-cpp`) is gone — too fragile for the value (VRAM/CUDA failures, ~1 GB download, quality far below hosted models). Offline answers now go through `--no-llm` (deterministic, zero model) or by piping `--prompt` output to a local model you control (Ollama & co).
- The setup wizard no longer offers a "local model" mode — it asks prompt-only vs API key.

## 0.26.0 — Deterministic `--no-llm` report

**New**

- `--prompt <mode> --no-llm` — a complete structured report built purely from static analysis: executive summary with health score, stack & dependency inventory, module graph (hubs, entry points, leaves), product constraints, the full deterministic health audit, and severity-ranked recommendations. Zero LLM, zero key, zero network — instant and reproducible. Renders formatted in the terminal, plain Markdown when piped.

## 0.25.7 / mcp 0.8.8 — Robust CPU fallback

**Fixed**

- The GPU→CPU fallback only covered model loading, but CUDA OOM also strikes at context creation (`createContext` allocates GPU buffers). The whole local-inference pipeline now retries on CPU — model, context, session — so `--local`/`localLlm` survives VRAM exhaustion wherever it hits.

## 0.25.6 / mcp 0.8.7 — CPU fallback for the local LLM

**Fixed**

- `CUDA error: out of memory` — the embedded model crashed on GPUs without enough VRAM. Loading now falls back to CPU automatically (with a stderr notice), and `CODEBASE_LOCAL_GPU=off` skips GPU entirely.

## 0.25.5 — Readable terminal reports

**Improved**

- `--call` / `--local` answers now render as formatted output in the terminal — colored headers, bold, bullets, dimmed code blocks and highlighted `[source: file:line]` citations — instead of raw Markdown. Piped output stays plain Markdown.

## 0.25.4 / mcp 0.8.6 — Local answers no longer loop

**Fixed**

- The embedded model could degenerate into repetition loops at temperature 0.2, echoing the same paragraph until the token cap. Generation now applies a repetition penalty (last 128 tokens, ×1.2) so answers move forward.

## 0.25.3 / mcp 0.8.5 — Fuller local answers

**Fixed**

- Local-mode answers could collapse to a single line: "be concise" plus a 1.5B model produced near-empty output. The compact instruction now asks for short bulleted sections with `[source: file:line]` citations, and the generation cap rises to 1536 tokens.

## 0.25.2 / mcp 0.8.4 — Local answers actually grounded

**Fixed**

- `--local` / `localLlm: true` sent the full structured brief (11 mandatory sections, ~2k tokens of instructions) plus up to 60k tokens of context to a 1.5B model with an 8k window — the context overflowed and the model ignored the code, answering generically or echoing the file tree. Local mode now caps context at ~3500 tokens and uses a compact instruction, so answers stay grounded in the codebase.

## 0.25.1 / mcp 0.8.3 — CLI answers, not just prompts

**New**

- `--call` — `--prompt <mode> --call` sends the assembled prompt straight to DeepSeek/OpenAI (`DEEPSEEK_API_KEY` / `OPENAI_API_KEY`, `DEEPSEEK_BASE_URL`, `CODEBASE_MODEL`) and prints the report. No IDE needed.
- `--local` — `--prompt <mode> --local` answers with the embedded local model, fully offline.

**Improved**

- The embedded local LLM moved into the core package — shared by the MCP server and the CLI (was MCP-only).

## 0.25.0 / mcp 0.8.2 — One report style everywhere

**New**

- Shared prompt builders — the ASCII-banner briefs the DeepSeek Harness plugin produces (persona, mandatory sections, `[source: file:line]` citations, confidence/severity badges) are now the exact prompts MCP tools and the CLI emit. One source of truth in `src/prompts.ts`, exported for reuse.
- `--prompt <mode>` CLI flag — prints the full assembled prompt for `intelligence`, `report`, `audit`, `tasks`, `ceo`, `player`, `chat`, `search`, `explain`, `refactor` or `crea`. Pipe it to any LLM: `--prompt intelligence | dsh`.
- `style` argument on `codebase_intelligence` / `codebase_report` / `codebase_tasks` now actually applies (`ouf`, `punchy`, `dense`, `pedagogique`, `minimal`).

**Improved**

- MCP prompts upgraded from one-line instructions to the full structured briefs — reports via Cursor/Claude/Windsurf now match the DeepSeek Harness output.

## 0.24.0 / mcp 0.8.1 — Faster, sharper analysis

**New**

- `codebase_impact` — 13th tool: deterministic blast-radius analysis. Give it a file, get every file that transitively depends on it (by depth), its exported symbols, cycle/entry-point flags and a LOW/MEDIUM/HIGH risk score. Also available as `--impact <file>` on the CLI and `/codebase-impact` in DeepSeek Harness.
- Embedded local LLM — `localLlm: true` on any tool (or `CODEBASE_LOCAL_LLM=1`) answers with a small on-device model (node-llama-cpp + Qwen2.5-1.5B-Instruct GGUF, ~1 GB downloaded once). Fully offline, no API key, no host model. Custom `hf:owner/repo:QUANT` URIs and local `.gguf` paths supported.
- Setup wizard now asks the answer mode (prompt-only host model / API key / offline local model) and covers 11 clients: Claude Desktop, Claude Code, Cursor, Windsurf, VS Code (+ workspace), Zed, Gemini CLI, Kiro, Cline and Roo Code — plus a manual snippet for everything else.

**Improved**

- `codebase_health` is ~13× faster on large repos: cycle detection now uses Tarjan SCC (linear) instead of path enumeration, and unused-export detection is single-pass instead of a regex per export per file. Health on a 300-file codebase: ~1s instead of ~12s.
- Cycle reports are more readable: overlapping paths are grouped into strongly connected components ("28 files: a.ts, b.ts, …").
- `--diff` scope is now correct across the boundary: the import graph is computed on the whole project and only findings touching changed files are reported — a new import creating a cycle through unchanged files is now caught.
- Retrieval ranks rare terms higher (IDF weighting in the lexical scorer).
- Agent tooling dirs (`.agents`, `.claude`, `.devin`, `.windsurf`, `.playwright-mcp`) are skipped during indexing/analysis — less noise on agent-driven projects.
- Product constraints are also read from `AGENTS.md`, `CLAUDE.md`, `.windsurfrules` and `.cursorrules` — not just README/CONTRIBUTING.
- MCP direct-LLM calls now have a 120s timeout instead of hanging forever.

**Fixed**

- Removed personal path aliases/protected paths hardcoded in the shipped code.
- Plugin version string now matches the package (was stuck at 0.19.0).

**Chore**

- Added a GitHub Actions CI workflow (typecheck + tests + build) and declared `engines: node >= 20`.

## mcp 0.8.0 — Diff-scoped tools

**New**

- New `diff` argument on every tool: pass a git ref (branch, tag or SHA) and the context/analysis is scoped to files changed vs that ref — committed, staged, unstaged and untracked files included. `codebase_health` reports the scope as a note on top of the markdown report.
- Server version string now tracks the package version.

## 0.23.0 — Diff-aware retrieval & watch mode

**New**

- `--diff <ref>` on the CLI and `diff` on `buildContext`/MCP tools — retrieval and static analysis are scoped to files changed vs a git ref (`git diff --name-only <ref>` + untracked files). Perfect for "review what changed since main".
- `--watch` — filesystem watcher keeps the index hot while you code; changed files are re-indexed incrementally (~mtime/size reuse) with debounce.
- New public API: `getChangedFiles(projectPath, base)` → `{ files, ok, error }`.
- `analyzeProject(projectPath, { files })` accepts an explicit file scope.

## mcp 0.7.0 — Richer analysis prompts

**New**

- Analysis tools (`codebase_intelligence`, `codebase_audit`, `codebase_report`, `codebase_tasks`, `codebase_ceo`) now inject the deterministic static-analysis report (cycles, dead code, duplication, hotspots, health score) into the assembled context — the host model grounds its answer on real findings, not just retrieved chunks.
- New `maxTokens` argument on every tool (default 60000, up to 200000) to control the context budget.

## mcp 0.6.2 — Markdown health report

**Improved**

- `codebase_health` now returns a markdown report: grade icon, ASCII score bar, findings in tables (file/symbol/size/score columns), per-section counts and overflow markers. The raw JSON is folded into a `<details>` block instead of being dumped inline.
- Prompt-only responses open with a markdown blockquote header instead of a plain bracketed notice.
- New public API on the main package: `formatHealthReportMd(report, lang)` — plain `formatHealthReport` still used by the CLI.

## mcp 0.6.1 — Fix published dependency

**Bug fixes**

- Published `package.json` declared `dsh-codebase-chat` as `workspace:^` — npm publish does not rewrite the workspace protocol, so `npx dsh-codebase-chat-mcp` failed to resolve the dependency. Now pinned to `^0.21.0`.
- Setup wizard reads piped stdin correctly (queued lines instead of racing on `close`).

## mcp 0.6.0 — `setup` wizard

**New**

- `npx dsh-codebase-chat-mcp setup` — interactive wizard that detects installed MCP clients (Claude Desktop, Claude Code, Cursor, Windsurf, VS Code) and writes the `dsh-codebase-chat` server entry for you. Merges into existing `mcpServers`/`servers`, backs up each config file (`.bak`), optional API key, defaults to prompt-only mode. Zero added dependencies.

## 0.21.0 — Tree-sitter multi-language extraction

**New**

- Real AST extraction for **Python, Go, Rust, Java, C# and PHP** via `web-tree-sitter` + prebuilt WASM grammars (`tree-sitter-wasms`) — functions, classes, methods, types and imports get named, cited chunks instead of heuristic splits.
- Grammars load lazily per extension during indexing; `extractChunks` stays synchronous and falls back to regex for unsupported languages or parse failures.
- New public API: `initTreeSitter`, `ensureTreeSitterForExt`, `treeSitterReady`, `disposeTreeSitter`.

**Bug fixes**

- `mergeGaps` never emitted gap chunks — uncovered lines (comments, constants, imports in unsupported grammars) were silently dropped from the index. Fixed and shared between the Babel and tree-sitter paths.
- `codebase_health` — test/spec files, tool configs and e2e scripts were reported as unused files; they are now treated as entry points by convention.
- `codebase_health` — the score penalized every complexity hotspot (uncapped, could reach 0/100 on any real codebase) while the report only showed 15. Hotspot penalty is now capped and the report shows the true count.
- CLI now exits naturally after WASM use (no more libuv `UV_HANDLE_CLOSING` assertion on Windows).

## 0.20.0 — Project configuration file

**New**

- `.codebase-chat.json` at the project root: `lang`, `maxTokens`, `ignoreDirs`, `ignoreFiles`, `ignoreGlobs`, `protectedPaths` — every key optional, merged with built-in defaults.
- Ignore rules apply consistently to indexing, `codebase_health` analysis and the context file tree (`**`, `*`, `?` glob support).
- `protectedPaths` augments `DSH_PROTECTED_PATHS` and the built-in list in the apply pipeline.
- Explicit CLI flags and tool arguments override config values; missing or malformed files fall back to defaults.
- New public API: `loadProjectConfig`, `matchesAnyGlob`, `globToRegExp`, `ProjectConfig`.

## 0.19.0 — Deterministic static analysis

**New**

- `codebase_health` — a fully deterministic static analyzer (no LLM, no API key): circular dependencies, unused files and exports, duplicated code blocks, complexity hotspots, and a 0–100 health score with grade. Exposed as an MCP tool, the `/codebase-health` slash command and the `--health` CLI flag, bilingual FR/EN.
- MCP `codebase_health` returns the formatted report plus the raw JSON findings — usable directly in CI or by the host model.

## 0.18.0 — Reliability & performance pass

**Bug fixes**

- `codebase_apply_tasks` actually works: the generated TASKS.md format (`~~~ts` fences, `Fichier: file:line`) is now parsed back correctly, in French and English, with ` ``` ` fences also accepted.
- Fixed missing-file handling in backup/apply (`undefined` vs `null` check) — clean errors instead of crashes.
- `/codebase-apply` now understands `--content "<code>"` (previously the flag was written literally into the file).
- The `dako` project alias only matches the exact word — paths starting with `dako…` are no longer hijacked. Extra aliases via `DSH_PROJECT_ALIASES`, extra protected paths via `DSH_PROTECTED_PATHS`.
- Project preview no longer shows `undefined` fields; languages are now detected per extension.
- `codebase_explain`/`--file` falls back to a symbol search when the target is not a file.
- `codebase_apply` writes a `.dsh-backups/` copy before overwriting a file.
- Fixed tokenizer edge case for tiny token budgets.
- TS `interface`/`type` declarations now extract with the right name and `TYPE` kind (Babel parses them as `TSInterfaceDeclaration`, not Flow's `InterfaceDeclaration`).
- `--index` actually forces a re-index now; chunk headers no longer print `(UNKNOWN)`.

**Improvements**

- All DSH tools and slash commands accept `lang` (`fr`/`en`); tools also accept `style` where relevant.
- One shared filesystem walk with a short-lived cache feeds every collector (metrics, module graph, debt scan, tests, search) — noticeably faster on large repos.
- `searchFiles` skips files over 512 KB.
- Tool timeout raised to 180 s; progress store is bounded.
- Faster index freshness check (mtime+size, no full reads) and incremental reindexing that reuses unchanged chunks and their embeddings.
- Retrieval: file-level term scores only apply to chunks that actually contain the term; chunk selection skips ranges already covered by a higher-ranked chunk.
- MCP server: new `promptOnly` mode returns the assembled context+prompt so the host model (Cursor, Claude, Windsurf…) answers directly — no extra API key required. `promptOnly` defaults to on when no key is configured.

## 0.16.4 — License badge link on npm

- License badge now points to an absolute GitHub URL.

## 0.16.3 — README links on npm

- README contributing and license links now use absolute GitHub URLs.

## 0.16.2 — License link fix

- README license link now uses an absolute GitHub URL for npm rendering.

## 0.16.1 — Ultra-pro presentation

- New logo and social preview assets (`docs/assets/logo.svg`, `social-preview.svg`, `social-preview.png`).
- Refreshed README with hero logo, npm badges, FAQ, and support links.
- Refreshed GitHub Pages site with FAQ, badges, and logo.
- Added `SECURITY.md`, `CODE_OF_CONDUCT.md`, and `SUPPORT.md`.
- Improved MCP package README with badges and usage examples.

## 0.16.0 — npm publication and GitHub Pages

- Published `dsh-codebase-chat@0.16.0` to npm.
- Published `dsh-codebase-chat-mcp@0.2.2` to npm.
- Fixed MCP `bin` path for npm 11.
- Professional README with badges, feature table, install instructions, MCP config, and command reference.
- New GitHub Pages landing site (`docs/index.html`) with Tailwind CSS.
- Added `CONTRIBUTING.md`, issue templates, and PR template.
- Added MIT `LICENSE` file.
- Added `package.json` `homepage`, `repository`, and `bugs` metadata.
- Expanded npm keywords for better discoverability.

## 0.16.0 — Prompts complets EN/FR

- Tous les `build*Prompt` et `collect*Context` possèdent maintenant une version anglaise complète.
- `styleInstruction` est bilingue.
- `collectIntelligenceContext`, `collectNonConformities`, `collectAssessmentContext`, `collectCeoContext`, `collectTasksContext` produisent des contextes en anglais quand `lang=en`.
- `formatPreTasks`, `formatRawTasksMarkdown`, `deriveAfterFix` et `generateTasksFromFindings` gèrent `lang`.
- Utilisation de `~~~` au lieu de ` ``` ` dans les blocs de code des prompts pour éviter les conflits avec les templates littéraux.
- Le MCP reste compatible avec les nouvelles signatures.
