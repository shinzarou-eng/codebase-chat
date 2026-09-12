#!/usr/bin/env node
// Interactive setup wizard: detects installed MCP clients and writes the
// dsh-codebase-chat server entry into their config files. Zero dependencies —
// safe to run via `npx dsh-codebase-chat-mcp setup`.
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir, platform } from "node:os";
import { createInterface } from "node:readline/promises";

const PKG = "dsh-codebase-chat-mcp";
const SERVER_NAME = "dsh-codebase-chat";

const isWin = platform() === "win32";
const isMac = platform() === "darwin";

function claudeConfigPath(home) {
  if (isWin) return join(process.env.APPDATA || join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
  if (isMac) return join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  return join(home, ".config", "Claude", "claude_desktop_config.json");
}

function vscodeUserMcpPath(home) {
  if (isWin) return join(process.env.APPDATA || join(home, "AppData", "Roaming"), "Code", "User", "mcp.json");
  if (isMac) return join(home, "Library", "Application Support", "Code", "User", "mcp.json");
  return join(home, ".config", "Code", "User", "mcp.json");
}

function vscodeUserDir(home) {
  return dirname(vscodeUserMcpPath(home));
}

function zedConfigPath(home) {
  if (isWin) return join(process.env.APPDATA || join(home, "AppData", "Roaming"), "Zed", "settings.json");
  if (isMac) return join(home, ".config", "zed", "settings.json");
  return join(home, ".config", "zed", "settings.json");
}

// Each client: how to detect it is installed (any of `detect` paths exists),
// where its config lives, and which JSON shape it expects.
export const CLIENTS = [
  {
    id: "claude",
    name: "Claude Desktop",
    configPath: (h) => claudeConfigPath(h),
    detect: (h) => [dirname(claudeConfigPath(h))],
    format: "mcpServers",
  },
  {
    id: "cursor",
    name: "Cursor",
    configPath: (h) => join(h, ".cursor", "mcp.json"),
    detect: (h) => [join(h, ".cursor")],
    format: "mcpServers",
  },
  {
    id: "windsurf",
    name: "Windsurf",
    configPath: (h) => join(h, ".codeium", "windsurf", "mcp_config.json"),
    detect: (h) => [join(h, ".codeium", "windsurf"), join(h, ".windsurf")],
    format: "mcpServers",
  },
  {
    id: "claude-code",
    name: "Claude Code (CLI)",
    configPath: (h) => join(h, ".claude.json"),
    detect: (h) => [join(h, ".claude"), join(h, ".claude.json")],
    format: "mcpServers",
  },
  {
    id: "vscode",
    name: "VS Code (user profile)",
    configPath: (h) => vscodeUserMcpPath(h),
    detect: (h) => [dirname(vscodeUserMcpPath(h))],
    format: "vscodeServers",
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    configPath: (h) => join(h, ".gemini", "settings.json"),
    detect: (h) => [join(h, ".gemini")],
    format: "mcpServers",
  },
  {
    id: "kiro",
    name: "Kiro",
    configPath: (h) => join(h, ".kiro", "settings", "mcp.json"),
    detect: (h) => [join(h, ".kiro")],
    format: "mcpServers",
  },
  {
    id: "zed",
    name: "Zed",
    configPath: (h) => zedConfigPath(h),
    detect: (h) => [dirname(zedConfigPath(h))],
    format: "zedContextServers",
  },
  {
    id: "cline",
    name: "Cline (VS Code)",
    configPath: (h) => join(vscodeUserDir(h), "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json"),
    detect: (h) => [join(vscodeUserDir(h), "globalStorage", "saoudrizwan.claude-dev")],
    format: "mcpServers",
  },
  {
    id: "roo",
    name: "Roo Code (VS Code)",
    configPath: (h) => join(vscodeUserDir(h), "globalStorage", "rooveterinaryinc.roo-cline", "settings", "cline_mcp_settings.json"),
    detect: (h) => [join(vscodeUserDir(h), "globalStorage", "rooveterinaryinc.roo-cline")],
    format: "mcpServers",
  },
  {
    id: "vscode-workspace",
    name: "VS Code (ce workspace : .vscode/mcp.json)",
    configPath: (h, cwd) => join(cwd || process.cwd(), ".vscode", "mcp.json"),
    detect: () => [process.cwd()],
    format: "vscodeServers",
    workspace: true,
  },
];

export function detectClients(home = homedir()) {
  return CLIENTS.filter((c) => c.detect(home).some((p) => existsSync(p)));
}

// On Windows, MCP clients launched as GUI apps can't resolve `npx` (it's a
// .cmd shim); wrapping in `cmd /c` is the documented workaround.
export function serverEntry(apiKey = "", localLlm = false) {
  const entry = isWin
    ? { command: "cmd.exe", args: ["/c", "npx", "-y", PKG] }
    : { command: "npx", args: ["-y", PKG] };
  const env = {};
  if (apiKey) env.DEEPSEEK_API_KEY = apiKey;
  if (localLlm) env.CODEBASE_LOCAL_LLM = "1";
  if (Object.keys(env).length) entry.env = env;
  return entry;
}

// Merge our server into an existing client config without touching other
// entries. `format` selects the top-level key and entry shape.
export function mergeConfig(existing, entry, format) {
  const cfg = existing && typeof existing === "object" ? { ...existing } : {};
  if (format === "vscodeServers") {
    const servers = { ...(cfg.servers || {}) };
    servers[SERVER_NAME] = { type: "stdio", ...entry };
    cfg.servers = servers;
  } else if (format === "zedContextServers") {
    const servers = { ...(cfg.context_servers || {}) };
    servers[SERVER_NAME] = {
      command: { path: entry.command, args: entry.args, ...(entry.env ? { env: entry.env } : {}) },
      settings: {},
    };
    cfg.context_servers = servers;
  } else {
    const servers = { ...(cfg.mcpServers || {}) };
    servers[SERVER_NAME] = entry;
    cfg.mcpServers = servers;
  }
  return cfg;
}

export function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function writeConfig(path, cfg) {
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) copyFileSync(path, `${path}.bak`);
  writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n", "utf8");
}

export async function runSetup() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  // Queue stdin lines so piped input works; a closed + empty queue yields defaults.
  const lines = [];
  let closed = false;
  const waiters = [];
  rl.on("line", (l) => (waiters.length ? waiters.shift()(l) : lines.push(l)));
  rl.on("close", () => { closed = true; while (waiters.length) waiters.shift()(null); });
  const ask = (q, def = "") => {
    process.stdout.write(q);
    if (lines.length) return Promise.resolve(String(lines.shift()).trim());
    if (closed) return Promise.resolve(def);
    return new Promise((r) => waiters.push((l) => r(l === null ? def : String(l).trim())));
  };
  const home = homedir();
  const detected = detectClients(home);

  console.log(`\n  ${PKG} — setup\n`);

  if (detected.length === 0) {
    console.log("  Aucun client MCP detecte. Entree a copier manuellement :\n");
    console.log(JSON.stringify({ mcpServers: { [SERVER_NAME]: serverEntry() } }, null, 2));
    rl.close();
    return;
  }

  console.log("  Clients detectes :");
  detected.forEach((c, i) => console.log(`    ${i + 1}. ${c.name}`));
  console.log("    a. Tous\n");

  const pick = (await ask("  Lesquels configurer ? (ex: 1,3 ou a) [a] : ", "a")).toLowerCase();
  const chosen = pick === "" || pick === "a"
    ? detected
    : pick.split(",").map((s) => detected[parseInt(s.trim(), 10) - 1]).filter(Boolean);

  if (chosen.length === 0) {
    console.log("  Rien a faire.");
    rl.close();
    return;
  }

  console.log("  Mode de reponse :");
  console.log("    1. prompt-only — le modele hote repond (recommande, meilleure qualite)");
  console.log("    2. cle API — le serveur appelle DeepSeek/OpenAI directement");
  console.log("    3. local — modele embarque, 100 % hors-ligne (~1 Go au 1er lancement, qualite moindre)");
  const mode = (await ask("  Choix [1] : ", "1")) || "1";

  let apiKey = "";
  let localLlm = false;
  if (mode === "2") {
    apiKey = await ask("  Clef API DeepSeek/OpenAI : ");
  } else if (mode === "3") {
    localLlm = true;
    console.log("  Note : petit modele (Qwen2.5-1.5B) — bon pour les recherches rapides,");
    console.log("  prefere le modele hote pour les rapports. localLlm: true reste dispo par appel.");
  }
  const entry = serverEntry(apiKey, localLlm);

  for (const client of chosen) {
    const path = client.configPath(home, process.cwd());
    const merged = mergeConfig(readJson(path), entry, client.format);
    writeConfig(path, merged);
    console.log(`  [ok] ${client.name} -> ${path}`);
  }

  console.log(`\n  Redemarre ${chosen.length > 1 ? "les clients" : "le client"} : les outils codebase_* apparaissent.`);
  if (localLlm) console.log("  Mode local actif : reponses hors-ligne, premier appel telecharge le modele (~1 Go).");
  else if (!apiKey) console.log("  Mode prompt-only actif : les outils renvoient le prompt au modele hote.");
  console.log("\n  Autre client MCP ? Entree a copier manuellement :");
  console.log(JSON.stringify({ mcpServers: { [SERVER_NAME]: entry } }, null, 2));
  rl.close();
}

// Direct invocation (`node setup.mjs`) also runs the wizard.
if (process.argv[1] && process.argv[1].endsWith("setup.mjs")) {
  runSetup().catch((err) => {
    console.error("setup failed:", err.message);
    process.exit(1);
  });
}
