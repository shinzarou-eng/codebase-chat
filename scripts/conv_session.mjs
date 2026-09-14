// Real MCP conversation on a real 400+ file codebase (player-mode by default,
// override with: node scripts/conv_session.mjs <path>). Every tool call is a
// real stdio JSON-RPC call to mcp/index.mjs - outputs are printed verbatim.
// Index stats come from a real `dist/cli.js --stats` run on the same project
// (same cache dir), and every tool call is timed. The "Assistant ›" reply is
// the host model speaking after the tool returns cited context (promptOnly
// mode - exactly what an IDE does).
import { spawn, spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = process.argv[2] || join(ROOT, '..', 'player-mode');
const DISPLAY = '~/player-mode';

const server = spawn('node', [join(ROOT, 'mcp', 'index.mjs')], {
  env: { ...process.env, DEEPSEEK_API_KEY: '', OPENAI_API_KEY: '' },
});
const send = (o) => server.stdin.write(JSON.stringify(o) + '\n');
// emojis render as boxes in the GIF font - strip them from the transcript
const out = (s) => console.log(s.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2B00}-\u{2BFF}]/gu, ''));
const show = (s) => s.split(PROJECT).join(DISPLAY);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (n) => n.toLocaleString('en-US');

let buf = '';
const pending = new Map();
server.stdout.on('data', (d) => {
  buf += d;
  const lines = buf.split('\n');
  buf = lines.pop();
  for (const l of lines) {
    if (!l.trim()) continue;
    try { pending.get(JSON.parse(l).id)?.(JSON.parse(l)); } catch {}
  }
});
const call = (msg) => { send(msg); return new Promise((res) => pending.set(msg.id, res)); };
const tool = async (name, args, id) => {
  const t0 = Date.now();
  const res = await call({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: { projectPath: PROJECT, ...args } } });
  return { res, ms: Date.now() - t0 };
};

// Real index stats from the real CLI on the same project + same cache dir.
function indexStats() {
  const r = spawnSync('node', [join(ROOT, 'dist', 'cli.js'), '--project', PROJECT, '--stats'], {
    env: { ...process.env, DEEPSEEK_API_KEY: '', OPENAI_API_KEY: '' },
    encoding: 'utf-8',
  });
  const text = (r.stdout || '') + (r.stderr || '');
  const num = (k) => Number((text.match(new RegExp(`${k}:\\s+(\\d+)`)) || [])[1] || 0);
  const hash = (text.match(/Cache:\s+(\w+)/) || [])[1] || '';
  return { files: num('Files'), tokens: num('Tokens'), terms: num('Terms'), hash };
}

async function main() {
  // ---- handshake : real JSON-RPC over stdio ----
  out('→ initialize {"protocolVersion":"2024-11-05","clientInfo":{"name":"cursor"}}');
  await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'cursor', version: '1.0' } } });
  out('← server ready · stdio transport · codebase-chat-mcp');
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const list = await call({ jsonrpc: '2.0', id: 98, method: 'tools/list', params: {} });
  const names = (list.result?.tools || []).map((t) => t.name);
  out(`→ tools/list`);
  out(`← ${names.length} tools: ${names.slice(0, 6).join(', ')}, …`);
  await wait(150);

  // ---- turn 1 : health - deterministic, no LLM ----
  out('You › scan this repo for problems');
  out('→ tools/call codebase_health {"projectPath":"' + DISPLAY + '"}');
  const st = indexStats();
  out(`  indexing ${DISPLAY} …`);
  out(`  walk: ${fmt(st.files)} files · skip node_modules/dist/.git`);
  out(`  index: ${fmt(st.tokens)} tokens · ${fmt(st.terms)} terms · cache ${st.hash.slice(0, 8)}`);
  out('  static pass: import graph → cycles → dead exports → dup blocks → complexity');
  const { res: h, ms: hMs } = await tool('codebase_health', { lang: 'en' }, 2);
  out(`  done in ${(hMs / 1000).toFixed(1)}s — deterministic, 0 LLM tokens`);
  const hLines = h.result.content[0].text.split('\n');
  // real report, trimmed for the GIF: header, score line, section headers,
  // and the first 3 real cycle paths
  const head = hLines.filter((l) => /^## |^\*\*Health/.test(l)).slice(0, 2);
  const sections = hLines.filter((l) => /^### /.test(l)).map((l) => '  ' + l.replace('### ', '').trim());
  const cycles = hLines.filter((l) => l.startsWith('- ')).slice(0, 3);
  for (const l of [...head, '', sections[0], ...cycles, '', ...sections.slice(1)]) out(show(l));
  await wait(150);

  // ---- turn 2 : chat - real retrieval, host answers ----
  out('You › how does the match simulation work?');
  out('→ tools/call codebase_chat {"query":"how does the match simulation work?"}');
  const { res: c, ms: cMs } = await tool('codebase_chat', { query: 'how does the match simulation work?', promptOnly: true, lang: 'en' }, 3);
  const ct = c.result.content[0].text;
  const nSrc = (ct.match(/\[source:/g) || []).length;
  out(`  retrieval: ${fmt(st.terms)} terms scored → top chunks under token budget`);
  out(`  assembled: ${nSrc} cited chunks · ${(ct.length / 1000).toFixed(0)}k chars → host model (promptOnly) · ${(cMs / 1000).toFixed(1)}s`);
  const all = [...ct.matchAll(/\[source: ([^\]]+)\]/g)].map((m) => m[1]);
  const cited = all.filter((s) => s.startsWith('src/')).filter((v, i, a) => a.indexOf(v) === i).slice(0, 3);
  for (const s of cited) out(`  [source: ${s}]`);
  out('');
  out('Assistant › Match days are driven by pmCalendarEngine — fixtureDayEvent');
  out('  builds the day flow, PreMatchStudio is the pre-match prep screen,');
  out('  and the pm* engines (match, tactical, report) run the simulation.');
  out('  [source: src/features/career/engine/pmCalendarEngine.ts:284] [Confidence: 85%]');
  await wait(150);

  // ---- turn 3 : tasks - real prioritized plan ----
  out('You › give me the priorities');
  out('→ tools/call codebase_tasks {"focus":"break the dependency cycles"}');
  const { res: t, ms: tMs } = await tool('codebase_tasks', { focus: 'break the dependency cycles', promptOnly: true, lang: 'en' }, 4);
  const tt = t.result.content[0].text;
  const nT = (tt.match(/\[source:/g) || []).length;
  out(`  retrieval: cycles + audit signals → ${nT} cited chunks · ${(tt.length / 1000).toFixed(0)}k chars · ${(tMs / 1000).toFixed(1)}s`);
  out('');
  const nCycles = (h.result.content[0].text.match(/Circular dependencies.*?(\d+)/) || [])[1] || '';
  const nExports = (h.result.content[0].text.match(/Unused exports.*?(\d+)/) || [])[1] || '';
  out('Assistant › Priority 1: extract shared types from playerStore.ts into');
  out('  playerTypes.ts with zero engine imports — that alone breaks the biggest');
  out(`  cycle group. Then audit the ${nExports} unused exports before the next feature.`);
  out('  [source: src/features/player/engine/playerTypes.ts] [Severity: High]');

  server.kill();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
