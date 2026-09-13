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

/** Shared dashboard stylesheet — dense IDE look (VS Code dark): compact metrics, blue accent, no decoration. */
export const DASH_CSS = `
:root{--bg:#1e1e1e;--card:#252526;--card2:#2d2d30;--line:#3c3c3c;--line2:#505054;--txt:#cccccc;--dim:#9b9b9b;--acc:#007fd4;--acc2:#4aa3f0;--ok:#4ec9b0;--warn:#d7ba7d;--bad:#f14c4c;--code:#d7ba7d}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--txt);font:13px/1.5 "Segoe UI",Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
nav{position:fixed;inset:0 auto 0 0;width:220px;padding:18px 14px;border-right:1px solid var(--line);overflow:auto;background:var(--card);z-index:1}
nav b{display:block;margin-bottom:12px;font-size:12px;letter-spacing:.02em;color:var(--txt);font-weight:600}
nav a{display:block;color:var(--dim);text-decoration:none;padding:4px 8px;border-radius:4px;font-size:12.5px;transition:background .1s}
nav a:hover{background:#ffffff08;color:var(--txt)}
main{margin-left:220px;max-width:1160px;padding:24px 32px;position:relative;z-index:1}
header.hero{margin-bottom:20px}
header.hero h1{font-size:19px;margin:0 0 3px;font-weight:600;letter-spacing:-.015em;color:var(--txt)}
header.hero .sub{color:var(--dim);font-size:12px}
.score{display:flex;align-items:center;gap:18px;margin:10px 0}
section{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:14px 18px;margin-bottom:10px;position:relative}
h2{margin:0 0 10px;font-size:12px;color:var(--txt);font-weight:600;letter-spacing:.05em;text-transform:uppercase}
h2.coll{cursor:pointer;user-select:none;display:flex;align-items:center;gap:8px;margin-bottom:0}
h2.coll::before{content:'▾';font-size:10px;color:var(--acc2);transition:transform .15s}
section.collapsed h2.coll::before{transform:rotate(-90deg)}
section.collapsed .sbody{display:none}
section:not(.collapsed) .sbody{margin-top:12px}
.sbody{overflow-x:auto}
h3{margin:14px 0 6px;font-size:12px;color:var(--txt);font-weight:600;letter-spacing:.02em}
p{margin:5px 0}ul{margin:5px 0;padding-left:18px}li{margin:3px 0}li::marker{color:#5a5a5a}li.sub{color:var(--dim);font-size:12.5px;margin-left:12px}
code{font-family:"Cascadia Code","SF Mono",Consolas,ui-monospace,monospace;color:var(--code);background:rgba(255,255,255,.07);padding:0 5px;border-radius:3px;font-size:12px}
pre{background:#1b1b1c;border:1px solid var(--line);border-radius:4px;padding:10px 14px;overflow:auto;font-family:"Cascadia Code",Consolas,ui-monospace,monospace;font-size:12px;white-space:pre-wrap}
table{border-collapse:collapse;width:100%;margin:8px 0;font-size:12.5px}
th{text-align:left;color:var(--dim);font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:.07em;padding:5px 10px;border-bottom:1px solid var(--line)}
td{padding:5px 10px;border-bottom:1px solid rgba(255,255,255,.05);vertical-align:top}
tr:last-child td{border-bottom:none}
tr:hover td{background:rgba(255,255,255,.03)}
strong{color:var(--txt)}em{color:var(--dim)}hr{border:none;border-top:1px solid var(--line);margin:10px 0}
a{color:var(--acc2);text-decoration:none}
a:hover{text-decoration:underline}
.sev{display:inline-block;font-size:10.5px;font-weight:600;letter-spacing:.02em;padding:1px 7px;border-radius:3px;vertical-align:middle}
.sev-crit{background:rgba(241,76,76,.16);color:#f48771}
.sev-high{background:rgba(215,186,125,.15);color:#e5cf9e}
.sev-med{background:rgba(215,186,125,.11);color:#d7ba7d}
.sev-info{background:rgba(0,127,212,.2);color:#6cb6ee}
.sev-ok{background:rgba(78,201,176,.14);color:#73d6c0}
.mb{display:inline-flex;align-items:center;gap:10px;vertical-align:middle}
.mb i{display:inline-block;width:110px;height:4px;background:rgba(255,255,255,.08);border-radius:3px;overflow:hidden}
.mb u{display:block;height:100%;background:linear-gradient(90deg,#f14c4c,#d7ba7d,#4ec9b0);border-radius:3px}
.mb b{font-size:12.5px;font-weight:600}
.donut .bg{fill:none;stroke:#3c3c3c;stroke-width:8}
.donut .fg{fill:none;stroke-width:8;stroke-linecap:round;transition:stroke-dasharray 1s ease}
html{scroll-behavior:smooth}
::selection{background:rgba(0,127,212,.4)}
::-webkit-scrollbar{width:10px;height:10px}
::-webkit-scrollbar-thumb{background:#424242;border-radius:5px;border:2px solid var(--bg)}
::-webkit-scrollbar-thumb:hover{background:#4f4f4f}
::-webkit-scrollbar-track{background:transparent}
@media(max-width:800px){nav{display:none}main{margin:0;padding:14px}}
`;

export function scoreGauge(score: number | null, grade: string | null = null): string {
  if (score === null) return '';
  const color = score >= 70 ? '#4ec9b0' : score >= 50 ? '#d7ba7d' : '#f14c4c';
  const circ = 2 * Math.PI * 52;
  return `<div class="score"><svg class="donut" width="96" height="96" viewBox="0 0 120 120">
<circle class="bg" cx="60" cy="60" r="52"/>
<circle class="fg" cx="60" cy="60" r="52" stroke="${color}" stroke-dasharray="${(score / 100 * circ).toFixed(1)} ${circ.toFixed(1)}" transform="rotate(-90 60 60)"/>
<text x="60" y="58" text-anchor="middle" dominant-baseline="middle" fill="${color}" font-size="30" font-weight="650">${score}</text>
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
