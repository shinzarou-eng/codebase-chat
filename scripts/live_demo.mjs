// Démo live : session MCP stdio réelle sur un projet passé en argument.
// Usage : node scripts/live_demo.mjs C:\path\to\project
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const project = process.argv[2] ?? process.cwd();
const serverPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'mcp', 'index.mjs');

const srv = spawn('node', [serverPath], { cwd: project, stdio: ['pipe', 'pipe', 'inherit'] });
let buf = '';
const pending = new Map();
srv.stdout.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const l = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!l.trim()) continue;
    const m = JSON.parse(l);
    if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  }
});
const send = (id, method, params) => {
  console.log(`\n\x1b[36m→ ${method}\x1b[90m ${JSON.stringify(params ?? {}).slice(0, 140)}\x1b[0m`);
  return new Promise((r) => { pending.set(id, r); srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
};

await send(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'live-demo', version: '1' } });
console.log('\x1b[32m← server ready\x1b[0m');
srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

const tools = await send(2, 'tools/list', {});
console.log(`\x1b[32m←\x1b[0m ${tools.result.tools.length} tools: ${tools.result.tools.map((t) => t.name).join(', ')}`);

let t = Date.now();
const r = await send(3, 'tools/call', { name: 'codebase_impact', arguments: { projectPath: project, file: process.argv[3] ?? 'playerStore.ts', lang: 'fr' } });
console.log(`\x1b[90m  done in ${((Date.now() - t) / 1000).toFixed(1)}s\x1b[0m\n`);
console.log(r.result?.content?.[0]?.text?.split('<details>')[0] ?? JSON.stringify(r));

srv.kill();
process.exit(0);
