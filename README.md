<p align="center">
  <a href="https://shinzarou-eng.github.io/codebase-chat">
    <img src="https://raw.githubusercontent.com/shinzarou-eng/codebase-chat/main/docs/assets/social-preview.png?v=3" alt="codebase-chat - Your codebase, fully understood" width="100%">
  </a>
</p>

<h3 align="center">Local-first codebase intelligence.</h3>
<p align="center">
  Chat, search, and audit any repository - every answer cited <code>[source: file:line]</code>.<br>
  Works inside <strong>Cursor, Claude, Windsurf, VS Code, Zed</strong> and any MCP client - or standalone in your terminal.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/codebase-chat"><img src="https://img.shields.io/npm/v/codebase-chat?logo=npm&label=cli&color=4fc1ff&labelColor=252526" alt="npm cli"></a>
  <a href="https://www.npmjs.com/package/codebase-chat-mcp"><img src="https://img.shields.io/npm/v/codebase-chat-mcp?logo=npm&label=mcp&color=4fc1ff&labelColor=252526" alt="npm mcp"></a>
  <a href="https://github.com/shinzarou-eng/codebase-chat/blob/main/LICENSE"><img src="https://img.shields.io/github/license/shinzarou-eng/codebase-chat?color=a3a3a3&labelColor=252526" alt="license"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D20-89d185?logo=nodedotjs&labelColor=252526" alt="node >= 20"></a>
  <a href="https://modelcontextprotocol.io"><img src="https://img.shields.io/badge/MCP-compatible-4fc1ff?labelColor=252526" alt="MCP compatible"></a>
</p>

<p align="center">
  <a href="https://shinzarou-eng.github.io/codebase-chat"><strong>Website</strong></a> ·
  <a href="mcp/README.md">MCP docs</a> ·
  <a href="ROADMAP.md">Roadmap</a> ·
  <a href="CHANGELOG.md">Changelog</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

<br>

## Get started

```bash
npx codebase-chat-mcp setup
```

One command. The wizard detects **Cursor, Claude, Windsurf, VS Code, Zed, Gemini CLI, Kiro, Cline and Roo Code**, asks how you want answers (host model or API key), writes the config - done. No JSON to edit, **no API key required**.

<p align="center">
  <img src="docs/assets/demo-conv.gif" alt="codebase-chat real MCP session on a 422-file codebase" width="840"><br>
  <em>Real MCP session on a real 422-file codebase - <code>codebase_health</code> finds 324 circular deps, <code>codebase_chat</code> answers with <code>[source: file:line]</code> receipts · <a href="docs/assets/demo-power.gif">PR review (--diff + --watch)</a> · <a href="docs/assets/demo.gif">CLI tour</a> · <a href="docs/assets/demo-mcp.gif">MCP stdio</a> · <a href="docs/assets/demo-fr.gif">French mode</a></em>
</p>

## One engine, three surfaces

| In your IDE | In your terminal | Fully offline |
| --- | --- | --- |
| 21 MCP tools inside Cursor, Claude, Windsurf & more - answers land where you code | `npx codebase-chat` - index, search, health, check. Drop `--check --strict` into CI | `--no-llm` deterministic reports + `--ui` dashboard - no model, no key, no cloud |

Every claim comes with a citation. Every metric is computed from your code. Your repo is **never uploaded** - the model only sees the excerpts that matter.

| Understand | Verify | Act |
| --- | --- | --- |
| `chat` · `search` · `explain` · `intelligence` | `health` · `impact` · `check` vs baseline · `deep_audit` (30 metrics) | `refactor` · `tasks` · `fix` · `apply` - dry-run, backups, protected paths |

## Local dashboard - `--ui`

```bash
npx codebase-chat --ui    # → http://127.0.0.1:<port> - nothing leaves your machine
```

<p align="center">
  <img src="docs/assets/dashboard.png" alt="IDE-style local dashboard: editor tabs, command palette, status bar - the deterministic audit as a real app" width="100%">
</p>

The audit as a real app - dense IDE-style UI, not a webpage:

- **Command palette** `Ctrl+K` - jump between views, build a prompt, export, toggle zen mode
- **Zen mode** `z` · view shortcuts `1`–`5` · `/` filters findings by text or severity
- Diff vs baseline, ignore findings with a justification, export `.md` / `.html` - all in clicks
- Bilingual **FR / EN**

## Real output

_What a session actually returns - run on this repository:_

```console
$ npx codebase-chat --health

== STATIC ANALYSIS - codebase-chat ==
Health score: 52/100 (D) · 33 files analyzed · 65 local imports

● Circular dependencies (0)
  none

● Unused files (candidates) (1)
  lib/client.js

● Complexity hotspots (13)
  lib/index.js - score 418
  src/analysis.ts - score 81
  …
```

```console
$ npx codebase-chat --search "health score computation"

--- src/analysis.ts :: formatHealthReportMd (FUNCTION) [source: src/analysis.ts:285-353] ---
--- src/analysis.ts :: analyzeProject       (FUNCTION) [source: src/analysis.ts:149-232] ---
--- src/analysis.ts :: HealthReport         (TYPE)     [source: src/analysis.ts:15-26]   ---

$ npx codebase-chat --ask "how is the index cached?"

> codebase-chat · prompt-only mode (no API key)
> Chunks: 81 · Tokens: 59,934 → handed to the host model
> Cite every technical claim with [source: relative/path:line].
```

`codebase_health` runs **fully offline** - deterministic, no LLM, same input → same score.
Every answer from `codebase_chat` arrives with receipts you can verify in seconds.

## Verify your changes

```console
$ npx codebase-chat --baseline        # snapshot findings + score to .codebase-chat/baseline.json (commit it)
$ npx codebase-chat --check           # impact + findings on files changed vs HEAD, diffed vs baseline
$ npx codebase-chat --check --strict  # exit 1 on a red verdict - drop into CI
$ npx codebase-chat --doctor          # diagnose the install: node, index cache, keys, MCP clients
```

From an IDE: `codebase_check` / `codebase_doctor` MCP tools, or `/codebase check` in DeepSeek Harness.

## Why it wins

| | Paste into a chat | Hosted assistant | **codebase-chat** |
| --- | :-: | :-: | :-: |
| Sees your **whole** repo, not one file | ❌ | ✅ | ✅ |
| `[source: file:line]` citations | ❌ | ~ | ✅ |
| Repo never uploaded - model sees only relevant excerpts | ❌ | ❌ | ✅ |
| Inside Claude / Cursor / Windsurf | ❌ | ~ | ✅ |
| Fully offline - `--no-llm` report & `--ui` dashboard, zero model | ❌ | ❌ | ✅ |
| Free - no API key, no account | ~ | ❌ | ✅ |

## How it works

<p align="center">
  <img src="docs/assets/how-it-works.png" alt="Pipeline: source → AST index → retrieval → briefing → host model → cited answer, all local-first" width="100%">
</p>

Writes are safe by construction - **dry-run** · **`.dsh-backups/`** before overwrite · **protected paths** · never outside the project.

Ten tools run **fully deterministic** - no model, no key, works offline: `health`, `impact`, `check`, `doctor`, `ignore`, `fix`, `stats`, `history`, `baseline`, `deep_audit` (9 sections, ~30 metrics: git churn, bus factor, secrets, deps, per-function complexity).

## Reference

<details>
<summary><strong>Install - all paths</strong></summary>
<br>

**MCP server - manual config**

```json
{
  "mcpServers": {
    "codebase-chat": {
      "command": "npx",
      "args": ["codebase-chat-mcp"]
    }
  }
}
```

Without `DEEPSEEK_API_KEY` / `OPENAI_API_KEY` the server runs `promptOnly`. Set either key for direct-LLM calls - see [`mcp/README.md`](mcp/README.md).

**CLI**

```bash
npx codebase-chat --project C:\my-app --ask "how is auth handled?"
npx codebase-chat --project C:\my-app --health   # offline, no LLM
npx codebase-chat --project C:\my-app --health --diff main   # only what changed
npx codebase-chat --project C:\my-app --watch    # index stays hot while you code
npx codebase-chat --project C:\my-app --prompt intelligence   # same brief the IDE gets - pipe to any LLM
npx codebase-chat --project C:\my-app --prompt intelligence --call    # DeepSeek/OpenAI answers directly (API key)
npx codebase-chat --project C:\my-app --prompt intelligence --no-llm  # deterministic report - zero model, zero key
npx codebase-chat --project C:\my-app --ui   # interactive HTML dashboard on localhost - no LLM
```

**DeepSeek Harness plugin**

```bash
dsh plugin --profile web add codebase-chat
```

Then restart `dsh web` → `http://127.0.0.1:3080` → **Codebase Pro** button.

**From source**

```bash
git clone https://github.com/shinzarou-eng/codebase-chat.git
cd codebase-chat && pnpm install && pnpm build
```

</details>

<details>
<summary><strong>Slash commands (DeepSeek Harness)</strong></summary>
<br>

```powershell
dsh --profile headless '/codebase "how is auth handled?" --project C:\my-app'
dsh --profile headless '/codebase-search "usePetStore" --project C:\my-app'
dsh --profile headless '/codebase-explain "storage.ts" --project C:\my-app'
dsh --profile headless '/codebase-refactor "split this hook" --file storage.ts --project C:\my-app'
dsh --profile headless '/codebase-intel --project C:\my-app'
dsh --profile headless '/codebase-audit --project C:\my-app --lang en'
dsh --profile headless '/codebase-tasks --project C:\my-app'
dsh --profile headless '/codebase-apply-tasks --project C:\my-app'
dsh --profile headless '/codebase-build --project C:\my-app'
dsh --profile headless '/codebase-git --project C:\my-app'
```

</details>

<details>
<summary><strong><code>.codebase-chat.json</code> - per-project settings</strong></summary>
<br>

```json
{
  "lang": "en",
  "maxTokens": 60000,
  "ignoreDirs": ["generated", "fixtures"],
  "ignoreFiles": ["bundle.js"],
  "ignoreGlobs": ["src/vendor/**", "*.snap"],
  "protectedPaths": ["src/locked", "migrations"]
}
```

| Key | Effect |
| --- | --- |
| `lang` | Default prompt language (`en`/`fr`) - CLI, MCP tools, slash commands |
| `maxTokens` | Context budget when the caller passes none |
| `ignoreDirs` / `ignoreFiles` | Extra names skipped by indexing, `codebase_health`, file tree |
| `ignoreGlobs` | Globs on project-relative paths - `**` spans dirs, `*` one segment |
| `protectedPaths` | Paths the apply pipeline can never patch |

</details>

<details>
<summary><strong>Environment variables</strong></summary>
<br>

| Variable | Default | Purpose |
| --- | --- | --- |
| `CODEBASE_CACHE_DIR` | OS cache dir | Where the index cache lives |
| `DSH_PROJECT_ALIASES` | - | Extra `name=path` aliases (`;`-separated) |
| `DSH_PROTECTED_PATHS` | built-in list | Extra paths that can never be patched |
| `DEEPSEEK_API_KEY` / `OPENAI_API_KEY` | - | Direct-LLM mode only |
| `DEEPSEEK_BASE_URL` / `OPENAI_BASE_URL` | `https://api.deepseek.com/v1` | Custom endpoint |
| `CODEBASE_MODEL` | `deepseek-chat` | Model for direct-LLM mode |

</details>

<details>
<summary><strong>Plain words - 🇫🇷 inside</strong></summary>
<br>

Point it at a folder of code. Ask questions like a human - *"How does login work?"*, *"What should I fix first?"* - in French or English. Every answer cites the exact file and line it came from. **Nothing is uploaded anywhere.**

*Pointez-le vers un dossier de code. Posez vos questions en langage clair. Chaque réponse cite le fichier et la ligne exacts. **Rien n'est envoyé sur internet.***

| Term | Meaning |
| --- | --- |
| **MCP server** | A plug format that lets AI assistants use extra tools. Install once - your IDE can "see" your code. |
| **Prompt-only** | The tool prepares the context; your existing AI writes the answer. No extra key, no extra cost. |
| **Deterministic** | Computed directly from your code - same input, same result, every time. |

</details>

<details>
<summary><strong>Project layout & dev</strong></summary>
<br>

```
├── lib/            DeepSeek Harness plugin (index.js) + Codebase Pro UI (client.js)
├── src/            TypeScript engine - indexer, extractor, retriever, tokenizer, context, CLI
├── mcp/            Standalone MCP server package (codebase-chat-mcp)
├── test/           Vitest suites (extractor, retriever, tasks pipeline)
├── docs/           Landing page (GitHub Pages) + assets
└── dist/           Build output (tsup)
```

```bash
pnpm install && pnpm build && pnpm test && pnpm typecheck
```

</details>

<details>
<summary><strong>FAQ</strong></summary>
<br>

**Does it send my code to the cloud?**
Indexing, retrieval, and prompt building all run on your machine. In prompt-only mode the server makes no network calls itself - the assembled context is read by your host model (cloud or local, your choice). For zero-network output end to end, use `--no-llm`: a deterministic report computed from your code only.

**Do I need an API key?**
No - three ways to get output: the host model (`promptOnly`, best quality - pipe it to a local model like Ollama for offline answers), a DeepSeek/OpenAI key (`--call`), or the deterministic report (`--no-llm`, no model at all). Inside DeepSeek Harness, the plugin uses your configured model.

**Which languages are supported?**
French and English via `lang` on every tool. Source-side, AST covers JS/TS, Python, Go, Rust, Java, C#, PHP - the rest is indexed line by line.

**Is applying patches safe?**
Yes. Dry-run, backups before overwrite, protected paths, writes stay inside the project.

**EADDRINUSE on port 3080?**
```powershell
Get-NetTCPConnection -LocalPort 3080 | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```
Then restart `dsh --profile web`.

</details>

<details>
<summary><strong>Roadmap</strong></summary>
<br>

| | |
| --- | --- |
| **Shipped** | tree-sitter AST (7 languages), deterministic health score + `--no-llm` deep audit, `--ui` local dashboard (IDE-style, Ctrl+K palette, zen mode, bilingual, exports), `check`/`fix`/`ignore`/`doctor` verified workflow + baseline & CI gate, `deep_audit` MCP tool + `ui://` resource, token/context stats, MCP setup wizard, `.codebase-chat.json`, `--diff` scoping, `--watch` mode |
| **Next** | GitHub Issues export from TASKS.md, prompt language packs (ES/DE/PT) |
| **Planned** | VS Code extension, HTTP/SSE transport, PR review mode |
| **Exploring** | multi-repo workspaces, shared team index cache, CI bot |

<sub>Full detail: <a href="ROADMAP.md">ROADMAP.md</a></sub>

</details>

---

<p align="center">
  <strong>If this project helps you - <a href="https://github.com/shinzarou-eng/codebase-chat">star it on GitHub</a> ⭐</strong>
  <br><br>
  <a href="https://shinzarou-eng.github.io/codebase-chat">Website</a> ·
  <a href="https://github.com/shinzarou-eng/codebase-chat/issues">Issues</a> ·
  <a href="SUPPORT.md">Support</a> ·
  <a href="SECURITY.md">Security</a>
  <br><br>
  <sub><a href="LICENSE">MIT License</a> - built and maintained by <a href="https://github.com/shinzarou-eng">shinzarou-eng</a></sub>
</p>
