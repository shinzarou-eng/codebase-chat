// Local dashboard app — a real UI so users never need the terminal.
// Serves an SPA shell + JSON API that runs the same engines as the CLI.

import { createServer, type Server } from 'node:http';
import { basename, extname } from 'node:path';
import { buildDeterministicReport, collectAudit } from './report.js';
import { analyzeProject, formatHealthReportMd, CODE_EXTS, SKIP_EXTS } from './analysis.js';
import { analyzeImpact, formatImpactReportMd } from './impact.js';
import { buildContext } from './context.js';
import { buildToolPrompt } from './prompts.js';
import { getIndex } from './indexer.js';
import { findProjectRoot } from './project.js';
import { parseReportMd, DASH_CSS, scoreGauge, reportToHtml } from './ui.js';
import { computeStats } from './stats.js';
import { fmtCost, CALL_INPUT_TOKENS, CALL_OUTPUT_TOKENS } from './pricing.js';
import { getChangedFiles } from './diff.js';
import { runCheck, formatCheckMd } from './check.js';
import { auditFindings } from './findings.js';
import { writeBaseline } from './baseline.js';

type Lang = 'fr' | 'en';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const PROMPT_MODES = ['intelligence', 'audit', 'report', 'ceo', 'tasks', 'player', 'crea', 'chat', 'search', 'explain', 'refactor', 'git', 'build'];

// Inline SVG icons — Lucide-style strokes, inherit currentColor.
const ic = (p: string, size = 15) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const IC = {
  audit: ic('<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>'),
  health: ic('<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>'),
  stats: ic('<line x1="12" x2="12" y1="20" y2="10"/><line x1="18" x2="18" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="16"/>'),
  impact: ic('<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>'),
  check: ic('<circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/>'),
  wand: ic('<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>'),
  folder: ic('<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>'),
  search: ic('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>'),
  download: ic('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>'),
  copy: ic('<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>'),
  file: ic('<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/>'),
  globe: ic('<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>'),
  lock: ic('<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>', 11),
  chat: ic('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>', 16),
  play: ic('<polygon points="7 4 20 12 7 20 7 4"/>'),
};

function appHtml(project: string, absPath: string, lang: Lang): string {
  const t = (fr: string, en: string) => (lang === 'en' ? en : fr);
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>◆ ${esc(project)} — codebase dashboard</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>◆</text></svg>">
<style>${DASH_CSS}
body{display:flex;margin:0}
/* ---------- sidebar ---------- */
aside{position:fixed;inset:0 auto 0 0;width:256px;background:#1a1a1a;border-right:1px solid var(--line);padding:16px 12px;overflow-y:auto;overflow-x:hidden;display:flex;flex-direction:column}
aside::-webkit-scrollbar{width:8px}
.brand{display:flex;align-items:center;gap:11px;padding:2px 8px 14px;border-bottom:1px solid var(--line);margin-bottom:8px}
.brand .mk{width:28px;height:28px;border-radius:7px;background:linear-gradient(135deg,#4cc2ff,#1e8fd4);display:flex;align-items:center;justify-content:center;color:#00395e;font-weight:700;font-size:12px;flex-shrink:0;box-shadow:0 0 16px rgba(76,194,255,.3),inset 0 1px 0 rgba(255,255,255,.25)}
.brand .nm{font-weight:600;font-size:13.5px;letter-spacing:-.01em;color:var(--txt);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:168px}
.brand .lc{font-size:10.5px;color:var(--ok);display:flex;align-items:center;gap:4px;margin-top:1px}
.grp{font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#6b6b6b;padding:16px 9px 5px}
button.act{display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:transparent;border:none;color:#c9c9c9;padding:6px 9px;border-radius:7px;cursor:pointer;font-size:13px;font-weight:500;transition:background .12s,color .12s;position:relative}
button.act .it{width:26px;height:26px;border-radius:6px;display:flex;align-items:center;justify-content:center;flex-shrink:0;background:#ffffff08;border:1px solid #ffffff0a;transition:all .12s}
button.act .it svg{color:var(--dim)}
button.act:hover{background:#ffffff0a;color:#fff}
button.act:hover .it{background:#ffffff10}
button.act:hover .it svg{color:var(--txt)}
button.act.on{background:rgba(76,194,255,.10);color:#fff}
button.act.on .it{background:rgba(76,194,255,.16);border-color:rgba(76,194,255,.3)}
button.act.on .it svg{color:var(--acc)}
button.act.on::before{content:'';position:absolute;left:-12px;top:18%;bottom:18%;width:3px;border-radius:2px;background:var(--acc);box-shadow:0 0 8px rgba(76,194,255,.5)}
button.act:disabled{opacity:.4;cursor:wait}
.it.b svg{color:#7fd4ff}.it.g svg{color:#6ccb5f}.it.p svg{color:#c5a3ff}.it.o svg{color:#ffb98c}
button.act.on .it.b svg,button.act.on .it.g svg,button.act.on .it.p svg,button.act.on .it.o svg{color:var(--acc)}
.mini{padding:2px 9px 6px 12px}
.mini input,.mini select{width:100%;margin-bottom:7px}
.mini button.act{justify-content:center;background:#ffffff08;border:1px solid var(--line);font-weight:600}
.mini button.act:hover{background:#ffffff12;border-color:var(--line2)}
.mini button.act svg{color:var(--acc)}
#navList a{display:block;color:var(--dim);text-decoration:none;padding:5px 9px 5px 13px;border-radius:6px;font-size:12.5px;transition:all .1s;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-left:2px solid transparent}
#navList a:hover{background:#ffffff09;color:var(--txt)}
#navList a.cur{color:var(--acc);border-left-color:var(--acc);background:rgba(76,194,255,.06)}
aside .foot{margin-top:auto;padding:14px 9px 0;border-top:1px solid var(--line);font-size:10.5px;color:#666;line-height:1.6}
aside .foot code{font-size:10px;padding:1px 5px}
/* ---------- topbar ---------- */
main{margin-left:256px;flex:1;min-width:0}
.top{position:sticky;top:0;z-index:20;background:rgba(31,31,31,.8);backdrop-filter:blur(20px) saturate(1.4);border-bottom:1px solid var(--line);padding:8px 26px;display:flex;align-items:center;gap:8px}
.seg{display:flex;background:#ffffff07;border:1px solid var(--line);border-radius:8px;padding:2px;gap:1px}
.seg .chip{border:none;background:transparent;color:var(--dim);padding:5px 12px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;transition:all .12s;user-select:none}
.seg .chip:hover{color:var(--txt)}
.seg .chip.on{background:rgba(76,194,255,.16);color:var(--acc);box-shadow:0 1px 4px rgba(0,0,0,.3)}
.seg .chip .cnt{font-style:normal;font-size:10px;font-weight:700;background:#ffffff10;border:1px solid var(--line);border-radius:9px;padding:0 6px;margin-left:6px;color:var(--dim);font-variant-numeric:tabular-nums}
.seg .chip.on .cnt{background:rgba(76,194,255,.2);border-color:rgba(76,194,255,.3);color:var(--acc)}
.top button,.top a.chip{display:inline-flex;align-items:center;gap:6px;background:#ffffff07;border:1px solid var(--line);color:var(--txt);padding:6px 11px;border-radius:7px;cursor:pointer;font-size:12px;font-weight:600;white-space:nowrap;transition:all .12s;text-decoration:none}
.top button svg{color:var(--dim)}
.top button:hover,.top a.chip:hover{background:#ffffff12;border-color:var(--line2);transform:translateY(-1px)}
.top button:hover svg{color:var(--txt)}
.top button:active{transform:translateY(0)}
.top .spacer{flex:1}
.searchwrap{display:flex;align-items:center;gap:7px;background:#ffffff07;border:1px solid var(--line);border-radius:7px;padding:0 11px;color:var(--dim);transition:border-color .12s,box-shadow .12s}
.searchwrap:focus-within{border-color:var(--acc);box-shadow:0 0 0 3px rgba(76,194,255,.15)}
.searchwrap input{background:transparent;border:none;padding:7px 0;width:180px}
.searchwrap input:focus{outline:none;box-shadow:none}
.wrap{max-width:1080px;padding:26px 34px 90px;margin:0 auto}
input,select{background:#ffffff08;border:1px solid var(--line);color:var(--txt);padding:7px 12px;border-radius:6px;font-size:13px;font-family:inherit;transition:border-color .12s,box-shadow .12s}
input:focus,select:focus{outline:none;border-color:var(--acc);box-shadow:0 0 0 3px rgba(76,194,255,.15)}
input:hover,select:hover{border-color:var(--line2)}
#out{min-height:300px}
.err{color:var(--bad);padding:20px}
.skel{padding:8px 0}
.skel i{display:block;height:14px;border-radius:6px;background:linear-gradient(90deg,#ffffff07 25%,#ffffff13 50%,#ffffff07 75%);background-size:400% 100%;animation:shim 1.3s infinite;margin:14px 0}
.skel i:first-child{height:22px;width:42%}
@keyframes shim{0%{background-position:100% 0}100%{background-position:0 0}}
.rhero{display:flex;align-items:center;gap:22px;margin-bottom:20px}
.rhero h1{font-size:21px;margin:0;font-weight:600;letter-spacing:-.01em}
.rhero .sub{color:var(--dim);font-size:12px}
.prompthd{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
.prompthd h2{margin:0}
.askcard{background:linear-gradient(145deg,#262626,#222222);border:1px solid var(--line);border-radius:12px;padding:18px 22px;margin-bottom:26px;box-shadow:0 4px 16px rgba(0,0,0,.28),inset 0 1px 0 rgba(255,255,255,.04);position:relative;overflow:hidden}
.askcard::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(76,194,255,.4),transparent)}
.askhd{display:flex;align-items:center;gap:9px;color:var(--acc);margin-bottom:12px}
.askhd h2{margin:0;font-size:14.5px;font-weight:600;color:var(--txt);letter-spacing:-.005em}
.askrow{display:flex;gap:10px;align-items:flex-end}
.askcard textarea{flex:1;background:#ffffff07;border:1px solid var(--line);color:var(--txt);padding:10px 14px;border-radius:8px;font-size:13.5px;font-family:inherit;resize:vertical;min-height:42px;transition:border-color .12s,box-shadow .12s}
.askcard textarea:focus{outline:none;border-color:var(--acc);box-shadow:0 0 0 3px rgba(76,194,255,.15)}
.askcard .hint{color:var(--dim);font-size:11.5px;margin-top:9px;display:flex;align-items:center;gap:5px;flex-wrap:wrap}
.askcard kbd{background:#ffffff10;border:1px solid var(--line);border-bottom-width:2px;border-radius:5px;padding:0 6px;font-size:10.5px;font-family:inherit;color:var(--txt)}
.btn-acc{display:inline-flex;align-items:center;gap:7px;background:linear-gradient(180deg,#5ec8ff,#3fb4f5);color:#00395e!important;border:1px solid #6dcfff;border-radius:8px;padding:10px 18px;font-weight:600;font-size:13px;cursor:pointer;transition:all .12s;white-space:nowrap;box-shadow:0 2px 8px rgba(76,194,255,.22),inset 0 1px 0 rgba(255,255,255,.3)}
.btn-acc:hover{background:linear-gradient(180deg,#74d0ff,#4cc0f8);transform:translateY(-1px);box-shadow:0 4px 12px rgba(76,194,255,.3),inset 0 1px 0 rgba(255,255,255,.3)}
.btn-acc:active{transform:translateY(0)}
.btn-acc svg{color:#00395e!important}
pre.big{max-height:60vh}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:6px 0 8px}
.kpi{background:linear-gradient(160deg,#252525,#212121);border:1px solid var(--line);border-radius:9px;padding:13px 15px;transition:border-color .12s,transform .12s;position:relative;overflow:hidden}
.kpi:hover{border-color:var(--line2);transform:translateY(-1px)}
.kpi .kv{font-size:21px;font-weight:600;line-height:1.2;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.kpi .kl{color:var(--dim);font-size:11.5px;margin-top:3px}
.dim-s{color:var(--dim);font-size:12px}
.fitbar{display:inline-block;width:90px;height:6px;background:#ffffff12;border-radius:3px;overflow:hidden;vertical-align:middle;margin-right:8px}
.fitbar i{display:block;height:100%;background:linear-gradient(90deg,var(--acc),#8fd3ff);border-radius:3px}
a.fref{color:inherit;text-decoration:none;cursor:pointer;border-radius:4px;transition:color .1s}
a.fref:hover code,a.fref:hover{color:var(--acc)}
.chips{display:flex;flex-wrap:wrap;gap:4px;padding:4px 10px 8px}
.chips .lbl{width:100%;font-size:10.5px;color:var(--dim);letter-spacing:.04em;padding:2px 0}
.chip2{background:#ffffff0a;border:1px solid var(--line);color:var(--txt);padding:3px 8px;border-radius:5px;font-size:11px;cursor:pointer;font-family:'Cascadia Code',Consolas,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;transition:all .1s}
.chip2:hover{border-color:var(--acc);color:var(--acc);background:rgba(76,194,255,.08)}
.hidden{display:none!important}
.empty{border:1px dashed var(--line2);border-radius:10px;padding:34px 20px;text-align:center;color:var(--dim);font-size:13px;margin:14px 0}
::selection{background:rgba(76,194,255,.28)}
@media(max-width:860px){aside{position:static;width:auto}body{display:block}main{margin:0}.top{flex-wrap:wrap;padding:8px 14px}.seg{max-width:100%;overflow-x:auto;scrollbar-width:none}.seg::-webkit-scrollbar{display:none}.seg .chip{padding:5px 9px;white-space:nowrap}.searchwrap{flex:1;min-width:150px}.searchwrap input{width:100%;min-width:0}.wrap{padding:18px 18px 70px}}
</style></head><body>
<aside>
<div class="brand"><div class="mk">◆</div><div><div class="nm" title="${esc(absPath)}">${esc(project)}</div><div class="lc">${IC.lock} ${t('analyse locale — aucun envoi automatique', 'local analysis — no automatic upload')}</div></div></div>
<div class="grp">${t('Analyses', 'Analysis')}</div>
<button class="act" data-a="check"><span class="it g">${IC.check}</span>${t('Mes changements', 'My changes')}</button>
<button class="act" data-a="audit"><span class="it b">${IC.audit}</span>${t('Audit complet', 'Deep audit')}</button>
<button class="act" data-a="health"><span class="it g">${IC.health}</span>${t('Santé du code', 'Code health')}</button>
<button class="act" data-a="stats"><span class="it p">${IC.stats}</span>${t('Statistiques', 'Statistics')}</button>
<button class="act" data-a="impact"><span class="it o">${IC.impact}</span>${t('Impact d\'un fichier', 'File impact')}</button>
<div id="impactBox" class="mini hidden"><input type="text" id="ifile" list="fileList" placeholder="src/store.ts" autocomplete="off" aria-label="${t('Fichier à analyser', 'File to analyse')}"><datalist id="fileList"></datalist><button class="act" id="igo">${IC.play}${t('Analyser', 'Analyze')}</button><div class="chips" id="chgChips"></div></div>
<div class="grp">${t('Prompt pour un LLM', 'Prompt for an LLM')}</div>
<div class="mini"><select id="mode" aria-label="${t('Mode du prompt', 'Prompt mode')}">${PROMPT_MODES.map(m => `<option>${m}</option>`).join('')}</select>
<input type="text" id="q" placeholder="${t('question / fichier / focus', 'question / file / focus')}" aria-label="${t('Question ou focus', 'Question or focus')}">
<button class="act" id="gen">${IC.wand}${t('Générer le prompt', 'Generate prompt')}</button></div>
<div class="grp">${t('Projet', 'Project')}</div>
<div class="mini"><input type="text" id="proj" value="${esc(absPath)}" placeholder="C:\\path\\to\\project" aria-label="${t('Chemin du projet', 'Project path')}">
<button class="act" id="pset">${IC.folder}${t('Analyser ce projet', 'Analyze this project')}</button></div>
<div class="grp" id="navGrp" style="display:none">${t('Sections', 'Sections')}</div>
<div id="navList"></div>
<div class="foot">dsh-codebase-chat<br><code>npx dsh-codebase-chat --ui</code></div>
</aside>
<main>
<div class="top">
<div class="seg">
<span class="chip on" data-sev="">${t('Tout', 'All')}<i class="cnt"></i></span>
<span class="chip" data-sev="crit">${t('Critique', 'Critical')}<i class="cnt"></i></span>
<span class="chip" data-sev="high">${t('Élevée', 'High')}<i class="cnt"></i></span>
<span class="chip" data-sev="med">${t('Moyenne', 'Medium')}<i class="cnt"></i></span>
</div>
<div class="spacer"></div>
<div class="searchwrap">${IC.search}<input type="text" id="search" placeholder="${t('Filtrer les résultats…', 'Filter results…')}" aria-label="${t('Filtrer les résultats', 'Filter results')}"></div>
<button id="viewMd" title="Markdown">${IC.file}Markdown</button>
<button id="copyMd" title="${t('Copier le rapport', 'Copy report')}">${IC.copy}${t('Copier', 'Copy')}</button>
<button id="dlMd" title="${t('Télécharger en Markdown', 'Download as Markdown')}">${IC.download}.md</button>
<button id="dlHtml" title="${t('Télécharger en HTML', 'Download as HTML')}">${IC.download}.html</button>
<a class="chip" href="/?lang=${lang === 'en' ? 'fr' : 'en'}" title="${t('Passer en anglais', 'Switch to French')}">${IC.globe}${lang === 'en' ? 'FR' : 'EN'}</a>
</div>
<div class="wrap">
<div class="askcard">
<div class="askhd">${IC.chat}<h2>${t('Pose une question sur ce projet', 'Ask anything about this project')}</h2></div>
<div class="askrow">
<textarea id="ask" rows="1" placeholder="${t('ex : où est gérée l\'authentification ? que risque un refactor de src/store.ts ?', 'e.g. where is auth handled? what breaks if I refactor src/store.ts?')}" aria-label="${t('Question sur le code', 'Question about the code')}"></textarea>
<button class="btn-acc" id="askBtn">${IC.wand}${t('Préparer le prompt', 'Build prompt')}</button>
</div>
<div class="hint">${t('Le prompt contient le code pertinent — colle-le dans ChatGPT, Claude ou Ollama.', 'The prompt carries the relevant code — paste it into ChatGPT, Claude or Ollama.')} <kbd>Ctrl</kbd>+<kbd>K</kbd> ${t('pour écrire', 'to focus')} · <kbd>Ctrl</kbd>+<kbd>Enter</kbd> ${t('pour générer', 'to build')}</div>
</div>
<div id="promptOut" class="hidden"><div class="prompthd"><h2>Prompt</h2><button id="copyBtn" class="act" style="width:auto">${IC.copy}${t('Copier', 'Copy')}</button></div><pre id="promptPre" class="big"></pre></div>
<div id="out"><div class="skel"><i></i><i></i><i></i><i></i></div></div>
</div>
</main>
<script>
const out = document.getElementById('out'), navList = document.getElementById('navList'), navGrp = document.getElementById('navGrp');
let curMd = '', curHtml = '', proj = '${esc(absPath).replace(/'/g, "\\'").replace(/\\/g, '\\\\')}', sevFilter = '', mdView = false, seq = 0;
const DEFAULT_PROJ = proj;
const LANG = '${lang}';
const qp = () => (proj ? '&project=' + encodeURIComponent(proj) : '') + '&lang=' + LANG;
const pushUrl = (st) => history.pushState(st, '', '?view=' + st.view + (st.file ? '&file=' + encodeURIComponent(st.file) : '') + (proj !== DEFAULT_PROJ ? '&project=' + encodeURIComponent(proj) : ''));
const escH = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const loading = () => { out.innerHTML = '<div class="skel"><i></i><i></i><i></i><i></i></div><div class="spin" style="padding-top:6px;font-size:12px">${t('analyse en cours', 'analysing')}…</div>'; };
async function call(url, st) {
  const my = ++seq;
  loading(); setActive(url); mdView = false;
  if (st) pushUrl(st);
  try {
    const r = await fetch(url); const j = await r.json();
    if (my !== seq) return;
    if (j.error) {
      out.innerHTML = '<div class="err">' + escH(j.error) + '</div>'
        + (j.candidates ? '<div class="chips">' + j.candidates.map(f => '<a class="fref chip2" data-f="' + escH(f) + '" href="#">' + escH(f) + '</a>').join('') + '</div>' : '');
      return;
    }
    curMd = j.md || ''; curHtml = j.standalone || '';
    document.getElementById('promptOut').classList.add('hidden');
    if (j.nav && j.nav.length) {
      navGrp.style.display = 'block';
      navList.innerHTML = j.nav.map(n => '<a href="#' + escH(n.id) + '">' + escH(n.title) + '</a>').join('');
    } else { navGrp.style.display = 'none'; navList.innerHTML = ''; }
    out.innerHTML = (j.hero || '') + (j.intro || '') + (j.body || j.text || '');
    if (j.hasBaseline === false && j.verdict) {
      const box = document.createElement('div');
      box.className = 'empty';
      box.innerHTML = '${t('Aucune baseline —', 'No baseline —')} <button class="act" id="mkBase" style="width:auto;display:inline-flex">${t('Créer la baseline', 'Create baseline')}</button>';
      out.insertBefore(box, out.firstChild);
      box.querySelector('#mkBase').onclick = async () => {
        box.querySelector('#mkBase').disabled = true;
        await fetch('/api/baseline?x=1' + qp());
        call('/api/check?x=1' + qp(), { view: 'check' });
      };
    }
    linkify(); filter(); spy(); sevCounts();
  } catch (e) { if (my !== seq) return; out.innerHTML = '<div class="err">' + escH(e.message) + '</div>'; }
}
function setActive(url) {
  document.querySelectorAll('button.act[data-a]').forEach(b => b.classList.toggle('on', url.includes('/api/' + b.dataset.a)));
}
const impactBox = document.getElementById('impactBox');
const runImpact = (f, push = true) => call('/api/impact?file=' + encodeURIComponent(f) + qp(), push ? { view: 'impact', file: f } : undefined);
document.querySelectorAll('button.act[data-a]').forEach(b => b.onclick = () => {
  const a = b.dataset.a;
  impactBox.classList.toggle('hidden', a !== 'impact');
  if (a === 'impact') { loadFiles(); loadChanged(); }
  if (a === 'check') call('/api/check?x=1' + qp(), { view: 'check' });
  if (a === 'audit') call('/api/audit?x=1' + qp(), { view: 'audit' });
  if (a === 'health') call('/api/health?x=1' + qp(), { view: 'health' });
  if (a === 'stats') call('/api/stats?x=1' + qp(), { view: 'stats' });
});
// Collapsible sections
out.addEventListener('click', e => {
  const h = e.target.closest('h2.coll');
  if (h) h.parentElement.classList.toggle('collapsed');
});
// File references → impact navigation (result rows, changed chips, <code> paths)
document.addEventListener('click', e => {
  const a = e.target.closest('a.fref');
  if (a && a.dataset.f) { e.preventDefault(); runImpact(a.dataset.f); }
});
// Turn <code>src/x.ts</code> mentions into impact links (code files only — impact needs the import graph)
const CODE_RE = /\\.(js|jsx|mjs|cjs|ts|tsx)$/i;
const SKIP_RE = /\\.(d\\.ts|test\\.ts|test\\.js|spec\\.ts|spec\\.js|config\\.js|config\\.ts|config\\.mjs)$/i;
function linkify() {
  out.querySelectorAll('code').forEach(c => {
    if (c.closest('a.fref')) return;
    const s = c.textContent.trim();
    if (/^[\\w@.\\-\\\\/]+\\.[a-z0-9]{1,5}$/i.test(s) && (s.includes('/') || s.includes('\\\\')) && CODE_RE.test(s) && !SKIP_RE.test(s) && !s.includes('.min.')) {
      const a = document.createElement('a');
      a.className = 'fref'; a.dataset.f = s; a.href = '#'; a.title = '${t('Voir l\u2019impact', 'See impact')}';
      c.replaceWith(a); a.appendChild(c);
    }
  });
}
// Impact file autocomplete + changed-file chips
let filesLoaded = false, changedLoaded = false;
async function loadFiles() {
  if (filesLoaded) return; filesLoaded = true;
  const p = proj;
  const r = await fetch('/api/files?x=1' + qp()); const j = await r.json();
  if (p !== proj) return;
  document.getElementById('fileList').innerHTML = (j.files || []).map(f => '<option value="' + f + '">').join('');
}
async function loadChanged() {
  if (changedLoaded) return; changedLoaded = true;
  const p = proj;
  const el = document.getElementById('chgChips');
  try {
    const r = await fetch('/api/changed?x=1' + qp()); const j = await r.json();
    if (p !== proj) return;
    el.innerHTML = j.ok && j.files.length
      ? '<span class="lbl">${t('MODIFIÉS vs HEAD — cliquer pour analyser', 'CHANGED vs HEAD — click to analyse')}</span>' + j.files.slice(0, 15).map(f => '<a class="fref chip2" data-f="' + escH(f) + '" href="#">' + escH(f) + '</a>').join('')
      : '';
  } catch {}
}
document.getElementById('ifile').addEventListener('focus', loadFiles);
document.getElementById('ifile').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('igo').click(); });
document.getElementById('igo').onclick = () => {
  const f = document.getElementById('ifile').value.trim();
  if (f) runImpact(f);
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
// Ctrl+K / Cmd+K — focus the question field (command-palette convention)
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    const a = document.getElementById('ask'); a.focus(); a.select();
  }
  if (e.key === '/' && !/input|textarea|select/i.test(document.activeElement.tagName)) {
    e.preventDefault();
    document.getElementById('search').focus();
  }
});
function setProj(v) {
  proj = v;
  filesLoaded = changedLoaded = false;
  document.getElementById('fileList').innerHTML = '';
  document.getElementById('chgChips').innerHTML = '';
  curMd = curHtml = '';
  document.getElementById('promptOut').classList.add('hidden');
  navList.innerHTML = ''; navGrp.style.display = 'none';
  const nm = document.querySelector('.brand .nm');
  const seg = v.split(/[\\\\/]/).filter(Boolean).pop() || v;
  if (nm) { nm.textContent = seg; nm.title = v; }
}
document.getElementById('pset').onclick = () => {
  const v = document.getElementById('proj').value.trim();
  if (v) { setProj(v); call('/api/audit?x=1' + qp(), { view: 'audit' }); }
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
  let vis = 0, total = 0;
  document.querySelectorAll('#out section').forEach(s => {
    total++;
    const okQ = !q || s.textContent.toLowerCase().includes(q);
    let visRows = 0;
    s.querySelectorAll('tr, li').forEach(r => {
      if (!r.querySelector('[class*="sev-"]')) { if (!sevFilter) r.style.display = ''; return; }
      const hit = !sevFilter || !!r.querySelector('.sev-' + sevFilter);
      r.style.display = hit ? '' : 'none';
      if (hit && sevFilter) visRows++;
    });
    const okS = !sevFilter || visRows > 0 || !!s.querySelector('.sev-' + sevFilter);
    s.style.display = okQ && okS ? '' : 'none';
    if (okQ && okS) vis++;
  });
  let empty = document.getElementById('noRes');
  if (total && !vis && !empty) {
    empty = document.createElement('div');
    empty.id = 'noRes'; empty.className = 'empty';
    empty.textContent = '${t('Aucune section ne correspond à ces filtres', 'No section matches these filters')}';
    out.appendChild(empty);
  } else if (vis && empty) empty.remove();
}
document.getElementById('search').oninput = filter;
// Severity counts on the filter chips
function sevCounts() {
  const counts = { '': 0, crit: 0, high: 0, med: 0 };
  document.querySelectorAll('#out .sev-crit, #out .sev-high, #out .sev-med').forEach(el => {
    counts['']++;
    if (el.classList.contains('sev-crit')) counts.crit++;
    if (el.classList.contains('sev-high')) counts.high++;
    if (el.classList.contains('sev-med')) counts.med++;
  });
  document.querySelectorAll('.chip[data-sev]').forEach(c => {
    const b = c.querySelector('.cnt');
    if (b) b.textContent = counts[c.dataset.sev] ?? 0;
  });
}
// Scroll-spy
let observer;
function spy() {
  if (observer) observer.disconnect();
  observer = new IntersectionObserver(es => {
    es.forEach(en => {
      if (en.isIntersecting) {
        navList.querySelectorAll('a').forEach(a => a.classList.toggle('cur', a.getAttribute('href') === '#' + en.target.id));
      }
    });
  }, { rootMargin: '-15% 0px -75% 0px' });
  document.querySelectorAll('#out section[id]').forEach(s => observer.observe(s));
}
// Restore view/file/project from the query string — hash stays for anchors.
function route() {
  const p = new URLSearchParams(location.search);
  const pr = (p.get('project') || '').trim();
  if (pr && pr !== proj) { document.getElementById('proj').value = pr; setProj(pr); }
  const v = p.get('view') || 'audit', f = (p.get('file') || '').trim();
  impactBox.classList.toggle('hidden', v !== 'impact');
  if (v === 'impact') {
    loadFiles(); loadChanged();
    if (f) { runImpact(f, false); return; }
  }
  call('/api/' + (['health', 'stats', 'check'].includes(v) ? v : 'audit') + '?x=1' + qp());
}
window.onpopstate = route;
route();
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
      if (u.pathname === '/api/check') {
        const report = await runCheck(target, { base: (u.searchParams.get('base') ?? 'HEAD').trim() || 'HEAD', lang: reqLang });
        const md = formatCheckMd(report, reqLang);
        const r = parseReportMd(md, project);
        const V = { red: '🔴', yellow: '🟡', green: '🟢' }[report.verdict];
        json(res, { title: r.title, intro: r.intro, nav: r.nav, body: r.body, md, verdict: report.verdict, hasBaseline: report.hasBaseline,
          standalone: reportToHtml(md, { project: target.split(/[\\/]/).pop() || 'project', generated: new Date().toISOString().slice(0, 10) }),
          hero: `<div class="rhero"><div style="font-size:34px;line-height:1">${V}</div><div><h1>${esc(r.title.replace(/^\p{Extended_Pictographic}\s*/u, ''))}</h1><div class="sub">${esc(target)}</div></div></div>` });
        return;
      }
      if (u.pathname === '/api/baseline') {
        const absT = await findProjectRoot(target).catch(() => target);
        const data = await collectAudit(absT);
        const b = await writeBaseline(absT, data, auditFindings(data, reqLang));
        json(res, { ok: true, findings: b.findings.length, score: b.score, head: b.head });
        return;
      }
      if (u.pathname === '/api/files') {
        const index = await getIndex(await findProjectRoot(target).catch(() => target), () => {});
        json(res, { files: Object.keys(index.files).sort() });
        return;
      }
      if (u.pathname === '/api/changed') {
        const s = await getChangedFiles(target, 'HEAD');
        json(res, { ok: s.ok, files: [...s.files].sort(), error: s.error });
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
          json(res, {
            error: r.candidates.length
              ? (reqLang === 'en' ? `Ambiguous — pick a candidate:` : `Ambigu — choisis un candidat :`)
              : (reqLang === 'en' ? `No code file matches "${file}"` : `Aucun fichier de code ne correspond à "${file}"`),
            candidates: r.candidates,
          });
          return;
        }
        const rep = r.report;
        const tt = (fr: string, en: string) => (reqLang === 'en' ? en : fr);
        const riskLabel = { low: tt('FAIBLE', 'LOW'), medium: tt('MOYEN', 'MEDIUM'), high: tt('ÉLEVÉ', 'HIGH') }[rep.risk];
        const riskCls = { low: 'sev-ok', medium: 'sev-med', high: 'sev-crit' }[rep.risk];
        const tags = [rep.isEntry ? tt('point d\u2019entrée', 'entry point') : '', rep.inCycle ? tt('dans un cycle de dépendances', 'in a dependency cycle') : ''].filter(Boolean).join(' · ');
        const depRows = rep.dependents.map(d =>
          `<tr><td>${d.depth}</td><td><a class="fref" data-f="${esc(d.file)}" href="#"><code>${esc(d.file)}</code></a></td></tr>`).join('')
          || `<tr><td colspan="2" class="dim-s">${tt('Aucun — rien n\u2019importe ce fichier.', 'None — nothing imports this file.')}</td></tr>`;
        const body = `<section><h2>${tt('Analyse d\u2019impact', 'Impact analysis')}</h2>
<p><strong>${tt('Cible', 'Target')} :</strong> <code>${esc(rep.target)}</code>${tags ? ` — <span class="dim-s">${esc(tags)}</span>` : ''}</p>
<div class="kpis"><div class="kpi"><div class="kv">${rep.directCount}</div><div class="kl">${tt('dépendants directs', 'direct dependents')}</div></div><div class="kpi"><div class="kv">${rep.dependents.length}/${rep.totalFiles}</div><div class="kl">${tt('rayon d\u2019impact', 'blast radius')}</div></div><div class="kpi"><div class="kv">${Math.round(rep.percent * 100)}%</div><div class="kl">${tt('du codebase', 'of codebase')}</div></div></div>
<p><strong>${tt('Risque', 'Risk')} :</strong> <span class="sev ${riskCls}">${riskLabel}</span> &nbsp;·&nbsp; <strong>${tt('Symboles exportés', 'Exports')} :</strong> ${rep.exportedSymbols.length ? rep.exportedSymbols.map(s => `<code>${esc(s.name)}</code>`).join(', ') : '—'}</p>
<h3>${tt('Fichiers dépendants — cliquer pour naviguer', 'Dependent files — click to navigate')}</h3>
<table><tr><th>${tt('Profondeur', 'Depth')}</th><th>${tt('Fichier', 'File')}</th></tr>${depRows}</table></section>`;
        json(res, { body, md: formatImpactReportMd(rep, reqLang) });
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
        const isCode = (p: string) => {
          const e = extname(p).toLowerCase();
          return CODE_EXTS.has(e) && !SKIP_EXTS.has(e) && !p.includes('.min.');
        };
        const fileRows = s.topFiles.map(f => `<tr><td>${isCode(f.path)
          ? `<a class="fref" data-f="${esc(f.path)}" href="#"><code>${esc(f.path)}</code></a>`
          : `<code>${esc(f.path)}</code> <span class="dim-s">${tt('(hors graphe d\u2019imports)', '(not in import graph)')}</span>`}</td><td>${fmt(f.tokens)}</td></tr>`).join('');
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
<h3>${tt('Fichiers les plus lourds — cliquer un fichier de code pour l\u2019impact', 'Heaviest files — click a code file for impact')}</h3>
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
        const result = await buildContext({ project: target, query: q, filePath: isFile ? q : undefined, searchQuery: mode === 'search' && !isFile ? q : undefined, lang: reqLang });
        if (result.noMatch) {
          json(res, { prompt: reqLang === 'en' ? `No code chunk matches "${q}" — nothing to send.` : `Aucun fragment ne correspond à « ${q} » — rien à envoyer.` });
          return;
        }
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
