import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getIndex } from '../src/indexer';

afterEach(() => vi.unstubAllEnvs());

describe('indexer freshness', () => {
  it('reindexes when a file is added after the first index', async () => {
    const proj = mkdtempSync(join(tmpdir(), 'dsh-idx-proj-'));
    const cache = mkdtempSync(join(tmpdir(), 'dsh-idx-cache-'));
    vi.stubEnv('CODEBASE_CACHE_DIR', cache);
    try {
      writeFileSync(join(proj, 'a.ts'), 'export const a = 1;\n');
      const first = await getIndex(proj);
      expect(Object.keys(first.files)).toEqual(['a.ts']);
      writeFileSync(join(proj, 'b.ts'), 'export const b = 2;\n');
      const second = await getIndex(proj);
      expect(Object.keys(second.files).sort()).toEqual(['a.ts', 'b.ts']);
    } finally {
      rmSync(proj, { recursive: true, force: true });
      rmSync(cache, { recursive: true, force: true });
    }
  });
});
