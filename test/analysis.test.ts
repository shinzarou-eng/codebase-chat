import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzeProject, formatHealthReport, isTestPath } from '../src/analysis.js';

let dir: string;

const FILES: Record<string, string> = {
  'package.json': JSON.stringify({ name: 'fixture', main: 'src/index.ts' }),
  'src/index.ts': `import { a } from './a';\nexport const start = a;\n`,
  // circular: a -> b -> a
  'src/a.ts': `import { b } from './b';\nexport function a() { return b(); }\n`,
  'src/b.ts': `import { a } from './a';\nexport function b() { return a(); }\n`,
  // dead file (never imported, not an entry point)
  'src/dead.ts': `export function neverUsed() { return 1; }\n`,
  // file with an unused export
  'src/util.ts': `export function usedHelper() { return 2; }\nexport function orphanHelper() { return 3; }\n`,
  'src/consumer.ts': `import { usedHelper } from './util';\nexport const v = usedHelper();\n`,
  // complex file (many branches)
  'src/complex.ts': `export function gnarly(x: number) {\n${'  if (x > 1 && x < 10 || x === 0) { x++; } else if (x < 0) { x--; }\n'.repeat(6)}  while (x > 100) { x -= 10; }\n  switch (x) { case 1: break; case 2: break; default: break; }\n  return x > 0 ? x : -x;\n}\n`,
  // duplicated block in two files
  'src/dup1.ts': `export function dupOne() {\n  const a = normalize(input);\n  const b = validate(a);\n  const c = transform(b);\n  const d = persist(c);\n  const e = notify(d);\n  return finalize(e);\n}\n`,
  'src/dup2.ts': `export function dupTwo() {\n  const a = normalize(input);\n  const b = validate(a);\n  const c = transform(b);\n  const d = persist(c);\n  const e = notify(d);\n  return finalize(e);\n}\n`,
};

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-analysis-'));
  for (const [rel, content] of Object.entries(FILES)) {
    const full = join(dir, rel);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content);
  }
});

afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

describe('analyzeProject', () => {
  it('detects circular dependencies', async () => {
    const r = await analyzeProject(dir);
    const flat = r.cycles.flatMap(c => c.path).join(' ');
    expect(flat).toContain('a.ts');
    expect(flat).toContain('b.ts');
  });

  it('flags unused files', async () => {
    const r = await analyzeProject(dir);
    expect(r.unusedFiles).toContain('src/dead.ts');
    expect(r.unusedFiles).not.toContain('src/index.ts');
  });

  it('flags unused exports but keeps referenced ones', async () => {
    const r = await analyzeProject(dir);
    const names = r.unusedExports.map(e => e.name);
    expect(names).toContain('orphanHelper');
    expect(names).toContain('neverUsed');
    expect(names).not.toContain('usedHelper');
  });

  it('detects duplicated blocks across files', async () => {
    const r = await analyzeProject(dir);
    const files = r.duplicates.flatMap(d => d.files);
    expect(files).toContain('src/dup1.ts');
    expect(files).toContain('src/dup2.ts');
  });

  it('ranks complex files as hotspots', async () => {
    const r = await analyzeProject(dir);
    expect(r.hotspots.some(h => h.file === 'src/complex.ts')).toBe(true);
  });

  it('computes a health score and grade', async () => {
    const r = await analyzeProject(dir);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(['A', 'B', 'C', 'D', 'E']).toContain(r.grade);
  });

  it('formats a readable bilingual report', async () => {
    const r = await analyzeProject(dir);
    const fr = formatHealthReport(r, 'fr');
    const en = formatHealthReport(r, 'en');
    expect(fr).toContain('ANALYSE STATIQUE');
    expect(en).toContain('STATIC ANALYSIS');
    expect(en).toContain('Circular dependencies');
  });
});

describe('isTestPath', () => {
  it('matches dir segments and filename conventions', () => {
    expect(isTestPath('test/a.test.ts')).toBe(true);
    expect(isTestPath('src/__tests__/a.ts')).toBe(true);
    expect(isTestPath('src/a.spec.ts')).toBe(true);
    expect(isTestPath('foo_test.go')).toBe(true);
    expect(isTestPath('tests/e2e.ts')).toBe(true);
  });
  it('never treats a substring inside a real name as a test', () => {
    expect(isTestPath('src/latest.ts')).toBe(false);
    expect(isTestPath('src/contest.ts')).toBe(false);
    expect(isTestPath('src/spectacle.ts')).toBe(false);
    expect(isTestPath('src/protest.ts')).toBe(false);
  });
});
