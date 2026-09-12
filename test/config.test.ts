import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadProjectConfig, clearConfigCache, globToRegExp, matchesAnyGlob } from '../src/config.js';
import { getWalkOptions, walkFiles } from '../src/project.js';
import { buildContext } from '../src/context.js';

let dir: string;

const FILES: Record<string, string> = {
  '.codebase-chat.json': JSON.stringify({
    lang: 'en',
    maxTokens: 1234,
    ignoreDirs: ['generated'],
    ignoreFiles: ['secret.ts'],
    ignoreGlobs: ['src/vendor/**'],
    protectedPaths: ['src/locked'],
    junk: 'ignored',
    lang2: 'es',
  }),
  'src/index.ts': `export const start = 1;\n`,
  'src/secret.ts': `export const s = 2;\n`,
  'src/vendor/lib.ts': `export const v = 3;\n`,
  'generated/gen.ts': `export const g = 4;\n`,
};

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-config-'));
  for (const [rel, content] of Object.entries(FILES)) {
    const full = join(dir, rel);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content);
  }
});

afterAll(async () => {
  clearConfigCache();
  await rm(dir, { recursive: true, force: true });
});

describe('loadProjectConfig', () => {
  it('reads and validates .codebase-chat.json', async () => {
    const cfg = await loadProjectConfig(dir);
    expect(cfg.lang).toBe('en');
    expect(cfg.maxTokens).toBe(1234);
    expect(cfg.ignoreDirs).toEqual(['generated']);
    expect(cfg.ignoreFiles).toEqual(['secret.ts']);
    expect(cfg.ignoreGlobs).toEqual(['src/vendor/**']);
    expect(cfg.protectedPaths).toEqual(['src/locked']);
  });

  it('returns defaults when the file is missing', async () => {
    const cfg = await loadProjectConfig(join(dir, 'does-not-exist'));
    expect(cfg).toEqual({});
  });

  it('returns defaults when the file is malformed', async () => {
    const bad = await mkdtemp(join(tmpdir(), 'dsh-config-bad-'));
    await writeFile(join(bad, '.codebase-chat.json'), '{ not json');
    const cfg = await loadProjectConfig(bad);
    expect(cfg).toEqual({});
    await rm(bad, { recursive: true, force: true });
  });
});

describe('globToRegExp / matchesAnyGlob', () => {
  it('** spans directories', () => {
    expect(matchesAnyGlob('gen/a/b.ts', ['gen/**'])).toBe(true);
    expect(matchesAnyGlob('gen/a.ts', ['gen/**'])).toBe(true);
    expect(matchesAnyGlob('src/a.ts', ['gen/**'])).toBe(false);
  });

  it('* matches within one segment', () => {
    expect(matchesAnyGlob('gen/a.ts', ['gen/*'])).toBe(true);
    expect(matchesAnyGlob('gen/a/b.ts', ['gen/*'])).toBe(false);
  });

  it('? matches a single char and dots are literal', () => {
    expect(matchesAnyGlob('a1.ts', ['a?.ts'])).toBe(true);
    expect(matchesAnyGlob('axts', ['a?.ts'])).toBe(false);
  });

  it('handles leading-dot patterns and spaces', () => {
    expect(matchesAnyGlob('.env', ['.*'])).toBe(true);
    expect(matchesAnyGlob('src/.env', ['.*'])).toBe(true);
    expect(matchesAnyGlob('my dir/x.ts', ['my dir/*'])).toBe(true);
    expect(matchesAnyGlob('other/x.ts', ['my dir/*'])).toBe(false);
  });

  it('globToRegExp anchors the match', () => {
    expect(globToRegExp('*.ts').test('a.ts')).toBe(true);
    expect(globToRegExp('*.ts').test('a.ts.bak')).toBe(false);
  });
});

describe('walk options + walkFiles', () => {
  it('merges config ignores into the skip sets', async () => {
    const opts = await getWalkOptions(dir);
    expect(opts.skipDirs.has('node_modules')).toBe(true);
    expect(opts.skipDirs.has('generated')).toBe(true);
    expect(opts.skipFiles.has('secret.ts')).toBe(true);
    expect(opts.ignoreGlobs).toEqual(['src/vendor/**']);
  });

  it('walkFiles respects ignoreDirs, ignoreFiles and ignoreGlobs', async () => {
    const opts = await getWalkOptions(dir);
    const found: string[] = [];
    for await (const f of walkFiles(dir, opts.skipDirs, opts.skipFiles, opts.ignoreGlobs)) {
      found.push(f);
    }
    const names = found.map(f => f.replace(/\\/g, '/'));
    expect(names.some(n => n.endsWith('src/index.ts'))).toBe(true);
    expect(names.some(n => n.includes('generated/'))).toBe(false);
    expect(names.some(n => n.endsWith('secret.ts'))).toBe(false);
    expect(names.some(n => n.includes('vendor/'))).toBe(false);
  });
});

describe('buildContext config defaults', () => {
  it('uses lang and maxTokens from .codebase-chat.json', async () => {
    const result = await buildContext({ project: dir, query: 'start' });
    expect(result.context).toContain('Answer in English.');
    expect(result.tokenCount).toBeLessThanOrEqual(1234);
  });

  it('explicit options still win over config', async () => {
    const result = await buildContext({ project: dir, query: 'start', lang: 'fr' });
    expect(result.context).toContain('en français');
  });
});
