import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error plain ESM output types may lag
import { analyzeImpact, formatImpactReport } from "../src/index.js";

// Fixture: index → a → b ; x → b ; orphan alone
//   index.ts: import './a'
//   a.ts:     import { f } from './b'
//   x.ts:     import { f } from './b'
//   b.ts:     export function f()
//   orphan.ts: nothing imports it
function makeFixture(dir: string) {
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fix", main: "src/index.ts" }));
  writeFileSync(join(dir, "src", "index.ts"), `import './a';\n`);
  writeFileSync(join(dir, "src", "a.ts"), `import { f } from './b';\nexport const fa = f;\n`);
  writeFileSync(join(dir, "src", "x.ts"), `import { f } from './b';\nexport const fx = f;\n`);
  writeFileSync(join(dir, "src", "b.ts"), `export function f() { return 1; }\nexport const g = 2;\n`);
  writeFileSync(join(dir, "src", "orphan.ts"), `export const lonely = true;\n`);
  writeFileSync(join(dir, "src", "cy1.ts"), `import './cy2';\nexport const c1 = 1;\n`);
  writeFileSync(join(dir, "src", "cy2.ts"), `import './cy1';\nexport const c2 = 1;\n`);
}

describe("analyzeImpact", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "dsh-impact-")); makeFixture(dir); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("computes transitive dependents with depths", async () => {
    const r = await analyzeImpact(dir, "src/b.ts");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const byFile = new Map(r.report.dependents.map(d => [d.file, d.depth]));
    expect(byFile.get("src/a.ts")).toBe(1);
    expect(byFile.get("src/x.ts")).toBe(1);
    expect(byFile.get("src/index.ts")).toBe(2);
    expect(r.report.directCount).toBe(2);
    expect(r.report.target).toBe("src/b.ts");
    expect(r.report.exportedSymbols.map(s => s.name)).toEqual(["f", "g"]);
    expect(r.report.inCycle).toBe(false);
  });

  it("resolves basename queries and reports zero dependents for orphans", async () => {
    const r = await analyzeImpact(dir, "orphan.ts");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.target).toBe("src/orphan.ts");
    expect(r.report.dependents).toEqual([]);
    expect(r.report.risk).toBe("low");
  });

  it("detects cycles — a file in a cycle is flagged", async () => {
    const r = await analyzeImpact(dir, "cy1.ts");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.inCycle).toBe(true);
    expect(r.report.risk).toBe("high");
    expect(r.report.dependents.some(d => d.file === "src/cy2.ts")).toBe(true);
  });

  it("returns candidates/not-found for unknown files", async () => {
    const r = await analyzeImpact(dir, "nope.ts");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.candidates).toEqual([]);
  });

  it("formatImpactReport renders fr + en", async () => {
    const r = await analyzeImpact(dir, "src/b.ts");
    if (!r.ok) throw new Error("expected ok");
    const fr = formatImpactReport(r.report, "fr");
    const en = formatImpactReport(r.report, "en");
    expect(fr).toContain("ANALYSE D’IMPACT");
    expect(fr).toContain("src/b.ts");
    expect(en).toContain("IMPACT ANALYSIS");
    expect(en).toContain("Direct dependents");
  });
});
