#!/usr/bin/env node
// Interactive setup wizard: detects installed MCP clients and writes the
// dsh-codebase-chat server entry into their config files. Zero dependencies —
// safe to run via `npx dsh-codebase-chat-mcp setup`.
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir, platform } from "node:os";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

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
const CLIENTS = [
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
    name: "VS Code (workspace: .vscode/mcp.json)",
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
export function serverEntry(apiKey = "") {
  const entry = isWin
    ? { command: "cmd.exe", args: ["/c", "npx", "-y", PKG] }
    : { command: "npx", args: ["-y", PKG] };
  const env = {};
  if (apiKey) env.DEEPSEEK_API_KEY = apiKey;
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

const T = {
  fr: {
    title: (p) => `\n  ${p} — setup\n`,
    none: "  Aucun client MCP détecté. Entrée à copier manuellement :\n",
    detected: "  Clients détectés :",
    all: "    a. Tous\n",
    which: "  Lesquels configurer ? (ex: 1,3 ou a) [a] : ",
    invalidPick: "  Choix invalide — entre des numéros (ex: 1,3) ou 'a'.",
    nothing: "  Rien à faire.",
    modeTitle: "  Mode de réponse :",
    mode1: "    1. prompt-only — le modèle hôte répond (recommandé, meilleure qualité)",
    mode2: "    2. clé API — le serveur appelle DeepSeek/OpenAI directement",
    choice: "  Choix [1] : ",
    invalidMode: "  Choix invalide — entre 1 ou 2.",
    apiKey: "  Clé API DeepSeek/OpenAI : ",
    apiKeyEmpty: "  Clé vide — réessaie (ou Ctrl+C pour annuler).",
    apiKeyNote: "  Note : la clé est stockée en clair dans le JSON de config du client.",
    ok: (name, path) => `  [ok] ${name} -> ${path}`,
    restart: (n) => `\n  Redémarre ${n > 1 ? "les clients" : "le client"} : les outils codebase_* apparaissent.`,
    promptActive: "  Mode prompt-only actif : les outils renvoient le prompt au modèle hôte.",
    manual: "\n  Autre client MCP ? Entrée à copier manuellement :",
    checking: "  Vérification de l'installation...",
    checkOk: (n) => `  [check] serveur OK — ${n} outils codebase_* disponibles`,
    checkFail: (m) => `  [check] échec : ${m}\n  Le client risque de ne pas démarrer le serveur. Vérifie que Node.js >= 20 est installé.`,
    cmdOk: (p) => `  [ok] /codebase → ${p} (menu des outils dans Claude Code)`,
  },
  en: {
    title: (p) => `\n  ${p} — setup\n`,
    none: "  No MCP client detected. Copy this entry manually:\n",
    detected: "  Detected clients:",
    all: "    a. All\n",
    which: "  Which ones to configure? (e.g. 1,3 or a) [a]: ",
    invalidPick: "  Invalid choice — enter numbers (e.g. 1,3) or 'a'.",
    nothing: "  Nothing to do.",
    modeTitle: "  Answer mode:",
    mode1: "    1. prompt-only — the host model answers (recommended, best quality)",
    mode2: "    2. API key — the server calls DeepSeek/OpenAI directly",
    choice: "  Choice [1]: ",
    invalidMode: "  Invalid choice — enter 1 or 2.",
    apiKey: "  DeepSeek/OpenAI API key: ",
    apiKeyEmpty: "  Empty key — try again (or Ctrl+C to cancel).",
    apiKeyNote: "  Note: the key is stored in plaintext in the client's JSON config.",
    ok: (name, path) => `  [ok] ${name} -> ${path}`,
    restart: (n) => `\n  Restart ${n > 1 ? "the clients" : "the client"}: codebase_* tools will appear.`,
    promptActive: "  Prompt-only mode active: tools return the prompt to the host model.",
    manual: "\n  Another MCP client? Copy this entry manually:",
    checking: "  Verifying installation...",
    checkOk: (n) => `  [check] server OK — ${n} codebase_* tools available`,
    checkFail: (m) => `  [check] failed: ${m}\n  The client may fail to start the server. Make sure Node.js >= 20 is installed.`,
    cmdOk: (p) => `  [ok] /codebase -> ${p} (tool menu in Claude Code)`,
  },
};

function detectLang() {
  const flagIdx = process.argv.indexOf("--lang");
  const flag = flagIdx >= 0 ? process.argv[flagIdx + 1] : "";
  const raw = flag || process.env.CODEBASE_LANG || process.env.LANG || Intl.DateTimeFormat().resolvedOptions().locale || "";
  return String(raw).toLowerCase().startsWith("en") ? "en" : "fr";
}

// Installs the /codebase slash command (tool menu) into ~/.claude/commands.
// Claude Code only surfaces MCP *prompts* as /mcp__<srv>__<name>; this file
// gives users the short, friendly entry point.
function installClaudeCommands(home, t) {
  const src = join(dirname(fileURLToPath(import.meta.url)), "commands", "codebase.md");
  if (!existsSync(src)) return;
  const dest = join(home, ".claude", "commands", "codebase.md");
  mkdirSync(dirname(dest), { recursive: true });
  if (existsSync(dest)) copyFileSync(dest, `${dest}.bak`);
  copyFileSync(src, dest);
  console.log(t.cmdOk(dest));
}

// Minimal JSON-RPC handshake over stdio: initialize + tools/list. Proves the
// server actually starts — catches broken installs before the IDE does.
async function checkServer(timeoutMs = 20_000) {
  const { spawn } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  // Dev repo: index.mjs sits next to setup.mjs → test the local build.
  // Installed via npx: test exactly what the client will launch.
  const localIndex = join(dirname(fileURLToPath(import.meta.url)), "index.mjs");
  const entry = existsSync(localIndex)
    ? { command: process.execPath, args: [localIndex] }
    : serverEntry();
  const srv = spawn(entry.command, entry.args, { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ...entry.env } });
  let buf = "";
  const pending = new Map();
  srv.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      try {
        const m = JSON.parse(line);
        if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
      } catch { /* non-JSON noise */ }
    }
  });
  const send = (id, method, params) => new Promise((res, rej) => {
    pending.set(id, res);
    srv.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  const timeout = setTimeout(() => { srv.kill(); pending.forEach((r) => r(null)); pending.clear(); }, timeoutMs);
  try {
    const init = await send(1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "setup-check", version: "1" } });
    if (!init?.result) throw new Error("no initialize response");
    srv.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    const tools = await send(2, "tools/list", {});
    const n = tools?.result?.tools?.length ?? 0;
    return { ok: n > 0, tools: n };
  } finally {
    clearTimeout(timeout);
    srv.kill();
  }
}

export async function runSetup() {
  const t = T[detectLang()];
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
  // Mute terminal echo while typing the secret (readline writes input via _writeToOutput).
  const askSecret = async (q) => {
    const orig = rl._writeToOutput?.bind(rl);
    if (orig) rl._writeToOutput = (s) => { if (!s.includes(q)) rl.output.write("*"); };
    try { return await ask(q); }
    finally { if (orig) rl._writeToOutput = orig; }
  };
  const home = homedir();
  const detected = detectClients(home);

  console.log(t.title(PKG));

  if (detected.length === 0) {
    console.log(t.none);
    console.log(JSON.stringify({ mcpServers: { [SERVER_NAME]: serverEntry() } }, null, 2));
    rl.close();
    return;
  }

  console.log(t.detected);
  detected.forEach((c, i) => console.log(`    ${i + 1}. ${c.name}`));
  console.log(t.all);

  let chosen = [];
  while (chosen.length === 0) {
    const pick = (await ask(t.which, "a")).toLowerCase();
    if (pick === "" || pick === "a") { chosen = detected; break; }
    chosen = pick.split(",").map((s) => detected[parseInt(s.trim(), 10) - 1]).filter(Boolean);
    if (chosen.length === 0) console.log(t.invalidPick);
    if (closed) { console.log(t.nothing); rl.close(); return; }
  }

  console.log(t.modeTitle);
  console.log(t.mode1);
  console.log(t.mode2);
  let mode = "";
  while (!["1", "2"].includes(mode)) {
    mode = (await ask(t.choice, "1")) || "1";
    if (!["1", "2"].includes(mode)) console.log(t.invalidMode);
    if (closed) { mode = "1"; break; }
  }

  let apiKey = "";
  if (mode === "2") {
    while (!apiKey) {
      apiKey = await askSecret(t.apiKey);
      process.stdout.write("\n");
      if (!apiKey && !closed) console.log(t.apiKeyEmpty);
      if (closed) break;
    }
    if (apiKey) console.log(t.apiKeyNote);
  }
  const entry = serverEntry(apiKey);

  for (const client of chosen) {
    const path = client.configPath(home, process.cwd());
    const merged = mergeConfig(readJson(path), entry, client.format);
    writeConfig(path, merged);
    console.log(t.ok(client.name, path));
  }

  if (chosen.some((c) => c.id === "claude-code")) installClaudeCommands(home, t);

  console.log(t.restart(chosen.length));
  if (!apiKey) console.log(t.promptActive);

  console.log(t.checking);
  try {
    const check = await checkServer();
    console.log(check.ok ? t.checkOk(check.tools) : t.checkFail("timeout"));
  } catch (e) {
    console.log(t.checkFail(e.message));
  }

  console.log(t.manual);
  console.log(JSON.stringify({ mcpServers: { [SERVER_NAME]: entry } }, null, 2));
  rl.close();
}

// Direct invocation (`node setup.mjs`) also runs the wizard.
if (process.argv[1] && process.argv[1].endsWith("setup.mjs")) {
  if (process.argv.includes("--check")) {
    // Standalone post-install check: handshake + tools/list against the server.
    const t = T[detectLang()];
    console.log(t.checking);
    checkServer()
      .then((r) => { console.log(r.ok ? t.checkOk(r.tools) : t.checkFail("timeout")); process.exit(r.ok ? 0 : 1); })
      .catch((e) => { console.log(t.checkFail(e.message)); process.exit(1); });
  } else {
    runSetup().catch((err) => {
      console.error("setup failed:", err.message);
      process.exit(1);
    });
  }
}
