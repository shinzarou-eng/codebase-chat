// HTML dashboard renderer — converts the deterministic Markdown report into a
// self-contained, zero-dependency dark dashboard. Shared by the CLI `--ui`
// flag (served on localhost) and the MCP `codebase_deep_audit` ui:// resource.

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

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

  const scoreM = md.match(/[█▓▒░]+\s*(\d+)\/100/);

  return {
    title,
    intro: sections.filter(s => !s.title).flatMap(s => s.html).join('\n'),
    nav: sections.filter(s => s.title).map(s => ({ id: s.id, title: s.title })),
    body: sections.filter(s => s.title).map(s =>
      `<section id="${s.id}"><h2>${esc(s.title)}</h2>${s.html.join('\n')}</section>`).join('\n'),
    score: scoreM ? Number(scoreM[1]) : null,
  };
}

/** Shared dashboard stylesheet. */
export const DASH_CSS = `
:root{--bg:#0b0f14;--card:#11171f;--line:#1f2a37;--txt:#d5dde7;--dim:#8494a7;--acc:#6ec2ff;--ok:#4ade80;--warn:#fbbf24;--bad:#f87171;--code:#a78bfa}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);font:14px/1.6 system-ui,sans-serif}
nav{position:fixed;inset:0 auto 0 0;width:230px;padding:24px 16px;border-right:1px solid var(--line);overflow:auto}
nav b{display:block;color:var(--acc);margin-bottom:14px;font-size:13px;letter-spacing:.05em}
nav a{display:block;color:var(--dim);text-decoration:none;padding:5px 8px;border-radius:6px;font-size:13px}
nav a:hover{background:var(--card);color:var(--txt)}
main{margin-left:230px;max-width:1120px;padding:32px 40px}
header.hero{margin-bottom:28px}
header.hero h1{font-size:22px;margin:0 0 4px}
header.hero .sub{color:var(--dim);font-size:12px}
.score{display:flex;align-items:center;gap:14px;margin:16px 0}
.score .n{font-size:34px;font-weight:700}
.score .bar{flex:1;height:10px;background:var(--line);border-radius:6px;overflow:hidden}
.score .bar i{display:block;height:100%;border-radius:6px;transition:width .6s ease}
section{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px 24px;margin-bottom:18px}
h2{margin:0 0 12px;font-size:16px;color:var(--acc)}
h3{margin:16px 0 8px;font-size:14px;color:var(--txt)}
p{margin:6px 0}ul{margin:6px 0;padding-left:20px}li{margin:3px 0}li.sub{color:var(--dim);font-size:13px;margin-left:14px}
code{font-family:ui-monospace,Consolas,monospace;color:var(--code);background:#1a1425;padding:1px 5px;border-radius:4px;font-size:12.5px}
pre{background:#0d1319;border:1px solid var(--line);border-radius:8px;padding:12px 14px;overflow:auto;font-family:ui-monospace,Consolas,monospace;font-size:12.5px;white-space:pre-wrap}
table{border-collapse:collapse;width:100%;margin:10px 0;font-size:13px}
th{text-align:left;color:var(--dim);font-weight:600;padding:8px 10px;border-bottom:1px solid var(--line)}
td{padding:7px 10px;border-bottom:1px solid #151d27;vertical-align:top}
tr:hover td{background:#131a23}
strong{color:var(--txt)}em{color:var(--dim)}hr{border:none;border-top:1px solid var(--line);margin:14px 0}
a{color:var(--acc)}
@media(max-width:800px){nav{display:none}main{margin:0;padding:18px}}
`;

function scoreHtml(score: number | null): string {
  if (score === null) return '';
  const color = score >= 70 ? 'var(--ok)' : score >= 50 ? 'var(--warn)' : 'var(--bad)';
  return `<div class="score"><span class="n">${score}<small style="font-size:15px;color:var(--dim)">/100</small></span><div class="bar"><i style="width:${score}%;background:${color}"></i></div></div>`;
}

/** Full standalone page — used by `--ui` fallback and the MCP ui:// resource. */
export function reportToHtml(md: string, meta: { project: string; generated: string }): string {
  const r = parseReportMd(md, meta.project);
  const nav = r.nav.map(n => `<a href="#${n.id}">${esc(n.title)}</a>`).join('');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(r.title)}</title><style>${DASH_CSS}body{display:flex}</style></head><body>
<nav><b>◆ ${esc(meta.project)}</b>${nav}</nav>
<main>
<header class="hero"><h1>${esc(r.title)}</h1><div class="sub">${esc(meta.generated)}</div>
${scoreHtml(r.score)}
${r.intro}
</header>
${r.body}
</main></body></html>`;
}
