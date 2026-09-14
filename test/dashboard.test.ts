import { describe, it, expect, afterAll } from "vitest";
import type { Server } from "node:http";
import { startDashboard } from "../src/dashboard.js";
import { makeRepo } from "./helpers.js";

const repo = makeRepo({
  "src/a.ts": "export const x = 1;\nexport function f(): number { return x; }\n",
  "src/b.ts": "import { x } from './a.js';\nexport const y = x + 1;\n",
});

let server: Server;
let base = "";

describe("dashboard server", () => {
  it("serves the app shell and the JSON API", async () => {
    ({ url: base, server } = await startDashboard(repo.dir, "en"));

    const home = await fetch(base + "/").then(r => r.text());
    expect(home).toContain("<!doctype html>");
    expect(home).toContain("codebase-chat");

    const audit = await fetch(base + "/api/audit?lang=en").then(r => r.json());
    expect(audit.md).toContain("Deterministic report");
    expect(audit.body).toContain("<section");
    expect(audit.nav.length).toBeGreaterThan(0);
    // server-rendered body escapes user content
    expect(audit.body).not.toContain("<img");

    const files = await fetch(base + "/api/files?x=1").then(r => r.json());
    expect(files.files).toContain("src/a.ts");

    const stats = await fetch(base + "/api/stats?lang=en").then(r => r.json());
    expect(stats.body).toContain("Tokens per model family");

    const changed = await fetch(base + "/api/changed?x=1").then(r => r.json());
    expect(changed).toHaveProperty("ok");

    const prompt = await fetch(base + "/api/prompt?mode=search&q=a.ts&lang=en").then(r => r.json());
    expect(prompt.prompt).toContain("src/a.ts");
  }, 30000);

  it("injects the project path escaped into attributes", async () => {
    const home = await fetch(base + "/?lang=en").then(r => r.text());
    const input = home.match(/<input[^>]*id="proj"[^>]*>/)?.[0] ?? "";
    // the path lands in a single well-formed value="…" attribute
    expect(input.match(/value="[^"]*"/)?.[0]).toBe(`value="${repo.dir.replace(/&/g, "&amp;")}"`);
  });

  afterAll(() => { server?.close(); repo.cleanup(); });
});
