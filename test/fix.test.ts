import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { collectAudit } from '../src/report';
import { auditFindings } from '../src/findings';
import { planFixes, applyFixes } from '../src/fix';

afterEach(() => vi.unstubAllEnvs());

const GIT = (dir: string, args: string[]) =>
  execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });

// One fixture carrying every fixable smell: undocumented env var, dead dep,
// unused exports, standalone console/debugger lines — plus a console line with
// trailing code that must NOT be deleted.
function makeRepo(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-fix-'));
  const cache = mkdtempSync(join(tmpdir(), 'dsh-fix-cache-'));
  vi.stubEnv('CODEBASE_CACHE_DIR', cache);
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'app.ts'), [
    `export const used = 1;`,
    `export const deadSingle = 3;`,
    `export function orphan() {`,
    `  return 2;`,
    `}`,
    `console.log('leftover');`,
    `const keep = () => 1; console.log('inline');`,
    `debugger;`,
    `export const v = process.env.SECRET_THING;`,
    ``,
  ].join('\n'));
  writeFileSync(join(dir, 'src', 'uses.ts'), `import { used, v } from './app';\nexport const u = used + String(v);\n`);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'tmp-fix', version: '0.0.1', dependencies: { 'left-pad': '1.0.0' },
  }));
  try {
    GIT(dir, ['init']);
    GIT(dir, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A']);
    GIT(dir, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'init']);
  } catch { /* git unavailable */ }
  return { dir, cleanup: () => { rmSync(dir, { recursive: true, force: true }); rmSync(cache, { recursive: true, force: true }); } };
}

describe('fix', () => {
  it('plans a fix for every mechanically repairable finding', async () => {
    const { dir, cleanup } = makeRepo();
    try {
      const findings = auditFindings(await collectAudit(dir), 'en');
      const fixes = planFixes(findings, 'en');
      const rules = fixes.map(f => f.finding.rule);
      expect(rules).toContain('env-undoc');
      expect(rules).toContain('dead-dep');
      expect(rules).toContain('unused-export');
      expect(rules).toContain('smell:debugger');
      expect(rules).toContain('smell:console');
    } finally { cleanup(); }
  });

  it('applies fixes and the re-audit proves the findings are gone', async () => {
    const { dir, cleanup } = makeRepo();
    try {
      const before = auditFindings(await collectAudit(dir), 'en');
      const fixes = planFixes(before, 'en');
      const { applied, skipped, failed } = await applyFixes(dir, fixes);
      expect(failed).toHaveLength(0);
      expect(applied.length).toBeGreaterThan(0);
      // The console call sharing its line with other code is not standalone —
      // reported as skipped, never silently "applied".
      expect(skipped.map(f => f.finding.id)).toEqual(
        expect.arrayContaining([expect.stringMatching(/^smell:console:/)]));

      const envEx = readFileSync(join(dir, '.env.example'), 'utf8');
      expect(envEx).toContain('SECRET_THING=');
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      expect(pkg.dependencies['left-pad']).toBeUndefined();
      const app = readFileSync(join(dir, 'src', 'app.ts'), 'utf8');
      expect(app).not.toContain('deadSingle');
      expect(app).not.toContain('debugger');
      expect(app).not.toContain(`console.log('leftover')`);
      // A console call sharing its line with other code is left alone.
      expect(app).toContain(`console.log('inline')`);
      // Multi-line decl: the whole block is deleted, not left as dead code.
      expect(app).not.toContain('orphan');

      const after = auditFindings(await collectAudit(dir), 'en');
      const afterIds = new Set(after.map(f => f.id));
      for (const f of applied) expect(afterIds.has(f.finding.id)).toBe(false);
    } finally { cleanup(); }
  });

  it('is idempotent — re-applying leaves no duplicates', async () => {
    const { dir, cleanup } = makeRepo();
    try {
      const findings = auditFindings(await collectAudit(dir), 'en');
      const envFix = planFixes(findings, 'en').find(f => f.finding.rule === 'env-undoc')!;
      await envFix.apply(dir);
      await envFix.apply(dir);
      const envEx = readFileSync(join(dir, '.env.example'), 'utf8');
      expect(envEx.match(/SECRET_THING=/g)).toHaveLength(1);
    } finally { cleanup(); }
  });

  it('does not crash when the target line has drifted', async () => {
    const { dir, cleanup } = makeRepo();
    try {
      const findings = auditFindings(await collectAudit(dir), 'en');
      const dbg = planFixes(findings, 'en').find(f => f.finding.rule === 'smell:debugger')!;
      writeFileSync(join(dir, 'src', 'app.ts'), `export const used = 1;\n`);
      // The line no longer matches the standalone pattern → silently skipped.
      await dbg.apply(dir);
      expect(readFileSync(join(dir, 'src', 'app.ts'), 'utf8')).toContain('used');
    } finally { cleanup(); }
  });
});
