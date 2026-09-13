import { describe, it, expect } from "vitest";
import { recommendations } from "../src/recommendations.js";
import { scanCode } from "../src/report.js";
import type { HealthReport } from "../src/analysis.js";

const healthy: HealthReport = {
  projectPath: "/p",
  analyzedFiles: 3,
  importEdges: 2,
  cycles: [],
  unusedFiles: [],
  unusedExports: [],
  duplicates: [],
  hotspots: [],
  score: 90,
  grade: "A",
};

const noExtras = {
  sensitive: [], envUndoc: [], deadDeps: [], tsStrict: null,
  untestedRisk: [], brokenEntries: [], deepRel: 0, deepNest: [],
  commitConv: null, missingDeps: [], lockDrift: [],
};

const call = (over: Partial<HealthReport> = {}, extras = noExtras, lang: "fr" | "en" = "en", hasTests = true, infra = ["CI (GitHub Actions)"]) =>
  recommendations({ ...healthy, ...over }, hasTests, {}, {}, null, infra, [], extras, lang);

describe("recommendations", () => {
  it("returns the fallback when nothing is wrong", () => {
    const recos = call();
    expect(recos).toHaveLength(1);
    expect(recos[0].text).toMatch(/Nothing structural/);
  });

  it("flags missing deps and cycles as Critique", () => {
    const recos = call(
      { cycles: [{ path: ["a.ts", "b.ts"], files: ["a.ts", "b.ts"], size: 2 } as any] },
      { ...noExtras, missingDeps: ["lodash"] },
    );
    const crits = recos.filter(r => r.severity === "Critique");
    expect(crits.some(r => r.text.includes("lodash"))).toBe(true);
    expect(crits.some(r => r.text.includes("a.ts"))).toBe(true);
  });

  it("warns when no CI and no tests are detected", () => {
    const recos = call({}, noExtras, "en", false, []);
    expect(recos.some(r => r.text.includes("CI"))).toBe(true);
    expect(recos.some(r => r.text.includes("test suite"))).toBe(true);
  });

  it("uses uncapped totals for the sink count when secTotals is provided", () => {
    const sec = { innerHTML: [
      { file: "a.ts", line: 1, sample: "el.innerHTML = x" },
      { file: "a.ts", line: 2, sample: "el.innerHTML = y" },
    ] };
    const recos = recommendations(healthy, true, {}, sec, null, ["CI"], [],
      { ...noExtras, secTotals: { innerHTML: 7 } }, "en");
    const sink = recos.find(r => r.text.includes("innerHTML"));
    expect(sink?.text).toContain("7");
    expect(sink?.text).toContain("across 1 file");
    expect(sink?.severity).toBe("Moyenne");
  });

  it("rates sinks Élevée when eval/exec are present, Moyenne for innerHTML only", () => {
    const ih = { innerHTML: [{ file: "a.ts", line: 1, sample: "el.innerHTML = x" }] };
    const ev = { eval: [{ file: "b.ts", line: 3, sample: "eval(x)" }] };
    const onlyMarkup = recommendations(healthy, true, {}, ih, null, ["CI"], [], noExtras, "en");
    expect(onlyMarkup.find(r => r.text.includes("innerHTML"))?.severity).toBe("Moyenne");
    const withEval = recommendations(healthy, true, {}, ev, null, ["CI"], [], noExtras, "en");
    expect(withEval.find(r => r.text.includes("eval"))?.severity).toBe("Élevée");
  });

  it("scanCode keeps counting totals beyond the per-file sample cap", () => {
    const fileTexts = new Map([["app.ts", Array.from({ length: 8 }, (_, i) => `el${i}.innerHTML = v${i};`).join("\n")]]);
    const totals: Record<string, number> = {};
    const scan = scanCode(fileTexts, [["innerHTML", /\.innerHTML\s*=/]], 5, { totals });
    expect(scan.innerHTML).toHaveLength(5);
    expect(totals.innerHTML).toBe(8);
  });

  it("renders French when lang=fr", () => {
    const fallback = recommendations(healthy, true, {}, {}, null, ["CI"], [], noExtras, "fr");
    expect(fallback[0].text).toMatch(/Rien de structurel/);
    const recos = recommendations(
      { ...healthy, hotspots: [{ file: "big.ts", startLine: 1, score: 42 }] },
      true, {}, {}, null, ["CI"], [], noExtras, "fr",
    );
    expect(recos.some(r => r.text.includes("Découper `big.ts`"))).toBe(true);
  });
});
