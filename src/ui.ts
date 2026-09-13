// HTML dashboard renderer — converts the deterministic Markdown report into a
// self-contained, zero-dependency dark dashboard. Shared by the CLI `--ui`
// flag (served on localhost) and the MCP `codebase_deep_audit` ui:// resource.

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function inline(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/_([^_]+)_/g, '<em>$1</em>');
}

interface Section { id: string; title: string; html: string[]; }

export interface ParsedReport {
  title: string;
  intro: string;
  nav: { id: string; title: string }[];
  body: string;
  score: number | null;
  grade: string | null;
}

const SEV: Record<string, string> = { '🔴': 'crit', '🟠': 'high', '🟡': 'med', '🔵': 'info' };

/** Strip a leading emoji — gradient-clipped titles render emoji as blank boxes. */
const stripEmoji = (s: string) => s.replace(/^\p{Extended_Pictographic}\s*/u, '');

/** Remove every emoji/pictograph — Fluent-style clean text rendering. */
const EMOJI_RE = /\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*\uFE0F?/gu;
const stripAllEmoji = (s: string) => s.replace(EMOJI_RE, '');

/** Turn "🔴 Critique" severity markers and ASCII score bars into styled HTML. */
function severity(html: string): string {
  return html
    .replace(/(🔴|🟠|🟡|🔵)\s*(Critique|Critical|Haute|High|Moyenne|Medium|Basse|Low|Info)?/g,
      (_m, dot: string, word?: string) =>
        `<span class="sev sev-${SEV[dot] ?? 'info'}">${word ? esc(word) : ''}</span>`)
    .replace(/[█▓▒░]+\s*(\d+)\/100/g,
      (_m, n: string) => `<span class="mb"><i><u style="width:${n}%"></u></i><b>${n}/100</b></span>`);
}

/** Deterministic Markdown → structured HTML fragments (nav, intro, section cards). */
export function parseReportMd(md: string, fallbackTitle = 'Report'): ParsedReport {
  const lines = md.split('\n');
  const sections: Section[] = [];
  let cur: Section | null = null;
  let inCode = false, codeBuf: string[] = [];
  let inTable = false, tableRows: string[][] = [];
  let title = fallbackTitle;

  const flushTable = () => {
    if (!cur || !tableRows.length) { inTable = false; tableRows = []; return; }
    const rows = tableRows.filter(r => !r.every(c => /^:?-+:?$/.test(c)));
    if (!rows.length) { inTable = false; tableRows = []; return; }
    const [head, ...body] = rows;
    cur.html.push('<table><thead><tr>' + head.map(c => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>'
      + body.map(r => '<tr>' + r.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table>');
    inTable = false; tableRows = [];
  };
  const flushCode = () => {
    if (cur && codeBuf.length) cur.html.push(`<pre>${esc(codeBuf.join('\n'))}</pre>`);
    inCode = false; codeBuf = [];
  };

  for (const raw of lines) {
    const line = raw;
    if (line.trim().startsWith('```')) { inCode ? flushCode() : (inCode = true, codeBuf = []); continue; }
    if (inCode) { codeBuf.push(line); continue; }
    if (/^\|.*\|$/.test(line.trim())) {
      if (!inTable) { inTable = true; tableRows = []; }
      tableRows.push(line.trim().slice(1, -1).split('|').map(c => c.trim()));
      continue;
    }
    if (inTable) flushTable();

    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) {
      const lvl = h[1].length;
      if (lvl === 1) { title = h[2].replace(/`/g, ''); continue; }
      if (lvl === 2) {
        cur = { id: `s${sections.length}`, title: h[2].replace(/`/g, ''), html: [] };
        sections.push(cur);
        continue;
      }
      if (cur) cur.html.push(`<h3>${inline(h[2])}</h3>`);
      continue;
    }
    if (!cur) {
      if (line.trim()) { cur = { id: 's0', title: '', html: [] }; sections.push(cur); }
      else continue;
    }
    if (/^\s*-\s/.test(line)) {
      const indent = raw.match(/^\s*/)?.[0].length ?? 0;
      const cls = indent > 1 ? ' class="sub"' : '';
      cur.html.push(`<li${cls}>${inline(line.trim().slice(2))}</li>`);
      continue;
    }
    if (!line.trim()) continue;
    if (line.trim() === '---') { cur.html.push('<hr>'); continue; }
    cur.html.push(`<p>${inline(line)}</p>`);
  }
  flushTable(); flushCode();

  // Wrap consecutive <li> in <ul>
  for (const s of sections) {
    const out: string[] = [];
    let openUl = false;
    for (const h of s.html) {
      const isLi = h.startsWith('<li');
      if (isLi && !openUl) { out.push('<ul>'); openUl = true; }
      if (!isLi && openUl) { out.push('</ul>'); openUl = false; }
      out.push(h);
    }
    if (openUl) out.push('</ul>');
    s.html = out;
  }

  const scoreM = md.match(/[█▓▒░]+\s*(\d+)\/100(?:\s*\(([A-F])\))?/);

  const clean = (h: string) => stripAllEmoji(severity(h));
  return {
    title,
    intro: clean(sections.filter(s => !s.title).flatMap(s => s.html).join('\n')),
    nav: sections.filter(s => s.title).map(s => ({ id: s.id, title: stripAllEmoji(s.title).trim() })),
    body: sections.filter(s => s.title).map(s =>
      `<section id="${s.id}"><h2 class="coll">${esc(stripAllEmoji(s.title).trim())}</h2><div class="sbody">${clean(s.html.join('\n'))}</div></section>`).join('\n'),
    score: scoreM ? Number(scoreM[1]) : null,
    grade: scoreM?.[2] ?? null,
  };
}

/** Shared dashboard stylesheet — violet "Linear-grade" dark theme. */
export const DASH_CSS = `
:root{--bg:#1f1f1f;--card:#2b2b2b;--card2:#333333;--line:#ffffff14;--line2:#ffffff24;--txt:#f0f0f0;--dim:#a3a3a3;--acc:#4cc2ff;--acc2:#8fd3ff;--ok:#6ccb5f;--warn:#fce100;--bad:#ff99a4;--code:#9cdcfe}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--txt);font:14px/1.6 "Segoe UI Variable","Segoe UI",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
nav{position:fixed;inset:0 auto 0 0;width:230px;padding:24px 16px;border-right:1px solid var(--line);overflow:auto;background:#1b1b1b}
nav b{display:block;color:var(--acc);margin-bottom:14px;font-size:13px;letter-spacing:.04em}
nav a{display:block;color:var(--dim);text-decoration:none;padding:5px 9px;border-radius:6px;font-size:13px;transition:background .1s}
nav a:hover{background:#ffffff0d;color:var(--txt)}
main{margin-left:230px;max-width:1120px;padding:32px 40px}
header.hero{margin-bottom:28px}
header.hero h1{font-size:24px;margin:0 0 4px;font-weight:600;letter-spacing:-.01em}
header.hero .sub{color:var(--dim);font-size:12px}
.score{display:flex;align-items:center;gap:20px;margin:14px 0}
section{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:22px 26px;margin-bottom:14px;box-shadow:0 2px 8px rgba(0,0,0,.2)}
section:hover{border-color:var(--line2)}
h2{margin:0 0 12px;font-size:15px;color:var(--txt);font-weight:600}
h2.coll{cursor:pointer;user-select:none;display:flex;align-items:center;gap:9px;margin-bottom:0}
h2.coll::before{content:'▾';font-size:11px;color:var(--dim);transition:transform .15s}
section.collapsed h2.coll::before{transform:rotate(-90deg)}
section.collapsed .sbody{display:none}
section:not(.collapsed) .sbody{margin-top:14px}
.sbody{overflow-x:auto}
h3{margin:16px 0 8px;font-size:14px;color:var(--txt);font-weight:600}
p{margin:7px 0}ul{margin:7px 0;padding-left:20px}li{margin:4px 0}li::marker{color:var(--dim)}li.sub{color:var(--dim);font-size:13px;margin-left:14px}
code{font-family:"Cascadia Code",Consolas,ui-monospace,monospace;color:var(--code);background:#ffffff0f;padding:1px 6px;border-radius:4px;font-size:12.5px}
pre{background:#1a1a1a;border:1px solid var(--line);border-radius:8px;padding:14px 16px;overflow:auto;font-family:"Cascadia Code",Consolas,ui-monospace,monospace;font-size:12.5px;white-space:pre-wrap}
table{border-collapse:collapse;width:100%;margin:12px 0;font-size:13px}
th{text-align:left;color:var(--dim);font-weight:600;font-size:11.5px;padding:9px 12px;border-bottom:1px solid var(--line)}
td{padding:9px 12px;border-bottom:1px solid #ffffff09;vertical-align:top}
tr:last-child td{border-bottom:none}
tr:hover td{background:#ffffff08}
strong{color:var(--txt)}em{color:var(--dim)}hr{border:none;border-top:1px solid var(--line);margin:14px 0}
a{color:var(--acc)}
.sev{display:inline-block;font-size:11px;font-weight:600;letter-spacing:.03em;padding:2px 9px;border-radius:4px;vertical-align:middle}
.sev-crit{background:rgba(255,153,164,.15);color:var(--bad)}
.sev-high{background:rgba(255,185,140,.14);color:#ffb98c}
.sev-med{background:rgba(252,225,0,.12);color:var(--warn)}
.sev-info{background:rgba(76,194,255,.13);color:var(--acc)}
.sev-ok{background:rgba(108,203,95,.14);color:var(--ok)}
.mb{display:inline-flex;align-items:center;gap:10px;vertical-align:middle}
.mb i{display:inline-block;width:120px;height:6px;background:#ffffff12;border-radius:4px;overflow:hidden}
.mb u{display:block;height:100%;background:linear-gradient(90deg,#ff99a4,#fce100,#6ccb5f);border-radius:4px}
.mb b{font-size:13px;font-weight:600}
.donut .bg{fill:none;stroke:#ffffff12;stroke-width:10}
.donut .fg{fill:none;stroke-width:10;stroke-linecap:round;transition:stroke-dasharray 1s ease}
html{scroll-behavior:smooth}
::-webkit-scrollbar{width:10px;height:10px}
::-webkit-scrollbar-thumb{background:#ffffff1a;border-radius:6px;border:2px solid var(--bg)}
::-webkit-scrollbar-thumb:hover{background:#ffffff2e}
::-webkit-scrollbar-track{background:transparent}
@media(max-width:800px){nav{display:none}main{margin:0;padding:18px}}
`;

export function scoreGauge(score: number | null, grade: string | null = null): string {
  if (score === null) return '';
  const color = score >= 70 ? '#6ccb5f' : score >= 50 ? '#fce100' : '#ff99a4';
  const circ = 2 * Math.PI * 52;
  return `<div class="score"><svg class="donut" width="120" height="120" viewBox="0 0 120 120">
<circle class="bg" cx="60" cy="60" r="52"/>
<circle class="fg" cx="60" cy="60" r="52" stroke="${color}" stroke-dasharray="${(score / 100 * circ).toFixed(1)} ${circ.toFixed(1)}" transform="rotate(-90 60 60)"/>
<text x="60" y="58" text-anchor="middle" dominant-baseline="middle" fill="${color}" font-size="30" font-weight="600">${score}</text>
${grade ? `<text x="60" y="84" text-anchor="middle" fill="var(--dim)" font-size="13">${grade}</text>` : ''}
</svg></div>`;
}

/** Full standalone page — used by `--ui` fallback and the MCP ui:// resource. */
export function reportToHtml(md: string, meta: { project: string; generated: string }): string {
  const r = parseReportMd(md, meta.project);
  const nav = r.nav.map(n => `<a href="#${n.id}">${esc(n.title)}</a>`).join('');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(r.title)}</title><style>${DASH_CSS}body{display:flex}</style></head><body>
<nav><b>◆ ${esc(meta.project)}</b>${nav}</nav>
<main>
<header class="hero"><h1>${esc(stripEmoji(r.title))}</h1><div class="sub">${esc(meta.generated)}</div>
${scoreGauge(r.score, r.grade)}
${r.intro}
</header>
${r.body}
</main></body></html>`;
}
