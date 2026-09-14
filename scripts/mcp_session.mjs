// Real MCP stdio session against mcp/index.mjs, printed as a readable transcript.
// Used by scripts/render_demo.py to generate docs/assets/demo-mcp.gif.
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = spawn('node', [join(ROOT, 'mcp', 'index.mjs')], {
  env: { ...process.env, DEEPSEEK_API_KEY: '', OPENAI_API_KEY: '' },
});
const send = (o) => server.stdin.write(JSON.stringify(o) + '\n');
const out = (s) => console.log(s);

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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  out('# no API key configured — promptOnly mode');
  await wait(300);

  out('→ initialize');
  await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'cursor', version: '1.0' } } });
  out('← server ready: codebase-chat-mcp');
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  await wait(150);

  out('→ tools/list');
  const list = await call({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const names = list.result.tools.map((t) => t.name);
  out(`← ${names.length} tools: ${names.join(', ')}`);
  await wait(150);

  out(`→ tools/call codebase_chat { projectPath: "demo-project", query: "how is auth handled?", promptOnly: true, lang: "en" }`);
  const res = await call({
    jsonrpc: '2.0', id: 3, method: 'tools/call',
    params: { name: 'codebase_chat', arguments: { projectPath: 'demo-project', query: 'how is auth handled?', promptOnly: true, lang: 'en' } },
  });
  const text = res.result.content[0].text;
  const lines = text.split('\n');
  out(`← prompt assembled: ${text.length.toLocaleString('en')} chars — returned to host model, zero API key`);
  out('');
  for (const l of lines.slice(-9)) out(l);
  await wait(150);

  out(`→ tools/call codebase_health { projectPath: "demo-project", lang: "en" }`);
  const hres = await call({
    jsonrpc: '2.0', id: 4, method: 'tools/call',
    params: { name: 'codebase_health', arguments: { projectPath: 'demo-project', lang: 'en' } },
  });
  out('← deterministic report — no LLM call:');
  for (const l of hres.result.content[0].text.split('\n').slice(0, 7)) out(l);
  server.kill();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
