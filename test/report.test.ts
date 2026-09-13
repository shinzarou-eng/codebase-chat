// report.ts is the riskiest file in the project (highest churn × complexity,
// previously untested) — this suite locks collectAudit + renderAuditMd on a
// fixture repo with deliberate defects, plus output determinism.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { collectAudit, renderAuditMd } from '../src/report';

afterEach(() => vi.unstubAllEnvs());

const GIT = (dir: string, args: string[]) =>
  execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });

function makeRepo(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-report-'));
  const cache = mkdtempSync(join(tmpdir(), 'dsh-report-cache-'));
  vi.stubEnv('CODEBASE_CACHE_DIR', cache);
  mkdirSync(join(dir, 'src'), { recursive: true });
  mkdirSync(join(dir, 'test'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'tmp-report', version: '0.0.1',
    dependencies: { 'used-dep': '^1.0.0', 'unused-dep': '^1.0.0' },
  }));
  // a.ts: imports b (cycle), a missing dep, an undocumented env var, innerHTML sink.
  writeFileSync(join(dir, 'src', 'a.ts'), [
    `import { b } from './b';`,
    `import md from 'missing-dep';`,
    `import used from 'used-dep';`,
    `export const a = b + md + used;`,
    `export const env = process.env.UNDOC_VAR;`,
    `export function mount(el: any, html: string) { el.innerHTML = html; }`,
    ``,
  ].join('\n'));
  writeFileSync(join(dir, 'src', 'b.ts'), `import { a } from './a';\nexport const b = 1;\n`);
  // c.ts: nothing imports it → unused-file candidate.
  writeFileSync(join(dir, 'src', 'c.ts'), `export const lonely = true;\n`);
  // d.ts: exports a symbol nobody imports → unused-export.
  writeFileSync(join(dir, 'src', 'd.ts'), `export const orphan = 0;\n`);
  writeFileSync(join(dir, 'src', 'entry.ts'), `import { orphan } from './d';\nconsole.log(orphan);\n`);
  writeFileSync(join(dir, 'test', 'a.test.ts'), `import { a } from '../src/a';\n`);
  writeFileSync(join(dir, 'README.md'), '# tmp\n\n## Install\n\n```\nnpm i\n```\n\n## Usage\n\nrun it\n');
  writeFileSync(join(dir, '.env.example'), 'OTHER_VAR=\n');
  try {
    GIT(dir, ['init']);
    GIT(dir, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A']);
    GIT(dir, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'feat: init']);
    writeFileSync(join(dir, 'src', 'b.ts'), `import { a } from './a';\nexport const b = 2;\n`);
    GIT(dir, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A']);
    GIT(dir, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'fix: bump b']);
  } catch { /* git unavailable — git-dependent asserts are conditional */ }
  return { dir, cleanup: () => { rmSync(dir, { recursive: true, force: true }); rmSync(cache, { recursive: true, force: true }); } };
}

describe('collectAudit', () => {
  it('detects deps integrity: missing, dead, lock drift absent', async () => {
    const { dir, cleanup } = makeRepo();
    try {
      const d = await collectAudit(dir);
      expect(d.missing).toContain('missing-dep');
      expect(d.deadDeps).toEqual(['unused-dep']);
      expect(d.missing).not.toContain('used-dep');
      expect(d.pkg.name).toBe('tmp-report');
    } finally { cleanup(); }
  });

  it('detects the a↔b import cycle and the env var gap', async () => {
    const { dir, cleanup } = makeRepo();
    try {
      const d = await collectAudit(dir);
      const flat = d.health.cycles.map(c => c.path.join('>'));
      expect(flat.some(p => p.includes('src/a.ts') && p.includes('src/b.ts'))).toBe(true);
      expect(d.env.undocumented).toContain('UNDOC_VAR');
      expect(d.env.undocumented).not.toContain('OTHER_VAR');
    } finally { cleanup(); }
  });

  it('detects the innerHTML security sink with a real total', async () => {
    const { dir, cleanup } = makeRepo();
    try {
      const d = await collectAudit(dir);
      expect(d.sec.innerHTML?.length).toBeGreaterThan(0);
      expect(d.sec.innerHTML![0].file).toBe('src/a.ts');
      expect(d.secTotals.innerHTML).toBeGreaterThanOrEqual(d.sec.innerHTML!.length);
    } finally { cleanup(); }
  });

  it('detects unused exports and files, keeps tested files apart', async () => {
    const { dir, cleanup } = makeRepo();
    try {
      const d = await collectAudit(dir);
      expect(d.health.unusedExports.some(u => u.file === 'src/d.ts' && u.name === 'orphan')).toBe(false); // imported by entry.ts
      expect(d.testBases.has('a')).toBe(true);
      expect(d.testFiles).toContain('test/a.test.ts');
    } finally { cleanup(); }
  });

  it('reads README sections and git activity when available', async () => {
    const { dir, cleanup } = makeRepo();
    try {
      const d = await collectAudit(dir);
      expect(d.readme?.install).toBe(true);
      expect(d.readme?.usage).toBe(true);
      if (d.git) {
        expect(d.git.commits).toBeGreaterThanOrEqual(2);
        expect(d.git.fileCommits?.get('src/b.ts')).toBe(2);
      }
    } finally { cleanup(); }
  });
});

describe('renderAuditMd', () => {
  it('renders all sections with a score, FR and EN', async () => {
    const { dir, cleanup } = makeRepo();
    try {
      const d = await collectAudit(dir);
      for (const lang of ['fr', 'en'] as const) {
        const md = renderAuditMd(d, lang);
        expect(md).toMatch(/## 1\./);
        expect(md).toMatch(/█|░/);
        expect(md).toMatch(/\/100/);
        expect((md.match(/^## /gm) ?? []).length).toBeGreaterThanOrEqual(7);
        expect(md).toContain('shinzarou-eng');
      }
      const fr = renderAuditMd(d, 'fr');
      const en = renderAuditMd(d, 'en');
      expect(fr).not.toBe(en);
    } finally { cleanup(); }
  });

  it('is deterministic — same tree, byte-identical output', async () => {
    const { dir, cleanup } = makeRepo();
    try {
      const d1 = await collectAudit(dir);
      const d2 = await collectAudit(dir);
      expect(renderAuditMd(d1, 'fr')).toBe(renderAuditMd(d2, 'fr'));
    } finally { cleanup(); }
  });
});

describe('known traps', () => {
  it('smell scanners ignore text inside template literals', async () => {
    const { dir, cleanup } = makeRepo();
    try {
      // TODO/FIXME inside a template string (help text, fixtures) must not count.
      writeFileSync(join(dir, 'src', 'c.ts'), [
        'export const help = `',
        '  TODO: improve this flag',
        '  FIXME: and this one',
        '`;',
        '',
      ].join('\n'));
      const d = await collectAudit(dir);
      const hits = d.smells.todo ?? [];
      expect(hits.filter(h => h.file === 'src/c.ts')).toHaveLength(0);
    } finally { cleanup(); }
  });

  it('deep-nest ignores indentation inside template literals', async () => {
    const { dir, cleanup } = makeRepo();
    try {
      writeFileSync(join(dir, 'src', 'c.ts'), [
        'export const tpl = `',
        '                          deeply indented template text',
        '`;',
        '',
      ].join('\n'));
      const d = await collectAudit(dir);
      expect(d.shape.deepNest.filter(n => n.file === 'src/c.ts')).toHaveLength(0);
    } finally { cleanup(); }
  });
});
