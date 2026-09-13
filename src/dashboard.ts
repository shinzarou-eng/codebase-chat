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
import { computeStats } from './stats.js';
import { fmtCost, CALL_INPUT_TOKENS, CALL_OUTPUT_TOKENS } from './pricing.js';

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
aside{position:fixed;inset:0 auto 0 0;width:248px;background:#1b1b1b;border-right:1px solid var(--line);padding:20px 10px;overflow:auto;display:flex;flex-direction:column}
aside .logo{display:flex;align-items:center;gap:9px;color:var(--txt);font-weight:600;font-size:14px;padding:4px 10px 10px;word-break:break-all}
aside .logo::before{content:'◆';display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;background:#4cc2ff;border-radius:5px;font-size:10px;color:#00395e;flex-shrink:0}
aside .tag{color:var(--dim);font-size:11px;padding:0 10px 16px;border-bottom:1px solid var(--line);margin-bottom:10px}
aside .grp{font-size:11px;font-weight:600;letter-spacing:.02em;color:var(--dim);padding:14px 10px 4px}
button.act{display:flex;align-items:center;gap:9px;width:100%;text-align:left;background:transparent;border:none;color:var(--txt);padding:8px 10px;border-radius:6px;cursor:pointer;font-size:13px;transition:background .1s;position:relative}
button.act:hover{background:#ffffff0d}
button.act.on{background:#ffffff12}
button.act.on::before{content:'';position:absolute;left:-10px;top:20%;bottom:20%;width:3px;border-radius:2px;background:var(--acc)}
button.act:disabled{opacity:.4;cursor:wait}
.mini{padding:2px 10px}
.mini input,.mini select{width:100%;margin-bottom:7px}
.mini button.act{justify-content:center;background:#ffffff0d;border:1px solid var(--line)}
.mini button.act:hover{background:#ffffff14}
#navList a{display:block;color:var(--dim);text-decoration:none;padding:5px 10px;border-radius:6px;font-size:12.5px;transition:background .1s}
#navList a:hover{background:#ffffff0d;color:var(--txt)}
aside .foot{margin-top:auto;padding:14px 10px 0;border-top:1px solid var(--line);font-size:11px;color:var(--dim)}
main{margin-left:248px;flex:1;min-width:0}
.top{position:sticky;top:0;z-index:10;background:rgba(31,31,31,.85);backdrop-filter:blur(16px) saturate(1.2);border-bottom:1px solid var(--line);padding:10px 28px;display:flex;align-items:center;gap:8px}
.top input[type=text]{flex:0 1 240px;margin-left:auto}
.top button,.top .chip{background:#ffffff0d;border:1px solid var(--line);color:var(--txt);padding:6px 12px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;white-space:nowrap;transition:background .1s;text-decoration:none}
.top button:hover,.top .chip:hover{background:#ffffff16}
.top .chip.on{background:rgba(76,194,255,.16);color:var(--acc);border-color:rgba(76,194,255,.35)}
.wrap{max-width:1040px;padding:24px 32px 80px}
input,select{background:#ffffff0a;border:1px solid var(--line);color:var(--txt);padding:7px 12px;border-radius:6px;font-size:13px;font-family:inherit;transition:border-color .1s}
input:focus,select:focus{outline:none;border-color:var(--acc);box-shadow:inset 0 -2px 0 var(--acc)}
input:hover,select:hover{border-color:var(--line2)}
#out{min-height:300px}
.spin{color:var(--dim);padding:60px 0;text-align:center;font-size:14px}
.spin::after{content:'…';animation:dots 1.2s infinite}
@keyframes dots{0%{content:'.'}33%{content:'..'}66%{content:'…'}}
.err{color:var(--bad);padding:20px}
.rhero{display:flex;align-items:center;gap:22px;margin-bottom:20px}
.rhero h1{font-size:20px;margin:0;font-weight:600}
.rhero .sub{color:var(--dim);font-size:12px}
.prompthd{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
.prompthd h2{margin:0}
.askcard{background:#282828;border:1px solid var(--line);border-radius:8px;padding:20px 24px;margin-bottom:22px;box-shadow:0 2px 8px rgba(0,0,0,.2)}
.askcard h2{margin:0 0 10px;font-size:15px;font-weight:600}
.askcard textarea{width:100%;background:#ffffff0a;border:1px solid var(--line);color:var(--txt);padding:10px 14px;border-radius:6px;font-size:14px;font-family:inherit;resize:vertical;transition:border-color .1s}
.askcard textarea:focus{outline:none;border-color:var(--acc);box-shadow:inset 0 -2px 0 var(--acc)}
.askcard .hint{flex:1;color:var(--dim);font-size:12px}
.btn-acc{background:#4cc2ff;color:#00395e;border:1px solid #60cdff}
.btn-acc:hover{background:#69c9ff}
pre.big{max-height:60vh}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:6px 0 8px}
.kpi{background:#232323;border:1px solid var(--line);border-radius:8px;padding:12px 14px}
.kpi .kv{font-size:21px;font-weight:600;line-height:1.2}
.kpi .kl{color:var(--dim);font-size:11.5px;margin-top:2px}
.dim-s{color:var(--dim);font-size:12px}
.fitbar{display:inline-block;width:90px;height:6px;background:#ffffff14;border-radius:3px;overflow:hidden;vertical-align:middle;margin-right:8px}
.fitbar i{display:block;height:100%;background:var(--acc);border-radius:3px}
.hidden{display:none!important}
@media(max-width:860px){aside{position:static;width:auto}body{display:block}main{margin:0}.top{flex-wrap:wrap}}
</style></head><body>
<aside>
<div class="logo">${esc(project)}</div>
<div class="tag">${t('100% local · aucune donnée ne sort', '100% local · nothing leaves your machine')}</div>
<div class="grp">${t('Analyses', 'Analysis')}</div>
<button class="act" data-a="audit">${t('Audit complet', 'Deep audit')}</button>
<button class="act" data-a="health">${t('Santé du code', 'Code health')}</button>
<button class="act" data-a="stats">${t('Statistiques', 'Statistics')}</button>
<button class="act" data-a="impact">${t('Impact d\'un fichier', 'File impact')}</button>
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
<span class="chip" data-sev="crit">${t('Critique', 'Critical')}</span>
<span class="chip" data-sev="high">${t('Élevée', 'High')}</span>
<span class="chip" data-sev="med">${t('Moyenne', 'Medium')}</span>
<a class="chip" href="/?lang=${lang === 'en' ? 'fr' : 'en'}">${lang === 'en' ? 'FR' : 'EN'}</a>
<button id="viewMd">Markdown</button>
<button id="dlMd">${t('Exporter .md', 'Export .md')}</button>
<button id="dlHtml">${t('Exporter .html', 'Export .html')}</button>
<button id="copyMd">${t('Copier', 'Copy')}</button>
<input type="text" id="search" placeholder="${t('Filtrer les résultats…', 'Filter results…')}">
</div>
<div class="wrap">
<div class="askcard">
<h2>${t('Pose une question sur ce projet', 'Ask anything about this project')}</h2>
<textarea id="ask" rows="2" placeholder="${t('ex : où est gérée l\'authentification ? que risque un refactor de src/store.ts ?', 'e.g. where is auth handled? what breaks if I refactor src/store.ts?')}"></textarea>
<div class="row" style="margin-top:10px">
<button class="act btn-acc" id="askBtn" style="width:auto">${t('Préparer le prompt', 'Build the prompt')}</button>
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
const escH = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const loading = () => { out.innerHTML = '<div class="spin">${t('analyse en cours', 'analysing')}</div>'; };
async function call(url) {
  loading(); setActive(url); mdView = false;
  try {
    const r = await fetch(url); const j = await r.json();
    if (j.error) { out.innerHTML = '<div class="err">' + escH(j.error) + '</div>'; return; }
    curMd = j.md || ''; curHtml = j.standalone || '';
    document.getElementById('promptOut').classList.add('hidden');
    if (j.nav && j.nav.length) {
      navGrp.style.display = 'block';
      navList.innerHTML = j.nav.map(n => '<a href="#' + escH(n.id) + '">' + escH(n.title) + '</a>').join('');
    } else { navGrp.style.display = 'none'; navList.innerHTML = ''; }
    out.innerHTML = (j.hero || '') + (j.intro || '') + (j.body || j.text || '');
    filter(); spy();
  } catch (e) { out.innerHTML = '<div class="err">' + escH(e.message) + '</div>'; }
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
        json(res, { title: r.title, intro: r.intro, nav: r.nav, body: r.body, md, standalone: reportToHtml(md, { project: target.split(/[\\/]/).pop() || 'project', generated: new Date().toISOString().slice(0, 10) }), hero: `<div class="rhero">${scoreGauge(r.score, r.grade)}<div><h1>${esc(r.title.replace(/^\p{Extended_Pictographic}\s*/u, ''))}</h1><div class="sub">${esc(target)}</div></div></div>` });
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
        const s = computeStats(index);
        const fmt = (n: number) => n.toLocaleString('en-US');
        const tt = (fr: string, en: string) => (reqLang === 'en' ? en : fr);
        const mb = s.bytes >= 1_048_576 ? (s.bytes / 1_048_576).toFixed(1) + ' MB' : Math.round(s.bytes / 1024) + ' KB';
        const kpi = (v: string, l: string) => `<div class="kpi"><div class="kv">${v}</div><div class="kl">${l}</div></div>`;
        const modelRows = s.models.map(m =>
          `<tr><td>${esc(m.family)}</td><td><code>${esc(m.tokenizer)}</code></td><td>${m.exact ? '' : '~'}${fmt(m.tokens)}</td><td>${m.exact ? `<span class="sev sev-ok">exact</span>` : `<span class="sev sev-med">est.</span> <span class="dim-s">${esc(m.note)}</span>`}</td></tr>`).join('');
        const winRows = s.windows.map(w =>
          `<tr><td>${esc(w.model)}</td><td>${fmt(w.window)}</td><td><span class="sev ${w.fits ? 'sev-ok' : 'sev-crit'}">${w.fits ? tt('tient', 'fits') : tt('dépasse', 'exceeds')}</span></td><td><div class="fitbar"><i style="width:${Math.min(w.usedPct, 100)}%"></i></div><span class="dim-s">${w.usedPct}%</span></td></tr>`).join('');
        const costRows = s.costs.map(c =>
          `<tr><td>${esc(c.label)}</td><td>${c.free ? 'local' : `$${c.priceIn}/$${c.priceOut}`}</td><td>${c.free ? `<span class="sev sev-ok">${tt('gratuit', 'free')}</span>` : `~${fmtCost(c.estCost)}`}</td><td class="dim-s">${esc(c.context ?? '')}</td></tr>`).join('');
        const fileRows = s.topFiles.map(f => `<tr><td><code>${esc(f.path)}</code></td><td>${fmt(f.tokens)}</td></tr>`).join('');
        const extRows = s.topExts.map(e => `<tr><td><code>${esc(e.ext)}</code></td><td>${e.count}</td></tr>`).join('');
        const body = `<section id="stats"><h2>${tt('Statistiques du projet', 'Project statistics')}</h2>
<div class="kpis">${kpi(String(s.files), tt('fichiers indexés', 'indexed files'))}${kpi(String(s.chunks), 'chunks')}${kpi(fmt(s.terms), tt('termes dans l\'index', 'index terms'))}${kpi(mb, tt('taille totale', 'total size'))}${kpi(fmt(s.o200k), 'tokens o200k')}${kpi(fmt(s.cl100k), 'tokens cl100k')}</div>
<h3>${tt('Tokens par famille de modèle', 'Tokens per model family')}</h3>
<p class="dim-s">${tt('Combien de tokens représente ce codebase selon le tokenizer de chaque modèle. Utile pour estimer le coût et la faisabilité avant d\'envoyer du code à une API.', 'How many tokens this codebase represents under each model\'s tokenizer. Useful to estimate cost and feasibility before sending code to an API.')}</p>
<table><tr><th>${tt('Modèle', 'Model')}</th><th>Tokenizer</th><th>Tokens</th><th>${tt('Précision', 'Accuracy')}</th></tr>${modelRows}</table>
<h3>${tt('Fenêtres de contexte — le projet entier y tient-il ?', 'Context windows — does the whole project fit?')}</h3>
<p class="dim-s">${tt('Si vous envoyiez l\'intégralité du code en une seule requête. En pratique le retrieval n\'envoie qu\'une sélection ≤ 60k tokens (maxTokens) — aucune fenêtre n\'est nécessaire pour tout le projet.', 'If you sent the entire codebase in a single request. In practice retrieval only sends a ≤ 60k-token selection (maxTokens) — no window needs to hold the whole project.')}</p>
<table><tr><th>${tt('Modèle', 'Model')}</th><th>${tt('Fenêtre', 'Window')}</th><th></th><th>${tt('Occupation', 'Usage')}</th></tr>${winRows}</table>
<h3>${tt('Coût estimé par appel (--call)', 'Estimated cost per call (--call)')}</h3>
<p class="dim-s">${tt(`Chaque appel envoie ≈${fmt(CALL_INPUT_TOKENS)} tokens d'entrée (budget retrieval) + ≤${fmt(CALL_OUTPUT_TOKENS)} tokens de sortie. Tarifs catalogue sept. 2026 — le cache, le batch et les prix d'intro changent la facture réelle.`, `Each call sends ≈${fmt(CALL_INPUT_TOKENS)} input tokens (retrieval budget) + ≤${fmt(CALL_OUTPUT_TOKENS)} output tokens. Sept 2026 list prices — caching, batch and intro tiers change the real bill.`)}</p>
<table><tr><th>${tt('Modèle', 'Model')}</th><th>${tt('Prix $/M (in/out)', 'Price $/M (in/out)')}</th><th>${tt('Coût/appel', 'Cost/call')}</th><th>${tt('Contexte', 'Context')}</th></tr>${costRows}</table>
<h3>${tt('Fichiers les plus lourds (tokens)', 'Heaviest files (tokens)')}</h3>
<table><tr><th>${tt('Fichier', 'File')}</th><th>Tokens</th></tr>${fileRows}</table>
<h3>${tt('Fichiers par extension', 'Files by extension')}</h3>
<table><tr><th>Ext</th><th>${tt('Fichiers', 'Files')}</th></tr>${extRows}</table>
<p class="dim-s">${tt('Cache d\'index', 'Index cache')}: <code>${esc(s.projectHash)}</code> · <code>${esc(s.projectPath)}</code></p>
</section>`;
        json(res, { body });
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
