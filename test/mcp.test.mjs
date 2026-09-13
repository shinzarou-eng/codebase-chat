import { describe, it, expect, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const cache = mkdtempSync(join(tmpdir(), 'dsh-mcp-test-'));
afterAll(() => rmSync(cache, { recursive: true, force: true }));

// Minimal JSON-RPC client over the server stdio.
function rpc(calls) {
  return new Promise((resolve, reject) => {
    const srv = spawn(process.execPath, [join(ROOT, '..', 'mcp', 'index.mjs')], {
      cwd: ROOT,
      env: { ...process.env, CODEBASE_CACHE_DIR: cache },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let buf = '';
    const responses = [];
    const pending = [...calls];
    srv.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        try {
          const m = JSON.parse(line);
          if (m.id !== undefined) {
            responses.push(m);
            const next = pending[responses.length - 1];
            if (next) srv.stdin.write(JSON.stringify(next) + '\n');
            else { srv.kill(); resolve(responses); }
          }
        } catch { /* non-JSON noise */ }
      }
    });
    srv.on('error', reject);
    setTimeout(() => { srv.kill(); reject(new Error(`mcp test timed out — got ${responses.length}/${calls.length} responses`)); }, 25_000);
    const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } } };
    srv.stdin.write(JSON.stringify(init) + '\n');
    srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  });
}

describe('mcp server protocol', () => {
  it('prompts/get ignore returns real text (was an empty block)', async () => {
    const [init, get] = await rpc([
      { jsonrpc: '2.0', id: 2, method: 'prompts/get', params: { name: 'ignore', arguments: { action: 'list' } } },
      { jsonrpc: '2.0', id: 3, method: 'prompts/list', params: {} },
    ]);
    expect(init.result?.serverInfo?.name).toBeTruthy();
    const text = get.result?.messages?.[0]?.content?.text;
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(0);
  }, 25_000);

  it('the check prompt exposes the `base` argument', async () => {
    const [init, list] = await rpc([
      { jsonrpc: '2.0', id: 2, method: 'prompts/list', params: {} },
      { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} },
    ]);
    const prompts = list.result?.prompts ?? [];
    const check = prompts.find((p) => p.name === 'check');
    expect(check?.arguments?.some((a) => a.name === 'base')).toBe(true);
    const ignore = prompts.find((p) => p.name === 'ignore');
    expect(ignore?.arguments?.some((a) => a.name === 'reason')).toBe(true);
  }, 25_000);
});
