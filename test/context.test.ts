import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildContext } from '../src/context';
import { countTokens } from '../src/tokenizer';

afterEach(() => vi.unstubAllEnvs());

function makeProject(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-ctx-'));
  const cache = mkdtempSync(join(tmpdir(), 'dsh-ctx-cache-'));
  vi.stubEnv('CODEBASE_CACHE_DIR', cache);
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'tmp-ctx', version: '0.0.1' }));
  // Enough files that the raw tree alone would exceed a small budget.
  for (let i = 0; i < 60; i++) {
    writeFileSync(
      join(dir, 'src', `mod${i}.ts`),
      `export function handler${i}(x: number) {\n  const y = x * ${i};\n  if (y > 10) return y - ${i};\n  return y + ${i};\n}\n`
    );
  }
  return { dir, cleanup: () => { rmSync(dir, { recursive: true, force: true }); rmSync(cache, { recursive: true, force: true }); } };
}

describe('buildContext token budget', () => {
  it('honours a small maxTokens — the tree cannot blow the budget alone', async () => {
    const { dir, cleanup } = makeProject();
    try {
      const r = await buildContext({ project: dir, query: 'handler', maxTokens: 1000, lang: 'en' });
      expect(countTokens(r.context)).toBeLessThanOrEqual(1050);
    } finally { cleanup(); }
  });

  it('fills a larger budget with real code chunks', async () => {
    const { dir, cleanup } = makeProject();
    try {
      const r = await buildContext({ project: dir, query: 'handler', maxTokens: 8000, lang: 'en' });
      expect(r.chunks.length).toBeGreaterThan(0);
      expect(countTokens(r.context)).toBeLessThanOrEqual(8100);
      expect(r.context).toContain('handler');
    } finally { cleanup(); }
  });
});
