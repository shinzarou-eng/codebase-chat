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
import { parseReportMd, DASH_CSS } from './ui.js';

type Lang = 'fr' | 'en';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const PROMPT_MODES = ['intelligence', 'audit', 'report', 'ceo', 'tasks', 'player', 'crea', 'chat', 'search', 'explain', 'refactor', 'git', 'build'];

function appHtml(project: string, lang: Lang): string {
  const t = (fr: string, en: string) => (lang === 'en' ? en : fr);
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>◆ ${esc(project)} — codebase dashboard</title><style>${DASH_CSS}
body{display:block}
.top{position:sticky;top:0;z-index:10;background:rgba(11,15,20,.92);backdrop-filter:blur(8px);border-bottom:1px solid var(--line);padding:14px 28px;display:flex;align-items:center;gap:16px}
.top .logo{color:var(--acc);font-weight:700;font-size:15px}
.top .tag{color:var(--dim);font-size:12px;border:1px solid var(--line);border-radius:20px;padding:3px 10px}
.wrap{max-width:1200px;margin:0 auto;padding:24px 28px 60px}
.toolbar{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:22px}
button.act{background:var(--card);border:1px solid var(--line);color:var(--txt);padding:9px 16px;border-radius:9px;cursor:pointer;font-size:13px;font-weight:600}
button.act:hover{border-color:var(--acc);color:var(--acc)}
button.act.primary{background:linear-gradient(135deg,#1e3a5f,#14263d);border-color:#2d5a8f;color:#cfe8ff}
button.act.primary:hover{border-color:var(--acc)}
button.act:disabled{opacity:.4;cursor:wait}
.pane{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px 22px;margin-bottom:18px}
.pane h2{margin-top:0}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
input,select{background:#0d1319;border:1px solid var(--line);color:var(--txt);padding:8px 12px;border-radius:8px;font-size:13px;font-family:inherit}
input:focus,select:focus{outline:none;border-color:var(--acc)}
input[type=text]{flex:1;min-width:220px}
.hint{color:var(--dim);font-size:12px;margin-top:8px}
#out{min-height:200px}
.spin{color:var(--dim);padding:40px 0;text-align:center}
.spin::after{content:'…';animation:dots 1.2s infinite}
@keyframes dots{0%{content:'.'}33%{content:'..'}66%{content:'…'}}
.err{color:var(--bad);padding:20px}
#out section{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px 24px;margin-bottom:18px}
.subnav{position:sticky;top:57px;background:var(--bg);padding:8px 0;border-bottom:1px solid var(--line);margin-bottom:16px;display:none;flex-wrap:wrap;gap:6px}
.subnav a{color:var(--dim);font-size:12px;text-decoration:none;padding:3px 9px;border-radius:6px;border:1px solid var(--line)}
.subnav a:hover{color:var(--acc);border-color:var(--acc)}
.copybar{display:flex;justify-content:flex-end;margin-bottom:8px}
.copybar button{background:#1a2430;border:1px solid var(--line);color:var(--txt);padding:6px 14px;border-radius:7px;cursor:pointer;font-size:12px}
.copybar button:hover{border-color:var(--acc)}
.hero2{margin:10px 0 20px}
.hero2 .big{font-size:36px;font-weight:700}
</style></head><body>
<div class="top"><span class="logo">◆ ${esc(project)}</span><span class="tag">${t('100% local — rien ne quitte ta machine', '100% local — nothing leaves your machine')}</span></div>
<div class="wrap">
<div class="toolbar">
  <button class="act primary" data-a="audit">${t('🔍 Audit complet', '🔍 Deep audit')}</button>
  <button class="act" data-a="health">${t('❤️ Santé', '❤️ Health')}</button>
  <button class="act" data-a="stats">📊 Stats</button>
  <button class="act" data-a="impact">💥 Impact</button>
</div>
<div class="pane"><h2>${t('Générateur de prompt', 'Prompt generator')}</h2>
<div class="row"><select id="mode">${PROMPT_MODES.map(m => `<option>${m}</option>`).join('')}</select>
<input type="text" id="q" placeholder="${t('question / fichier / focus (optionnel selon le mode)', 'question / file / focus (optional by mode)')}">
<button class="act" id="gen">${t('Générer', 'Generate')}</button></div>
<div class="hint">${t('Le prompt assemblé est copiable — colle-le dans n\'importe quel LLM (ChatGPT, Claude, Ollama…).', 'The assembled prompt is copyable — paste it into any LLM (ChatGPT, Claude, Ollama…).')}</div>
<div id="promptOut" style="display:none"><div class="copybar"><button id="copyBtn">${t('Copier', 'Copy')}</button></div><pre id="promptPre" style="max-height:340px"></pre></div>
</div>
<div id="impactBox" class="pane" style="display:none"><h2>💥 ${t('Analyse d\'impact', 'Impact analysis')}</h2>
<div class="row"><input type="text" id="ifile" placeholder="src/store.ts"><button class="act" id="igo">${t('Analyser', 'Analyze')}</button></div></div>
<div class="subnav" id="subnav"></div>
<div id="out"><div class="spin">${t('Choisis une action ci-dessus', 'Pick an action above')}</div></div>
</div>
<script>
const out = document.getElementById('out'), subnav = document.getElementById('subnav');
const loading = () => { out.innerHTML = '<div class="spin">${t('analyse en cours', 'analysing')}</div>'; subnav.style.display = 'none'; };
async function call(url) {
  loading();
  try {
    const r = await fetch(url); const j = await r.json();
    if (j.error) { out.innerHTML = '<div class="err">' + j.error + '</div>'; return; }
    if (j.nav && j.nav.length) {
      subnav.innerHTML = j.nav.map(n => '<a href="#' + n.id + '">' + n.title + '</a>').join('');
      subnav.style.display = 'flex';
    }
    out.innerHTML = (j.hero || '') + (j.intro || '') + (j.body || j.text || '');
  } catch (e) { out.innerHTML = '<div class="err">' + e.message + '</div>'; }
}
const impactBox = document.getElementById('impactBox');
document.querySelectorAll('button.act[data-a]').forEach(b => b.onclick = () => {
  const a = b.dataset.a;
  impactBox.style.display = a === 'impact' ? 'block' : 'none';
  if (a === 'audit') call('/api/audit');
  if (a === 'health') call('/api/health');
  if (a === 'stats') call('/api/stats');
});
document.getElementById('igo').onclick = () => {
  const f = document.getElementById('ifile').value.trim();
  if (f) call('/api/impact?file=' + encodeURIComponent(f));
};
document.getElementById('gen').onclick = async () => {
  const mode = document.getElementById('mode').value, q = document.getElementById('q').value;
  const r = await fetch('/api/prompt?mode=' + mode + '&q=' + encodeURIComponent(q));
  const j = await r.json();
  document.getElementById('promptOut').style.display = 'block';
  document.getElementById('promptPre').textContent = j.prompt || j.error;
};
document.getElementById('copyBtn').onclick = () => {
  navigator.clipboard.writeText(document.getElementById('promptPre').textContent);
  document.getElementById('copyBtn').textContent = '${t('Copié ✓', 'Copied ✓')}';
};
call('/api/audit');
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
      if (u.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(appHtml(project, lang)); return; }

      if (u.pathname === '/api/audit') {
        const md = await buildDeterministicReport(projectPath, lang);
        const r = parseReportMd(md, project);
        json(res, { title: r.title, intro: r.intro, nav: r.nav, body: r.body, hero: r.score !== null ? `<div class="hero2"><div class="big">${r.score}<small style="font-size:16px;color:var(--dim)">/100</small></div></div>` : '' });
        return;
      }
      if (u.pathname === '/api/health') {
        const report = await analyzeProject(abs);
        const r = parseReportMd(formatHealthReportMd(report, lang), project);
        json(res, { title: r.title, intro: r.intro, nav: r.nav, body: r.body });
        return;
      }
      if (u.pathname === '/api/impact') {
        const file = (u.searchParams.get('file') ?? '').trim();
        if (!file) { json(res, { error: 'file param required' }, 400); return; }
        const r = await analyzeImpact(projectPath, file);
        if (!r.ok) {
          json(res, { error: r.candidates.length ? `Ambiguous — candidates: ${r.candidates.join(', ')}` : `No code file matches "${file}"` });
          return;
        }
        const p = parseReportMd(formatImpactReportMd(r.report, lang), project);
        json(res, { body: p.body || `<p>${p.intro}</p>` });
        return;
      }
      if (u.pathname === '/api/stats') {
        const index = await getIndex(abs, () => {});
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
        const result = await buildContext({ project: projectPath, query: q, filePath: isFile ? q : undefined, lang });
        let staticSection = '';
        if (new Set(['intelligence', 'report', 'audit', 'tasks', 'ceo']).has(mode)) {
          try {
            const report = await analyzeProject(result.absProject);
            staticSection = `\n\n== ${lang === 'en' ? 'STATIC ANALYSIS (deterministic)' : 'ANALYSE STATIQUE (déterministe)'} ==\n${formatHealthReportMd(report, lang)}`;
          } catch { /* best-effort */ }
        }
        const prompt = buildToolPrompt(`codebase_${mode}`, {
          context: `${result.context}${staticSection}`,
          projectName: basename(result.absProject),
          lang, query: q, focus: q, filePath: isFile ? q : '', description: q,
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
