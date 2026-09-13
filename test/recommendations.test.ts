import { describe, it, expect } from "vitest";
import { recommendations } from "../src/recommendations.js";
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
