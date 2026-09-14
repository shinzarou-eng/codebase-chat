# Changelog

All notable changes to **codebase-chat** (`codebase-chat` + `codebase-chat-mcp`).

History before the rename (published as `dsh-codebase-chat` / `dsh-codebase-chat-mcp`, versions ≤ 0.28) lives in the git tags.

## 0.29.1 — IDE-style dashboard, command palette & security hardening

**Dashboard**

- Dense IDE redesign — VS Code-inspired title bar with editor tabs, compact panels, blue status bar, amber code styling. Replaces the sidebar layout; the standalone HTML export and MCP `ui://` resource share the same theme.
- Command palette — `Ctrl+K` / `⌘K` opens a searchable command overlay (views, prompt builder, filters, exports, zen mode) with arrow-key navigation.
- Zen mode — `z` hides the chrome for focused report reading; `Esc` exits.
- View shortcuts — `1`–`5` switch views; `/` focuses the filter.

**Security**

- `esc()` now escapes quotes in HTML attributes — a file path containing `"` could previously break out of `title="…"`/`value="…"` attributes; the file datalist is now escaped too.

**Internals**

- `src/report.ts` (808l, complexity 184) split into focused modules (`report-scan`, `report-git`, `report-deps`, `report-collect`, `report-i18n`, `report-render`) — max per-file complexity down to 64, output verified byte-identical.
- New tests: `ui.test.ts`, `dashboard.test.ts` (HTTP smoke), `scanCode` comment-awareness regression tests.
- CI: empty-SARIF fallback so `upload-sarif` never masks a check failure; `codeql-action` v4.

## 0.29.0 / mcp 0.10.0 — local dashboard, verified fixes & 18 tools

**New**

- `--ui` — launches a Fluent web dashboard on `127.0.0.1`: run deep audit / health / stats / impact, ask a question and copy the built prompt, switch projects, filter by severity or text, collapse sections, export `.md`/`.html`, "My changes" view with one-click baseline — all clicks, no terminal, fully local, FR/EN.
- `codebase_fix` / `--fix` — verified mechanical repairs where the fix is unambiguous: undocumented env vars appended to `.env.example`, dead deps removed, unused exports un-exported, console/debugger lines deleted. Each fix re-checks itself; `dry` previews without writing.
- `codebase_deep_audit` — deterministic MCP tool running the full 9-section, ~30-metric audit; `ui: true` also returns a `ui://` HTML dashboard resource for MCP-UI clients.
- Rich `--stats` — exact `o200k`/`cl100k` token counts, per-model-family estimates (DeepSeek, Claude, Gemini, Llama), context-window fit, estimated cost per `--call`, top files, extension distribution. Shared `src/stats.ts` engine powers CLI + dashboard.
- Ignores, check history, symbol-level impact, suggested tests, SARIF export for PR annotations, pre-commit hook + self-audit gate in CI (`--check --strict`).
- `setup` also installs the `/codebase` skill for compatible agents; intent-first `/codebase` menu and `/codebase help` reference.

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
