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

/** Shared dashboard stylesheet — premium "Linear-grade" dark theme. */
export const DASH_CSS = `
:root{--bg:#0b0b10;--card:#131318;--card2:#17171f;--line:#ffffff0d;--line2:#ffffff1f;--txt:#ececf1;--dim:#8b8b96;--acc:#8b7cf6;--acc2:#b3a5ff;--ok:#4ade80;--warn:#facc15;--bad:#fb7185;--code:#a5b4fc}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--txt);font:14px/1.6 "Segoe UI Variable","Segoe UI",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
body::before{content:'';position:fixed;inset:0;pointer-events:none;z-index:0;background:radial-gradient(1000px 500px at 70% -10%,rgba(139,124,246,.09),transparent 60%),radial-gradient(800px 400px at 0% 110%,rgba(139,124,246,.05),transparent 60%)}
nav{position:fixed;inset:0 auto 0 0;width:230px;padding:24px 16px;border-right:1px solid var(--line);overflow:auto;background:rgba(13,13,19,.85);backdrop-filter:blur(12px);z-index:1}
nav b{display:block;margin-bottom:14px;font-size:13px;letter-spacing:.04em;background:linear-gradient(90deg,var(--acc),var(--acc2));-webkit-background-clip:text;background-clip:text;color:transparent}
nav a{display:block;color:var(--dim);text-decoration:none;padding:5px 9px;border-radius:6px;font-size:13px;transition:background .1s}
nav a:hover{background:#ffffff08;color:var(--txt)}
main{margin-left:230px;max-width:1120px;padding:32px 40px;position:relative;z-index:1}
header.hero{margin-bottom:28px}
header.hero h1{font-size:26px;margin:0 0 4px;font-weight:650;letter-spacing:-.02em;background:linear-gradient(180deg,#fff,#b9b9c9);-webkit-background-clip:text;background-clip:text;color:transparent}
header.hero .sub{color:var(--dim);font-size:12px}
.score{display:flex;align-items:center;gap:20px;margin:14px 0}
section{background:linear-gradient(180deg,#15151c,#121218);border:1px solid var(--line);border-radius:14px;padding:22px 26px;margin-bottom:16px;box-shadow:0 1px 0 rgba(255,255,255,.03) inset,0 8px 24px rgba(0,0,0,.35);position:relative}
section::before{content:'';position:absolute;top:0;left:24px;right:24px;height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.08),transparent);pointer-events:none}
section:hover{border-color:var(--line2)}
h2{margin:0 0 12px;font-size:15px;color:var(--txt);font-weight:600;letter-spacing:-.01em}
h2.coll{cursor:pointer;user-select:none;display:flex;align-items:center;gap:9px;margin-bottom:0}
h2.coll::before{content:'▾';font-size:11px;color:var(--dim);transition:transform .15s}
section.collapsed h2.coll::before{transform:rotate(-90deg)}
section.collapsed .sbody{display:none}
section:not(.collapsed) .sbody{margin-top:14px}
.sbody{overflow-x:auto}
h3{margin:16px 0 8px;font-size:14px;color:var(--txt);font-weight:600;letter-spacing:-.005em}
p{margin:7px 0}ul{margin:7px 0;padding-left:20px}li{margin:4px 0}li::marker{color:var(--acc)}li.sub{color:var(--dim);font-size:13px;margin-left:14px}
code{font-family:"Cascadia Code",Consolas,ui-monospace,monospace;color:var(--code);background:rgba(139,124,246,.08);border:1px solid rgba(139,124,246,.12);padding:1px 6px;border-radius:5px;font-size:12.5px}
pre{background:#0d0d13;border:1px solid var(--line);border-radius:10px;padding:14px 16px;overflow:auto;font-family:"Cascadia Code",Consolas,ui-monospace,monospace;font-size:12.5px;white-space:pre-wrap}
table{border-collapse:collapse;width:100%;margin:12px 0;font-size:13px}
th{text-align:left;color:var(--dim);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.05em;padding:9px 12px;border-bottom:1px solid var(--line)}
td{padding:9px 12px;border-bottom:1px solid #ffffff06;vertical-align:top}
tr:last-child td{border-bottom:none}
tr:hover td{background:#ffffff05}
strong{color:var(--txt)}em{color:var(--dim)}hr{border:none;border-top:1px solid var(--line);margin:14px 0}
a{color:var(--acc2)}
.sev{display:inline-block;font-size:10.5px;font-weight:650;letter-spacing:.04em;text-transform:uppercase;padding:2px 9px;border-radius:20px;vertical-align:middle}
.sev-crit{background:rgba(251,113,133,.13);color:var(--bad)}
.sev-high{background:rgba(251,146,60,.12);color:#fdba74}
.sev-med{background:rgba(250,204,21,.1);color:var(--warn)}
.sev-info{background:rgba(139,124,246,.14);color:var(--acc2)}
.sev-ok{background:rgba(74,222,128,.12);color:var(--ok)}
.mb{display:inline-flex;align-items:center;gap:10px;vertical-align:middle}
.mb i{display:inline-block;width:120px;height:5px;background:#ffffff10;border-radius:4px;overflow:hidden}
.mb u{display:block;height:100%;background:linear-gradient(90deg,#fb7185,#facc15,#4ade80);border-radius:4px}
.mb b{font-size:13px;font-weight:600}
.donut .bg{fill:none;stroke:#ffffff0d;stroke-width:9}
.donut .fg{fill:none;stroke-width:9;stroke-linecap:round;transition:stroke-dasharray 1s ease;filter:drop-shadow(0 0 6px rgba(139,124,246,.25))}
html{scroll-behavior:smooth}
::selection{background:rgba(139,124,246,.3)}
::-webkit-scrollbar{width:10px;height:10px}
::-webkit-scrollbar-thumb{background:#ffffff14;border-radius:6px;border:2px solid var(--bg)}
::-webkit-scrollbar-thumb:hover{background:#ffffff26}
::-webkit-scrollbar-track{background:transparent}
@media(max-width:800px){nav{display:none}main{margin:0;padding:18px}}
`;

export function scoreGauge(score: number | null, grade: string | null = null): string {
  if (score === null) return '';
  const color = score >= 70 ? '#4ade80' : score >= 50 ? '#facc15' : '#fb7185';
  const circ = 2 * Math.PI * 52;
  return `<div class="score"><svg class="donut" width="120" height="120" viewBox="0 0 120 120">
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
