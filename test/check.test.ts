import { describe, it, expect, vi, afterEach } from 'vitest';
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { collectAudit } from '../src/report';
import { auditFindings } from '../src/findings';
import { writeBaseline, readBaseline, diffFindings, BASELINE_REL } from '../src/baseline';
import { runCheck, formatCheckMd } from '../src/check';
import { checkToSarif } from '../src/sarif';
import { makeRepo } from './helpers';
import type { AuditFinding } from '../src/report-types';

afterEach(() => vi.unstubAllEnvs());

const repo = () => makeRepo({
  'src/a.ts': `export const a = 1;\n`,
  'src/b.ts': `import { a } from './a';\nexport const b = a + 1;\n`,
});

describe('baseline', () => {
  it('writeBaseline → readBaseline round-trip', async () => {
    const { dir, cleanup } = repo();
    try {
      const data = await collectAudit(dir);
      const findings = auditFindings(data, 'en');
      const b = await writeBaseline(dir, data, findings);
      expect(existsSync(join(dir, BASELINE_REL))).toBe(true);
      const back = await readBaseline(dir);
      expect(back?.score).toBe(data.health.score);
      expect(back?.findings.length).toBe(findings.length);
      expect(back?.findings[0].id).toBe(findings[0].id);
    } finally { cleanup(); }
  });

  it('diffFindings splits added / resolved / unchanged', () => {
    const mk = (id: string): AuditFinding => ({ id, rule: 'r', severity: 'Faible', message: id });
    const baseline = { version: 1 as const, createdAt: '', score: 80, findings: [{ id: 'a', rule: 'r', severity: 'Faible' as const }, { id: 'gone', rule: 'r', severity: 'Faible' as const }] };
    const d = diffFindings(baseline, [mk('a'), mk('new')]);
    expect(d.added.map(f => f.id)).toEqual(['new']);
    expect(d.resolved.map(f => f.id)).toEqual(['gone']);
    expect(d.unchanged).toBe(1);
    expect(d.escalated).toEqual([]);
  });

  it('diffFindings reports severity upgrades as escalated, not unchanged', () => {
    const mk = (id: string, severity: AuditFinding['severity']): AuditFinding => ({ id, rule: 'r', severity, message: id });
    const baseline = { version: 1 as const, createdAt: '', score: 80, findings: [{ id: 'a', rule: 'r', severity: 'Faible' as const }] };
    const d = diffFindings(baseline, [mk('a', 'Critique')]);
    expect(d.escalated.map(f => f.id)).toEqual(['a']);
    expect(d.unchanged).toBe(0);
    expect(d.added).toEqual([]);
  });
});

describe('runCheck', () => {
  it('flags a new sec:eval finding on the changed file → red', async () => {
    const { dir, cleanup } = repo();
    try {
      // Baseline first, then introduce eval in a tracked file.
      const data = await collectAudit(dir);
      await writeBaseline(dir, data, auditFindings(data, 'en'));
      writeFileSync(join(dir, 'src', 'b.ts'), `import { a } from './a';\nexport const b = a + 1;\neval('x');\n`);
      const r = await runCheck(dir, { lang: 'en' });
      expect(r.files.map(f => f.file)).toContain('src/b.ts');
      const added = r.diff.added.filter(f => f.rule === 'sec:eval');
      expect(added.length).toBeGreaterThan(0);
      expect(r.verdict).toBe('red');
      const md = formatCheckMd(r, 'en');
      expect(md).toContain('Verdict');
      expect(md).toContain('src/b.ts');
    } finally { cleanup(); }
  });

  it('an invalid git ref can never look green — scopeError + red verdict', async () => {
    const { dir, cleanup } = repo();
    try {
      const r = await runCheck(dir, { base: 'refs/definitely/missing', lang: 'en' });
      expect(r.scopeError).toBeTruthy();
      expect(r.verdict).toBe('red');
      expect(r.reasons.join(' ')).toMatch(/Could not diff/);
      const md = formatCheckMd(r, 'en');
      expect(md).toContain('cannot be trusted');
    } finally { cleanup(); }
  });

  it('green when the changed file adds no finding and baseline is current', async () => {
    const { dir, cleanup } = repo();
    try {
      writeFileSync(join(dir, 'src', 'b.ts'), `import { a } from './a';\nexport const b = a + 1;\n`);
      const data = await collectAudit(dir);
      await writeBaseline(dir, data, auditFindings(data, 'en'));
      writeFileSync(join(dir, 'src', 'b.ts'), `import { a } from './a';\nexport const b = a + 2;\n`);
      const r = await runCheck(dir, { lang: 'en' });
      expect(r.hasBaseline).toBe(true);
      expect(r.diff.added.filter(f => !f.file || r.changedFiles.includes(f.file))).toHaveLength(0);
      expect(r.verdict).toBe('green');
    } finally { cleanup(); }
  });

  it('high blast radius alone is advisory (yellow), never blocking', async () => {
    const { dir, cleanup } = repo();
    try {
      const data = await collectAudit(dir);
      await writeBaseline(dir, data, auditFindings(data, 'en'));
      // a.ts is imported by b.ts → ~33% of the repo depends on it = high risk.
      // A clean change to it must not block the gate.
      writeFileSync(join(dir, 'src', 'a.ts'), `export const a = 2;\n`);
      const r = await runCheck(dir, { lang: 'en' });
      expect(r.files.find(f => f.file === 'src/a.ts')?.impact?.risk).toBe('high');
      expect(r.verdict).toBe('yellow');
    } finally { cleanup(); }
  });

  it('SARIF export: only the actionable findings, GitHub-shaped', async () => {
    const { dir, cleanup } = repo();
    try {
      const data = await collectAudit(dir);
      await writeBaseline(dir, data, auditFindings(data, 'en'));
      writeFileSync(join(dir, 'src', 'b.ts'), `import { a } from './a';\nexport const b = a + 1;\neval('x');\n`);
      const r = await runCheck(dir, { lang: 'en' });
      const sarif = JSON.parse(checkToSarif(r, '0.0.0'));
      expect(sarif.version).toBe('2.1.0');
      const run = sarif.runs[0];
      expect(run.tool.driver.name).toBe('dsh-codebase-chat');
      const evalRes = run.results.find((x: any) => x.ruleId === 'sec:eval');
      expect(evalRes.level).toBe('error');
      expect(evalRes.locations[0].physicalLocation.artifactLocation.uri).toBe('src/b.ts');
      expect(run.tool.driver.rules.map((x: any) => x.id)).toContain('sec:eval');
    } finally { cleanup(); }
  });
});
