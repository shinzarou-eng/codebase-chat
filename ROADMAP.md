# Roadmap

This document tracks where **codebase-chat** is going. It is organized by horizon -
not by date - and updated as work ships. Items move from *Exploring* → *Planned* → *Next* → *Shipped*.

Want to influence priorities? [Open an issue](https://github.com/shinzarou-eng/codebase-chat/issues) or pick up an item marked `help wanted`.

---

## ✅ Shipped

### Relaunch - `codebase-chat`

- Renamed `dsh-codebase-chat` → **`codebase-chat`** / **`codebase-chat-mcp`** - MCP-first positioning; DeepSeek Harness stays a supported integration, not the identity
- New repository [`shinzarou-eng/codebase-chat`](https://github.com/shinzarou-eng/codebase-chat) - clean history, GitHub Pages site, IDE-styled demos & social preview, topics + homepage configured
- Old npm packages unpublished - single canonical install path: `npx codebase-chat-mcp setup`

### v0.29 - Verified workflow: check, fix, ignore, doctor

- `codebase_check` / `--check` - verify changed files vs a git ref, delta vs committed baseline, `--strict` red verdict for CI, SARIF export for PR annotations, pre-commit hook
- `codebase_fix` / `--fix` - verified mechanical repairs (dead deps, unused exports, env docs, console/debugger) with `dry` preview
- `codebase_ignore` - silence findings with justification in `.codebase-chat/ignores.json`
- `codebase_doctor` / `--doctor` - install & environment diagnostic
- `codebase_deep_audit` MCP tool + `ui://` dashboard resource; `--no-llm` deep audit from CLI
- `/codebase` skill for agents, intent-first menu, `/codebase help`
- Dashboard "My changes" view, severity filters, one-click baseline; audit memoization (≈50× faster repeat calls)

### v0.28 - Local dashboard, deep audit & token stats

- `--ui` - Fluent web dashboard on localhost: audit, health, stats, impact, ask-a-question, severity filters, FR/EN toggle, `.md`/`.html` export, project switching - all clicks, no terminal
- `codebase_deep_audit` - deterministic MCP tool running ~30 analyses: git churn & bus factor, churn × complexity risk, dependency integrity, per-function complexity, secrets, env coverage, README/config hygiene - all cited `file:line`, no LLM needed. `ui: true` returns a `ui://` HTML dashboard resource for MCP-UI clients
- `--prompt intelligence --no-llm` - the same deep audit from the CLI: zero model, zero key, zero network
- Rich `--stats` - exact `o200k`/`cl100k` token counts, per-model-family estimates, context-window fit, top files, extension distribution (shared engine `src/stats.ts` powering CLI + dashboard)
- Embedded local LLM mode removed - replaced by honest deterministic analysis and prompt piping

### v0.23.0 - Diff-aware retrieval & watch mode

- `--diff <ref>` scopes `--ask`/`--search`/`--health` (and the `diff` argument on every MCP tool) to files changed vs a git ref - committed, staged, unstaged and untracked
- `--watch` keeps the index hot: recursive filesystem watcher, debounced incremental rebuilds

### v0.21.0 - Tree-sitter multi-language extraction

- Real AST parsing for Python, Go, Rust, Java, C#, PHP (WASM grammars, lazy per-language loading, regex fallback)
- Fixed `mergeGaps` - uncovered lines were silently dropped from the index

### v0.20.0 - Project configuration

- `.codebase-chat.json` per project: budgets, ignore dirs/files/globs, protected paths, default lang
- Ignore rules shared by the indexer, `codebase_health` and the context file tree
- Explicit CLI/tool arguments always override config values

### v0.18.0 - Reliability & performance pass

- Working `codebase_apply_tasks` pipeline (FR/EN parsing, `~~~` and ` ``` ` fences)
- `--content` flag for `/codebase-apply`, `.dsh-backups/` before overwrite
- Incremental index refresh + mtime/size freshness checks
- Chunk-level lexical scoring, deduplicated retrieval inside token budget
- `lang` on every tool and slash command, 180 s tool timeout, bounded progress store
- MCP **prompt-only mode** - no API key required, the host model answers
- Explain fallback: symbol targets resolve even when no file matches

### Earlier

- Symbol-level indexer (Babel AST + regex fallback) with disk cache
- Local multilingual embeddings (`Xenova/paraphrase-multilingual-MiniLM-L12-v2`)
- 14 MCP tools, 16+ slash commands, Codebase Pro panel in DeepSeek Harness
- Deterministic static analysis (`codebase_health` / `--health`): circular dependencies, dead code, duplication, complexity hotspots, health score
- Bilingual prompts (FR/EN), evidence format `[source]`/`[Confidence]`/`[Severity]`
- npm publication of both packages, GitHub Pages site, CLI binary

---

## 🔜 Next - engine depth & distribution

Things actively being worked on or fully specced.

- **Distribution** - `codebase-chat` / `codebase-chat-mcp` on npm, official MCP Registry entry, community listings (awesome-mcp-servers, Glama)
- **GitHub Issues export** - turn a `TASKS.md` sprint into real issues in one command
- **Prompt language packs** - ES, DE, PT (community-friendly format)

## 🗺️ Planned - integrations & surfaces

- **VS Code extension** - sidebar panel, inline "Explain this", CodeLens citations
- **HTTP/SSE transport** for the MCP server (remote teams, web clients)
- **PR review mode** - post a cited review summary on a pull request via GitHub API
- **Interactive diff viewer** in the Codebase Pro panel (accept/reject per hunk)
- **JetBrains plugin** - depends on demand; MCP already covers it indirectly

## 💭 Exploring - longer horizon

Ideas under evaluation - not committed yet.

- **Multi-repo workspaces** - index and query across service boundaries
- **Shared team index cache** - one member indexes, the team reuses
- **CI bot** - comment audit summaries on every PR (GitHub Action)
- **Local reranker** - cross-encoder pass after retrieval for tighter context
- **Dependency intelligence** - outdated/vulnerable package signals folded into audits
- **JetBrains + Neovim** native clients
- **More output languages** - ZH, JA, AR once pack format stabilizes

---

## Guiding principles

1. **Local-first** - code never leaves the machine unless the user explicitly configures a model endpoint.
2. **Evidence over vibes** - every claim must carry a source citation; no fabricated references.
3. **Safe mutation** - apply paths always offer dry-run, backups, and project-boundary enforcement.
4. **Bilingual by default** - FR/EN parity is a feature, not an afterthought.
5. **MCP-native** - one engine, every client.
