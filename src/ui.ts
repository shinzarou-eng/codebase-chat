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

/** Minimal deterministic Markdown → HTML for our report shape. */
export function reportToHtml(md: string, meta: { project: string; generated: string }): string {
  const lines = md.split('\n');
  const sections: Section[] = [];
  let cur: Section | null = null;
  let inCode = false, codeBuf: string[] = [];
  let inTable = false, tableRows: string[][] = [];
  let title = meta.project;

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
      const cells = line.trim().slice(1, -1).split('|').map(c => c.trim());
      tableRows.push(cells);
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
  const score = scoreM ? Number(scoreM[1]) : null;

  const intro = sections.filter(s => !s.title).flatMap(s => s.html).join('\n');
  const nav = sections.filter(s => s.title).map(s => `<a href="#${s.id}">${esc(s.title)}</a>`).join('');
  const body = sections.filter(s => s.title).map(s =>
    `<section id="${s.id}"><h2>${esc(s.title)}</h2>${s.html.join('\n')}</section>`).join('\n');

  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>
:root{--bg:#0b0f14;--card:#11171f;--line:#1f2a37;--txt:#d5dde7;--dim:#8494a7;--acc:#6ec2ff;--ok:#4ade80;--warn:#fbbf24;--bad:#f87171;--code:#a78bfa}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);font:14px/1.6 system-ui,sans-serif;display:flex}
nav{position:fixed;inset:0 auto 0 0;width:230px;padding:24px 16px;border-right:1px solid var(--line);overflow:auto}
nav b{display:block;color:var(--acc);margin-bottom:14px;font-size:13px;letter-spacing:.05em}
nav a{display:block;color:var(--dim);text-decoration:none;padding:5px 8px;border-radius:6px;font-size:13px}
nav a:hover{background:var(--card);color:var(--txt)}
main{margin-left:230px;max-width:1120px;padding:32px 40px;width:100%}
header.hero{margin-bottom:28px}
header.hero h1{font-size:22px;margin:0 0 4px}
header.hero .sub{color:var(--dim);font-size:12px}
.score{display:flex;align-items:center;gap:14px;margin:16px 0}
.score .n{font-size:34px;font-weight:700}
.score .bar{flex:1;height:10px;background:var(--line);border-radius:6px;overflow:hidden}
.score .bar i{display:block;height:100%;border-radius:6px}
section{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px 24px;margin-bottom:18px}
h2{margin:0 0 12px;font-size:16px;color:var(--acc)}
h3{margin:16px 0 8px;font-size:14px;color:var(--txt)}
p{margin:6px 0}ul{margin:6px 0;padding-left:20px}li{margin:3px 0}li.sub{color:var(--dim);font-size:13px;margin-left:14px}
code{font-family:ui-monospace,Consolas,monospace;color:var(--code);background:#1a1425;padding:1px 5px;border-radius:4px;font-size:12.5px}
pre{background:#0d1319;border:1px solid var(--line);border-radius:8px;padding:12px 14px;overflow:auto;font-family:ui-monospace,Consolas,monospace;font-size:12.5px}
table{border-collapse:collapse;width:100%;margin:10px 0;font-size:13px}
th{text-align:left;color:var(--dim);font-weight:600;padding:8px 10px;border-bottom:1px solid var(--line)}
td{padding:7px 10px;border-bottom:1px solid #151d27;vertical-align:top}
tr:hover td{background:#131a23}
strong{color:var(--txt)}em{color:var(--dim)}hr{border:none;border-top:1px solid var(--line);margin:14px 0}
a{color:var(--acc)}
@media(max-width:800px){nav{display:none}main{margin:0;padding:18px}}
</style></head><body>
<nav><b>◆ ${esc(meta.project)}</b>${nav}</nav>
<main>
<header class="hero"><h1>${esc(title)}</h1><div class="sub">${esc(meta.generated)}</div>
${score !== null ? `<div class="score"><span class="n">${score}<small style="font-size:15px;color:var(--dim)">/100</small></span><div class="bar"><i style="width:${score}%;background:${score >= 70 ? 'var(--ok)' : score >= 50 ? 'var(--warn)' : 'var(--bad)'}"></i></div></div>` : ''}
${intro}
</header>
${body}
</main></body></html>`;
}
