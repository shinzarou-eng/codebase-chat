import { describe, it, expect, vi, afterEach } from 'vitest';
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { collectAudit } from '../src/report';
import { auditFindings } from '../src/findings';
import { readIgnores, addIgnore, removeIgnore, splitIgnored, isIgnored, IGNORES_REL } from '../src/ignores';
import { appendHistory, readHistory, HISTORY_REL } from '../src/history';
import { runCheck } from '../src/check';
import { analyzeImpact } from '../src/impact';
import { makeRepo } from './helpers';

afterEach(() => vi.unstubAllEnvs());

const repo = () => makeRepo({
  'src/a.ts': `export const a = 1;\n`,
  'src/b.ts': `import { a } from './a';\nexport const b = a + 1;\n`,
  'test/a.test.ts': `import { a } from '../src/a';\n`,
});

describe('ignores', () => {
  it('add/read/remove round-trip', async () => {
    const { dir, cleanup } = repo();
    try {
      const e = await addIgnore(dir, 'sec:innerHTML:src/x.ts', 'escaped via escH');
      expect(e?.reason).toBe('escaped via escH');
      expect(existsSync(join(dir, IGNORES_REL))).toBe(true);
      expect(await readIgnores(dir)).toHaveLength(1);
      expect(await addIgnore(dir, 'sec:innerHTML:src/x.ts', 'dup')).toBeNull();
      expect(await removeIgnore(dir, 'sec:innerHTML:src/x.ts')).toBe(true);
      expect(await readIgnores(dir)).toHaveLength(0);
      expect(await removeIgnore(dir, 'nope')).toBe(false);
    } finally { cleanup(); }
  });

  it('prefix key silences every matching finding id', async () => {
    const { dir, cleanup } = repo();
    try {
      const ignores = [{ id: 'sec:innerHTML:src/x.ts', reason: 'r', createdAt: '' }];
      expect(isIgnored('sec:innerHTML:src/x.ts:const a = 1', ignores)).toBe(true);
      expect(isIgnored('sec:innerHTML:src/y.ts:z', ignores)).toBe(false);
      const fs = [
        { id: 'sec:innerHTML:src/x.ts:s1', rule: 'sec:innerHTML', severity: 'Moyenne' as const, message: 'm' },
        { id: 'sec:innerHTML:src/y.ts:s2', rule: 'sec:innerHTML', severity: 'Moyenne' as const, message: 'm' },
      ];
      const { active, ignored } = splitIgnored(fs, ignores);
      expect(active).toHaveLength(1);
      expect(ignored[0].id).toContain('src/x.ts');
    } finally { cleanup(); }
  });

  it('an ignored finding does not drive the check verdict', async () => {
    const { dir, cleanup } = repo();
    try {
      const { writeBaseline } = await import('../src/baseline');
      // Baseline on the clean tree, then a NEW file with no dependents that
      // introduces an env-undoc finding - keeps impact low so the verdict is
      // driven by the finding alone.
      let data = await collectAudit(dir);
      await writeBaseline(dir, data, auditFindings(data, 'en'));
      writeFileSync(join(dir, 'src', 'newmod.ts'), `export const x = process.env.SECRET_X;\n`);

      const before = await runCheck(dir, { lang: 'en' });
      expect(before.verdict).toBe('yellow'); // env-undoc is Moyenne

      await addIgnore(dir, 'env-undoc:SECRET_X', 'documented elsewhere');
      const after = await runCheck(dir, { lang: 'en' });
      expect(after.ignored.some(f => f.id === 'env-undoc:SECRET_X')).toBe(true);
      expect(after.diff.added.find(f => f.id === 'env-undoc:SECRET_X')).toBeTruthy(); // still in diff…
      expect(after.verdict).toBe('green'); // …but out of the verdict
    } finally { cleanup(); }
  });
});

describe('check tests suggestion', () => {
  it('lists the dedicated spec and test importers for a changed file', async () => {
    const { dir, cleanup } = repo();
    try {
      writeFileSync(join(dir, 'src', 'a.ts'), `export const a = 2;\n`);
      const r = await runCheck(dir, { lang: 'en' });
      const cf = r.files.find(f => f.file === 'src/a.ts');
      expect(cf?.tests).toContain('test/a.test.ts');
    } finally { cleanup(); }
  });
});

describe('symbol impact', () => {
  it('bare symbol resolves to its exporter and scopes to real users', async () => {
    const { dir, cleanup } = repo();
    try {
      // Symbol name that no file path substring-matches.
      writeFileSync(join(dir, 'src', 'a.ts'), `export const meaningOfLife = 42;\n`);
      writeFileSync(join(dir, 'src', 'b.ts'), `import { meaningOfLife } from './a';\nexport const b = meaningOfLife + 1;\n`);
      const r = await analyzeImpact(dir, 'meaningOfLife');
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.report.target).toBe('src/a.ts');
        expect(r.report.symbol).toBe('meaningOfLife');
        expect(r.report.dependents.map(d => d.file)).toContain('src/b.ts');
      }
    } finally { cleanup(); }
  });

  it('file#symbol scopes the radius to files referencing the symbol', async () => {
    const { dir, cleanup } = repo();
    try {
      // c.ts imports b but never mentions `a`.
      writeFileSync(join(dir, 'src', 'c.ts'), `import { b } from './b';\nexport const c = b + 1;\n`);
      const r = await analyzeImpact(dir, 'src/a.ts#a');
      expect(r.ok).toBe(true);
      if (r.ok) {
        const files = r.report.dependents.map(d => d.file);
        expect(files).toContain('src/b.ts');
        // c.ts doesn't reference `a` - only reachable through b (depth 2 via b).
        expect(files).toContain('src/c.ts');
        const cDep = r.report.dependents.find(d => d.file === 'src/c.ts');
        expect(cDep!.depth).toBe(2);
      }
    } finally { cleanup(); }
  });
});

describe('history', () => {
  it('append + read round-trip, newest last', async () => {
    const { dir, cleanup } = repo();
    try {
      await appendHistory(dir, { ts: '2026-01-01T00:00:00Z', base: 'HEAD', verdict: 'green', score: 70, changed: 1, added: 0, resolved: 0 });
      await appendHistory(dir, { ts: '2026-01-02T00:00:00Z', base: 'HEAD', verdict: 'red', score: 65, changed: 3, added: 2, resolved: 1 });
      expect(existsSync(join(dir, HISTORY_REL))).toBe(true);
      const h = await readHistory(dir);
      expect(h).toHaveLength(2);
      expect(h[1].verdict).toBe('red');
      expect(h[1].score).toBe(65);
    } finally { cleanup(); }
  });
});
