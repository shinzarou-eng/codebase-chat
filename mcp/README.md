# dsh-codebase-chat-mcp

<p align="center">
  <img src="https://raw.githubusercontent.com/shinzarou-eng/dsh-codebase-chat/main/docs/assets/logo.svg" width="80" height="80" alt="dsh-codebase-chat logo">
</p>

<p align="center">
  <strong>Standalone MCP server for dsh-codebase-chat.</strong><br>
  Works with Windsurf, Cursor, Claude, and any MCP-compatible IDE — without DeepSeek Harness.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-codebase-chat-mcp"><img src="https://img.shields.io/npm/v/dsh-codebase-chat-mcp?logo=npm&color=purple" alt="npm"></a>
  <a href="https://github.com/shinzarou-eng/dsh-codebase-chat/releases"><img src="https://img.shields.io/github/v/release/shinzarou-eng/dsh-codebase-chat?logo=github" alt="release"></a>
  <a href="https://github.com/shinzarou-eng/dsh-codebase-chat/blob/main/LICENSE"><img src="https://img.shields.io/github/license/shinzarou-eng/dsh-codebase-chat?color=blue" alt="license"></a>
</p>

---

## What it does

This package exposes the same codebase intelligence tools as the DeepSeek Harness plugin, but as a standalone **Model Context Protocol (MCP)** server. It scans a local project, builds a sourced prompt, and either:

- returns the prompt to the **host model** (Cursor, Claude, Windsurf…) — the default when no API key is configured, or with `promptOnly: true`; or
- calls a DeepSeek / OpenAI-compatible API itself when `DEEPSEEK_API_KEY` or `OPENAI_API_KEY` is set.

Deterministic tools (`codebase_health`, `codebase_impact`, `codebase_deep_audit`) need no model at all — same input, same output, fully offline.

In prompt mode your code never leaves your machine at all.

---

## Prerequisites

- Node.js >= 20
- Optional: a DeepSeek / OpenAI-compatible API key (`DEEPSEEK_API_KEY` or `OPENAI_API_KEY`) — only needed if you want the server to call the LLM itself. Without a key, tools return the built prompt for the host model.

---

## Installation

```bash
npm install -g dsh-codebase-chat-mcp

# Or run without installing
npx dsh-codebase-chat-mcp
```

### Quick setup (recommended)

```bash
npx dsh-codebase-chat-mcp setup
```

The wizard detects installed MCP clients (Claude Desktop, Claude Code, Cursor, Windsurf, VS Code, Zed, Gemini CLI, Kiro, Cline, Roo Code), lets you pick which ones to configure, asks how you want answers (prompt-only host model or direct API key), and writes the `dsh-codebase-chat` server entry for you — preserving your existing `mcpServers` and backing up each config file (`.bak`). It always prints a manual entry at the end for any other MCP client. No API key needed for prompt-only mode.

### From source

```bash
git clone https://github.com/shinzarou-eng/dsh-codebase-chat.git
cd dsh-codebase-chat/mcp
pnpm install
```

---

## Configuration

Set one of:

```powershell
$env:DEEPSEEK_API_KEY = "sk-..."
# or
$env:OPENAI_API_KEY = "sk-..."
```

Optional:

- `DEEPSEEK_BASE_URL` or `OPENAI_BASE_URL` (default: `https://api.deepseek.com/v1`)
- `CODEBASE_MODEL` (default: `deepseek-chat`)

### Per-project `.codebase-chat.json`

A `.codebase-chat.json` at the indexed project root tunes every tool:
`lang` (default prompt language), `maxTokens` (context budget), `ignoreDirs`,
`ignoreFiles`, `ignoreGlobs` (indexing/analysis exclusions) and `protectedPaths`
(apply pipeline). Explicit tool arguments always win. See the main README for the
full schema.

---

## Usage in Windsurf / Cursor / Claude

Add to your MCP config:

```json
{
  "mcpServers": {
    "dsh-codebase-chat": {
      "command": "npx",
      "args": ["dsh-codebase-chat-mcp"],
      "env": {
        "DEEPSEEK_API_KEY": "sk-...",
        "CODEBASE_MODEL": "deepseek-chat"
      }
    }
  }
}
```

On Windows with a local clone you can also use the absolute path:

```json
{
  "mcpServers": {
    "dsh-codebase-chat": {
      "command": "node",
      "args": [
        "C:\\Users\\YOU\\dsh-codebase-chat\\mcp\\index.mjs"
      ],
      "env": {
        "DEEPSEEK_API_KEY": "sk-..."
      }
    }
  }
}
```

---

## Tools exposed

| Tool | Purpose |
| --- | --- |
| `codebase_chat` | Q&A on a local project |
| `codebase_search` | Search symbol or term |
| `codebase_explain` | Explain a file or symbol |
| `codebase_refactor` | Propose a refactor |
| `codebase_intelligence` | Full CTO brief |
| `codebase_audit` | Tech-debt & non-conformities |
| `codebase_report` | Strategic board report |
| `codebase_ceo` | One-page CEO brief |
| `codebase_tasks` | Generate a `TASKS.md` plan |
| `codebase_player` | UX / playthrough brief |
| `codebase_crea` | Creative / marketing ideas from the code |
| `codebase_health` | **Deterministic** static analysis — cycles, dead code, duplication, complexity, health score. No LLM needed |
| `codebase_impact` | **Deterministic** blast-radius analysis — which files transitively depend on a target (`file`, required). No LLM needed |
| `codebase_deep_audit` | **Deterministic** full audit — git churn & bus factor, churn × complexity risk, dependency integrity, per-function complexity, secrets, env coverage, README/config hygiene. ~30 analyses, all cited `file:line`. No LLM needed. Pass `ui: true` to also get a `ui://` HTML dashboard resource (MCP-UI clients) |

All tools accept:

- `projectPath` (string, absolute or relative path, default: cwd)
- `lang` (string, `fr` or `en`, default: `fr`)
- `focus` / `query` (string, optional)
- `embed` (boolean, local semantic embeddings for better retrieval)
- `promptOnly` (boolean — return the built prompt for the host model instead of calling the LLM)
- `diff` (string, git ref e.g. `main`, `HEAD~5` — scopes retrieval and `codebase_health` to files changed vs that ref, including uncommitted and untracked files)

---

## Evidence & scoring

Every output is marked with:

- `[source: relative/path/file.ts:line]`
- `[Confidence: X%]`
- `[Severity: Critical/High/Medium/Low]`

---

## Transport

By default the server uses `stdio` (MCP standard). SSE/HTTP transport can be added in a future version.

---

## License

[MIT](https://github.com/shinzarou-eng/dsh-codebase-chat/blob/main/LICENSE) — Built and maintained by [shinzarou-eng](https://github.com/shinzarou-eng).
