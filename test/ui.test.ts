import { describe, it, expect } from "vitest";
import { parseReportMd, reportToHtml, scoreGauge } from "../src/ui.js";

describe("parseReportMd", () => {
  it("escapes HTML in report samples — no XSS through file content", () => {
    const md = [
      "# 📊 Rapport — `proj`",
      "",
      "## 1. Dette & smells",
      "- **`any` types** — 1 hit",
      "  - `src/a.ts:1` — el.innerHTML = `<img src=x onerror=alert(1)>`;",
      "",
      "## 2. Sécu",
      "- **innerHTML** — 1",
      "  - `src/b.ts:2` — <script>alert('x')</script>",
    ].join("\n");
    const r = parseReportMd(md);
    expect(r.body).not.toContain("<img");
    expect(r.body).not.toContain("<script>");
    expect(r.body).toContain("&lt;img");
    expect(r.body).toContain("&lt;script&gt;");
  });

  it("splits ## sections into nav + section cards", () => {
    const md = "# T — `p`\n\nintro text\n\n## 1. Alpha\n- a\n\n## 2. Beta\n- b\n";
    const r = parseReportMd(md);
    expect(r.title).toBe("T — p");
    expect(r.nav.map(n => n.title)).toEqual(["1. Alpha", "2. Beta"]);
    expect(r.body).toContain('<section id="s1"');
    expect(r.body).toContain('<section id="s2"');
    expect(r.intro).toContain("intro text");
  });

  it("parses score + grade from the bar line", () => {
    const md = "# T\n**███████░░░ 70/100 (C)** — verdict\n\n## S\n- x\n";
    const r = parseReportMd(md);
    expect(r.score).toBe(70);
    expect(r.grade).toBe("C");
  });

  it("renders tables and code blocks escaped", () => {
    const md = "# T\n\n## S\n| a | b |\n|---|---|\n| <x> | `y` |\n\n```\n<div>z</div>\n```\n";
    const r = parseReportMd(md);
    expect(r.body).toContain("<table>");
    expect(r.body).toContain("&lt;x&gt;");
    expect(r.body).toContain("<pre>&lt;div&gt;");
  });
});

describe("reportToHtml", () => {
  it("produces a self-contained page with nav and escaped title", () => {
    const html = reportToHtml("# T — `p`\n\n## S\n- x\n", { project: 'my"<proj>', generated: "2026-09-13" });
    expect(html).toContain("<!doctype html>");
    expect(html).not.toContain('my"<proj>');
    expect(html).toContain("my&quot;&lt;proj&gt;");
    expect(html).toContain('href="#s0"');
  });
});

describe("scoreGauge", () => {
  it("returns empty for null score, donut otherwise", () => {
    expect(scoreGauge(null)).toBe("");
    const g = scoreGauge(85, "B");
    expect(g).toContain("donut");
    expect(g).toContain(">85<");
    expect(g).toContain(">B<");
  });
});
