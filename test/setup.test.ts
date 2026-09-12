import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error plain ESM module without type declarations
import { mergeConfig, serverEntry, detectClients, writeConfig, readJson } from "../mcp/setup.mjs";

describe("setup wizard", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "dsh-setup-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("mergeConfig adds server under mcpServers without touching others", () => {
    const existing = { mcpServers: { other: { command: "foo" } }, theme: "dark" };
    const out = mergeConfig(existing, { command: "npx", args: ["-y", "dsh-codebase-chat-mcp"] }, "mcpServers");
    expect(out.mcpServers["dsh-codebase-chat"].command).toBe("npx");
    expect(out.mcpServers.other.command).toBe("foo");
    expect(out.theme).toBe("dark");
  });

  it("mergeConfig handles missing/empty config", () => {
    const out = mergeConfig(null, { command: "npx" }, "mcpServers");
    expect(out.mcpServers["dsh-codebase-chat"]).toEqual({ command: "npx" });
  });

  it("mergeConfig vscode format uses servers + stdio type", () => {
    const out = mergeConfig({}, { command: "npx" }, "vscodeServers");
    expect(out.servers["dsh-codebase-chat"].type).toBe("stdio");
    expect(out.servers["dsh-codebase-chat"].command).toBe("npx");
  });

  it("mergeConfig zed format uses context_servers with command.path/args/env", () => {
    const out = mergeConfig(
      { context_servers: { other: { command: { path: "x" } } } },
      { command: "npx", args: ["-y", "pkg"], env: { CODEBASE_LOCAL_LLM: "1" } },
      "zedContextServers"
    );
    expect(out.context_servers["dsh-codebase-chat"].command.path).toBe("npx");
    expect(out.context_servers["dsh-codebase-chat"].command.env).toEqual({ CODEBASE_LOCAL_LLM: "1" });
    expect(out.context_servers.other.command.path).toBe("x");
  });

  it("serverEntry omits env when no api key, sets DEEPSEEK_API_KEY when given", () => {
    expect(serverEntry().env).toBeUndefined();
    expect(serverEntry("sk-x").env).toEqual({ DEEPSEEK_API_KEY: "sk-x" });
  });

  it("serverEntry sets CODEBASE_LOCAL_LLM for local mode", () => {
    expect(serverEntry("", true).env).toEqual({ CODEBASE_LOCAL_LLM: "1" });
    expect(serverEntry("sk-x", true).env).toEqual({ DEEPSEEK_API_KEY: "sk-x", CODEBASE_LOCAL_LLM: "1" });
  });

  it("detectClients finds cursor when ~/.cursor exists", () => {
    mkdirSync(join(dir, ".cursor"));
    const ids = detectClients(dir).map((c: { id: string }) => c.id);
    expect(ids).toContain("cursor");
    expect(ids).not.toContain("claude");
  });

  it("writeConfig creates dirs, writes json, backs up existing file", () => {
    const p = join(dir, "sub", "mcp.json");
    writeConfig(p, { mcpServers: { a: 1 } });
    expect(readJson(p)).toEqual({ mcpServers: { a: 1 } });
    writeConfig(p, { mcpServers: { a: 2 } });
    expect(existsSync(`${p}.bak`)).toBe(true);
    expect(JSON.parse(readFileSync(`${p}.bak`, "utf8"))).toEqual({ mcpServers: { a: 1 } });
  });
});
