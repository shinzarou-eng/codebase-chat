// Local dashboard app — a real UI so users never need the terminal.
// Serves an SPA shell + JSON API that runs the same engines as the CLI.

import { createServer, type Server } from 'node:http';
import { basename } from 'node:path';
import { buildDeterministicReport } from './report.js';
import { analyzeProject, formatHealthReportMd } from './analysis.js';
import { analyzeImpact, formatImpactReportMd } from './impact.js';
import { buildContext } from './context.js';
import { buildToolPrompt } from './prompts.js';
import { getIndex } from './indexer.js';
import { findProjectRoot } from './project.js';
import { parseReportMd, DASH_CSS, scoreGauge, reportToHtml } from './ui.js';

type Lang = 'fr' | 'en';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const PROMPT_MODES = ['intelligence', 'audit', 'report', 'ceo', 'tasks', 'player', 'crea', 'chat', 'search', 'explain', 'refactor', 'git', 'build'];

function appHtml(project: string, absPath: string, lang: Lang): string {
  const t = (fr: string, en: string) => (lang === 'en' ? en : fr);
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>◆ ${esc(project)} — codebase dashboard</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>◆</text></svg>">
<style>${DASH_CSS}
body{display:flex;margin:0}
aside{position:fixed;inset:0 auto 0 0;width:264px;background:#0d1219;border-right:1px solid var(--line);padding:22px 16px;overflow:auto;display:flex;flex-direction:column}
aside .logo{color:var(--acc);font-weight:700;font-size:15px;padding:0 8px 6px;word-break:break-all}
aside .tag{color:var(--dim);font-size:11px;padding:0 8px 18px;border-bottom:1px solid var(--line);margin-bottom:14px}
aside .grp{font-size:10px;letter-spacing:.12em;color:var(--dim);text-transform:uppercase;padding:12px 8px 6px}
button.act{display:flex;align-items:center;gap:9px;width:100%;text-align:left;background:transparent;border:1px solid transparent;color:var(--txt);padding:9px 12px;border-radius:9px;cursor:pointer;font-size:13px;font-weight:600}
button.act:hover{background:var(--card);border-color:var(--line)}
button.act.on{background:#14263d;border-color:#2d5a8f;color:#cfe8ff}
button.act:disabled{opacity:.4;cursor:wait}
.mini{padding:4px 8px}
.mini input,.mini select{width:100%;margin-bottom:7px}
.mini button.act{justify-content:center;background:var(--card);border-color:var(--line)}
.mini button.act:hover{border-color:var(--acc);color:var(--acc)}
#navList a{display:block;color:var(--dim);text-decoration:none;padding:5px 10px;border-radius:7px;font-size:12.5px}
#navList a:hover{background:var(--card);color:var(--txt)}
aside .foot{margin-top:auto;padding-top:14px;border-top:1px solid var(--line);font-size:11px;color:var(--dim)}
main{margin-left:264px;flex:1;min-width:0}
.top{position:sticky;top:0;z-index:10;background:rgba(11,15,20,.9);backdrop-filter:blur(10px);border-bottom:1px solid var(--line);padding:12px 28px;display:flex;align-items:center;gap:8px}
.top input[type=text]{flex:0 1 260px;margin-left:auto}
.top button{background:var(--card);border:1px solid var(--line);color:var(--txt);padding:7px 13px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600;white-space:nowrap}
.top button:hover{border-color:var(--acc);color:var(--acc)}
.chip{background:var(--card);border:1px solid var(--line);color:var(--dim);padding:6px 12px;border-radius:20px;cursor:pointer;font-size:12px;font-weight:600}
.chip:hover{color:var(--txt)}
.chip.on{border-color:var(--acc);color:var(--acc);background:rgba(110,194,255,.08)}
.wrap{max-width:1060px;padding:26px 32px 80px}
input,select{background:#0d1319;border:1px solid var(--line);color:var(--txt);padding:8px 12px;border-radius:8px;font-size:13px;font-family:inherit}
input:focus,select:focus{outline:none;border-color:var(--acc)}
#out{min-height:300px}
.spin{color:var(--dim);padding:60px 0;text-align:center;font-size:14px}
.spin::after{content:'…';animation:dots 1.2s infinite}
@keyframes dots{0%{content:'.'}33%{content:'..'}66%{content:'…'}}
.err{color:var(--bad);padding:20px}
#out section{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px 24px;margin-bottom:18px;box-shadow:0 2px 12px rgba(0,0,0,.25)}
.rhero{display:flex;align-items:center;gap:22px;margin-bottom:20px}
.rhero h1{font-size:20px;margin:0}
.rhero .sub{color:var(--dim);font-size:12px}
.prompthd{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
.prompthd h2{margin:0}
.askcard{background:linear-gradient(135deg,#12233a,#101823);border:1px solid #24405f;border-radius:14px;padding:20px 24px;margin-bottom:20px}
.askcard h2{margin:0 0 12px;font-size:16px}
.askcard textarea{width:100%;background:#0d1319;border:1px solid var(--line);color:var(--txt);padding:10px 14px;border-radius:9px;font-size:14px;font-family:inherit;resize:vertical}
.askcard textarea:focus{outline:none;border-color:var(--acc)}
.askcard .hint{flex:1}
pre.big{max-height:60vh}
.hidden{display:none!important}
@media(max-width:860px){aside{position:static;width:auto}body{display:block}main{margin:0}.top{flex-wrap:wrap}}
</style></head><body>
<aside>
<div class="logo">◆ ${esc(project)}</div>
<div class="tag">${t('100% local · aucune donnée ne sort', '100% local · nothing leaves your machine')}</div>
<div class="grp">${t('Analyses', 'Analysis')}</div>
<button class="act" data-a="audit">🔍 ${t('Audit complet', 'Deep audit')}</button>
<button class="act" data-a="health">❤️ ${t('Santé', 'Health')}</button>
<button class="act" data-a="stats">📊 Stats</button>
<button class="act" data-a="impact">💥 Impact</button>
<div id="impactBox" class="mini hidden"><input type="text" id="ifile" list="fileList" placeholder="src/store.ts" autocomplete="off"><datalist id="fileList"></datalist><button class="act" id="igo">${t('Analyser', 'Analyze')}</button></div>
<div class="grp">${t('Prompt pour un LLM', 'Prompt for an LLM')}</div>
<div class="mini"><select id="mode">${PROMPT_MODES.map(m => `<option>${m}</option>`).join('')}</select>
<input type="text" id="q" placeholder="${t('question / fichier / focus', 'question / file / focus')}">
<button class="act" id="gen">${t('Générer le prompt', 'Generate prompt')}</button></div>
<div class="grp">${t('Projet', 'Project')}</div>
<div class="mini"><input type="text" id="proj" value="${esc(absPath)}" placeholder="C:\\path\\to\\project">
<button class="act" id="pset">${t('Analyser ce projet', 'Analyze this project')}</button></div>
<div class="grp" id="navGrp" style="display:none">${t('Sections', 'Sections')}</div>
<div id="navList"></div>
<div class="foot">dsh-codebase-chat<br>npx dsh-codebase-chat --ui</div>
</aside>
<main>
<div class="top">
<span class="chip on" data-sev="">${t('Tout', 'All')}</span>
<span class="chip" data-sev="crit">🔴</span>
<span class="chip" data-sev="high">🟠</span>
<span class="chip" data-sev="med">🟡</span>
<a class="chip" href="/?lang=${lang === 'en' ? 'fr' : 'en'}" style="text-decoration:none">${lang === 'en' ? '🇫🇷 FR' : '🇬🇧 EN'}</a>
<button id="viewMd">Markdown</button>
<button id="dlMd">.md ↓</button>
<button id="dlHtml">.html ↓</button>
<button id="copyMd">${t('⧉ Copier', '⧉ Copy')}</button>
<input type="text" id="search" placeholder="${t('Filtrer les résultats…', 'Filter results…')}">
</div>
<div class="wrap">
<div class="askcard">
<h2>💬 ${t('Pose une question sur ce projet', 'Ask anything about this project')}</h2>
<textarea id="ask" rows="2" placeholder="${t('ex : où est gérée l\'authentification ? que risque un refactor de src/store.ts ?', 'e.g. where is auth handled? what breaks if I refactor src/store.ts?')}"></textarea>
<div class="row" style="margin-top:10px">
<button class="act primary" id="askBtn" style="width:auto">${t('✨ Préparer le prompt', '✨ Build the prompt')}</button>
<span class="hint" style="margin:0">${t('Le prompt contient le code pertinent — colle-le dans ChatGPT, Claude ou Ollama.', 'The prompt carries the relevant code — paste it into ChatGPT, Claude or Ollama.')}</span>
</div></div>
<div id="promptOut" class="hidden"><div class="prompthd"><h2>Prompt</h2><button id="copyBtn" class="act" style="width:auto">${t('Copier', 'Copy')}</button></div><pre id="promptPre" class="big"></pre></div>
<div id="out"><div class="spin">${t('audit en cours', 'running audit')}</div></div>
</div>
</main>
<script>
const out = document.getElementById('out'), navList = document.getElementById('navList'), navGrp = document.getElementById('navGrp');
let curMd = '', curHtml = '', proj = '${esc(absPath).replace(/'/g, "\\'").replace(/\\/g, '\\\\')}', sevFilter = '', mdView = false;
const LANG = '${lang}';
const qp = () => (proj ? '&project=' + encodeURIComponent(proj) : '') + '&lang=' + LANG;
const loading = () => { out.innerHTML = '<div class="spin">${t('analyse en cours', 'analysing')}</div>'; };
async function call(url) {
  loading(); setActive(url); mdView = false;
  try {
    const r = await fetch(url); const j = await r.json();
    if (j.error) { out.innerHTML = '<div class="err">' + j.error + '</div>'; return; }
    curMd = j.md || ''; curHtml = j.standalone || '';
    document.getElementById('promptOut').classList.add('hidden');
    if (j.nav && j.nav.length) {
      navGrp.style.display = 'block';
      navList.innerHTML = j.nav.map(n => '<a href="#' + n.id + '">' + n.title + '</a>').join('');
    } else { navGrp.style.display = 'none'; navList.innerHTML = ''; }
    out.innerHTML = (j.hero || '') + (j.intro || '') + (j.body || j.text || '');
    filter(); spy();
  } catch (e) { out.innerHTML = '<div class="err">' + e.message + '</div>'; }
}
function setActive(url) {
  document.querySelectorAll('button.act[data-a]').forEach(b => b.classList.toggle('on', url.includes('/api/' + b.dataset.a)));
}
const impactBox = document.getElementById('impactBox');
document.querySelectorAll('button.act[data-a]').forEach(b => b.onclick = () => {
  const a = b.dataset.a;
  impactBox.classList.toggle('hidden', a !== 'impact');
  if (a === 'impact') loadFiles();
  if (a === 'audit') call('/api/audit?x=1' + qp());
  if (a === 'health') call('/api/health?x=1' + qp());
  if (a === 'stats') call('/api/stats?x=1' + qp());
});
// Collapsible sections
out.addEventListener('click', e => {
  const h = e.target.closest('h2.coll');
  if (h) h.parentElement.classList.toggle('collapsed');
});
// Impact file autocomplete
let filesLoaded = false;
async function loadFiles() {
  if (filesLoaded) return; filesLoaded = true;
  const r = await fetch('/api/files?x=1' + qp()); const j = await r.json();
  document.getElementById('fileList').innerHTML = (j.files || []).map(f => '<option value="' + f + '">').join('');
}
document.getElementById('ifile').addEventListener('focus', loadFiles);
document.getElementById('ifile').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('igo').click(); });
document.getElementById('igo').onclick = () => {
  const f = document.getElementById('ifile').value.trim();
  if (f) call('/api/impact?file=' + encodeURIComponent(f) + qp());
};
// Prompt generator
document.getElementById('gen').onclick = async () => {
  const mode = document.getElementById('mode').value, q = document.getElementById('q').value;
  const r = await fetch('/api/prompt?mode=' + mode + '&q=' + encodeURIComponent(q) + qp());
  const j = await r.json();
  document.getElementById('promptOut').classList.remove('hidden');
  document.getElementById('promptPre').textContent = j.prompt || j.error;
  document.getElementById('promptOut').scrollIntoView({ behavior: 'smooth' });
};
document.getElementById('q').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('gen').click(); });
// Big ask card — same prompt pipeline, mode chat
document.getElementById('askBtn').onclick = async () => {
  const q = document.getElementById('ask').value.trim();
  if (!q) return;
  document.getElementById('promptPre').textContent = '${t('assemblage du contexte…', 'assembling context…')}';
  document.getElementById('promptOut').classList.remove('hidden');
  document.getElementById('promptOut').scrollIntoView({ behavior: 'smooth' });
  const r = await fetch('/api/prompt?mode=chat&q=' + encodeURIComponent(q) + qp());
  const j = await r.json();
  document.getElementById('promptPre').textContent = j.prompt || j.error;
};
document.getElementById('ask').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) document.getElementById('askBtn').click(); });
document.getElementById('pset').onclick = () => {
  const v = document.getElementById('proj').value.trim();
  if (v) { proj = v; filesLoaded = false; call('/api/audit?x=1' + qp()); }
};
// Copy / downloads / view
const flash = (el, txt) => { const old = el.textContent; el.textContent = txt; setTimeout(() => el.textContent = old, 1500); };
document.getElementById('copyBtn').onclick = e => { navigator.clipboard.writeText(document.getElementById('promptPre').textContent); flash(e.target, '${t('Copié ✓', 'Copied ✓')}'); };
document.getElementById('copyMd').onclick = e => { if (curMd) { navigator.clipboard.writeText(curMd); flash(e.target, '${t('Copié ✓', 'Copied ✓')}'); } };
const dl = (name, content, type) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([content], { type })); a.download = name; a.click(); };
document.getElementById('dlMd').onclick = () => { if (curMd) dl('codebase-report.md', curMd, 'text/markdown'); };
document.getElementById('dlHtml').onclick = () => { if (curHtml) dl('codebase-report.html', curHtml, 'text/html'); };
document.getElementById('viewMd').onclick = () => {
  if (!curMd) return; mdView = !mdView;
  if (mdView) { out.dataset.html = out.innerHTML; out.innerHTML = '<section><pre class="big" style="margin:0">' + curMd.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</pre></section>'; }
  else { out.innerHTML = out.dataset.html; filter(); }
};
// Filters: severity chips + text
document.querySelectorAll('.chip[data-sev]').forEach(c => c.onclick = () => {
  document.querySelectorAll('.chip[data-sev]').forEach(x => x.classList.remove('on'));
  c.classList.add('on'); sevFilter = c.dataset.sev; filter();
});
function filter() {
  const q = document.getElementById('search').value.toLowerCase();
  document.querySelectorAll('#out section').forEach(s => {
    const okQ = !q || s.textContent.toLowerCase().includes(q);
    const okS = !sevFilter || s.querySelector('.sev-' + sevFilter);
    s.style.display = okQ && okS ? '' : 'none';
  });
}
document.getElementById('search').oninput = filter;
// Scroll-spy
let observer;
function spy() {
  if (observer) observer.disconnect();
  observer = new IntersectionObserver(es => {
    es.forEach(en => {
      if (en.isIntersecting) {
        navList.querySelectorAll('a').forEach(a => a.style.color = a.getAttribute('href') === '#' + en.target.id ? 'var(--acc)' : '');
      }
    });
  }, { rootMargin: '-15% 0px -75% 0px' });
  document.querySelectorAll('#out section[id]').forEach(s => observer.observe(s));
}
call('/api/audit?x=1' + qp());
</script></body></html>`;
}

export async function startDashboard(projectPath: string, lang: Lang): Promise<{ url: string; server: Server }> {
  const abs = await findProjectRoot(projectPath).catch(() => projectPath);
  const project = basename(abs);

  const json = (res: import('node:http').ServerResponse, data: unknown, code = 200) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  };

  const server = createServer(async (req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    try {
      const reqLang: Lang = u.searchParams.get('lang') === 'en' ? 'en' : u.searchParams.get('lang') === 'fr' ? 'fr' : lang;
      if (u.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(appHtml(project, abs, reqLang)); return; }

      const target = (u.searchParams.get('project') ?? '').trim() || projectPath;
      if (u.pathname === '/api/audit') {
        const md = await buildDeterministicReport(target, reqLang);
        const r = parseReportMd(md, project);
        json(res, { title: r.title, intro: r.intro, nav: r.nav, body: r.body, md, standalone: reportToHtml(md, { project: target.split(/[\\/]/).pop() || 'project', generated: new Date().toISOString().slice(0, 10) }), hero: `<div class="rhero">${scoreGauge(r.score, r.grade)}<div><h1>${esc(r.title)}</h1><div class="sub">${esc(target)}</div></div></div>` });
        return;
      }
      if (u.pathname === '/api/files') {
        const index = await getIndex(await findProjectRoot(target).catch(() => target), () => {});
        json(res, { files: Object.keys(index.files).sort() });
        return;
      }
      if (u.pathname === '/api/health') {
        const report = await analyzeProject(await findProjectRoot(target).catch(() => target));
        const md = formatHealthReportMd(report, reqLang);
        const r = parseReportMd(md, project);
        json(res, { title: r.title, intro: r.intro, nav: r.nav, body: r.body, md });
        return;
      }
      if (u.pathname === '/api/impact') {
        const file = (u.searchParams.get('file') ?? '').trim();
        if (!file) { json(res, { error: 'file param required' }, 400); return; }
        const r = await analyzeImpact(target, file);
        if (!r.ok) {
          json(res, { error: r.candidates.length ? `Ambiguous — candidates: ${r.candidates.join(', ')}` : `No code file matches "${file}"` });
          return;
        }
        const md = formatImpactReportMd(r.report, reqLang);
        const p = parseReportMd(md, project);
        json(res, { body: p.body || `<p>${p.intro}</p>`, md });
        return;
      }
      if (u.pathname === '/api/stats') {
        const index = await getIndex(await findProjectRoot(target).catch(() => target), () => {});
        const fileCount = Object.keys(index.files).length;
        const totalTokens = Object.values(index.files).reduce((s, f) => s + f.chunks.reduce((a, c) => a + c.tokens, 0), 0);
        const termCount = Object.keys(index.terms).length;
        json(res, { body: `<section><h2>📊 Stats</h2><ul><li><strong>Project</strong>: <code>${esc(index.projectPath)}</code></li><li><strong>Files</strong>: ${fileCount}</li><li><strong>Tokens</strong>: ${totalTokens.toLocaleString()}</li><li><strong>Terms</strong>: ${termCount.toLocaleString()}</li><li><strong>Cache</strong>: <code>${esc(index.projectHash)}</code></li></ul></section>` });
        return;
      }
      if (u.pathname === '/api/prompt') {
        const mode = u.searchParams.get('mode') ?? 'intelligence';
        const q = u.searchParams.get('q') ?? '';
        const isFile = /\.[a-z0-9]+$/i.test(q);
        const result = await buildContext({ project: target, query: q, filePath: isFile ? q : undefined, lang: reqLang });
        let staticSection = '';
        if (new Set(['intelligence', 'report', 'audit', 'tasks', 'ceo']).has(mode)) {
          try {
            const report = await analyzeProject(result.absProject);
            staticSection = `\n\n== ${reqLang === 'en' ? 'STATIC ANALYSIS (deterministic)' : 'ANALYSE STATIQUE (déterministe)'} ==\n${formatHealthReportMd(report, reqLang)}`;
          } catch { /* best-effort */ }
        }
        const prompt = buildToolPrompt(`codebase_${mode}`, {
          context: `${result.context}${staticSection}`,
          projectName: basename(result.absProject),
          lang: reqLang, query: q, focus: q, filePath: isFile ? q : '', description: q,
        });
        json(res, { prompt });
        return;
      }
      res.writeHead(404); res.end();
    } catch (e) {
      json(res, { error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });

  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}`, server };
}
