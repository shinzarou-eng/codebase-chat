import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { collectAudit } from '../src/report';
import { auditFindings } from '../src/findings';

afterEach(() => vi.unstubAllEnvs());

function makeProject(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-findings-'));
  const cache = mkdtempSync(join(tmpdir(), 'dsh-findings-cache-'));
  vi.stubEnv('CODEBASE_CACHE_DIR', cache);
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'a.ts'), `import { b } from './b';\nexport const a = b;\n`);
  writeFileSync(join(dir, 'src', 'b.ts'), `import { a } from './a';\nexport const b = a;\n`);
  writeFileSync(join(dir, 'src', 'view.ts'), `export function render(el: any, x: string) {\n  el.innerHTML = x;\n}\n`);
  return { dir, cleanup: () => { rmSync(dir, { recursive: true, force: true }); rmSync(cache, { recursive: true, force: true }); } };
}

describe('auditFindings', () => {
  it('emits stable ids and expected severities on a tmp project', async () => {
    const { dir, cleanup } = await makeProject();
    try {
      const data = await collectAudit(dir);
      const findings = auditFindings(data, 'en');
      const ih = findings.filter(f => f.rule === 'sec:innerHTML');
      expect(ih.length).toBeGreaterThan(0);
      expect(ih[0].severity).toBe('Moyenne');
      expect(ih[0].file).toBe('src/view.ts');
      expect(ih[0].line).toBe(2);
      expect(ih[0].id).not.toContain(':2');
      const cycles = findings.filter(f => f.rule === 'cycle');
      expect(cycles.length).toBeGreaterThan(0);
      expect(cycles[0].severity).toBe('Élevée');
      expect(cycles[0].message).toContain('src/a.ts');
      // ids stable across line drift: same rule+file+fp regardless of line
      const ids = findings.map(f => f.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.every(id => !/:\d+$/.test(id))).toBe(true);
    } finally {
      cleanup();
    }
  });
});
