import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDoctor, formatDoctorMd } from '../src/doctor.js';

const dirs: string[] = [];
async function tmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'dsh-doctor-'));
  dirs.push(d);
  return d;
}
afterAll(async () => { for (const d of dirs) await rm(d, { recursive: true, force: true }); });

describe('doctor', () => {
  it('reports on a non-git tmp project without leaking secrets', async () => {
    const old = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = 'fake-secret-xyz-123';
    try {
      const dir = await tmp();
      const r = await runDoctor(dir, 'en');
      const labels = r.items.map(i => i.label);
      for (const l of ['Node.js', 'codebase-chat', 'Project', 'Index', 'Config', 'LLM', 'Baseline', 'Integrations'])
        expect(labels).toContain(l);
      expect(r.items.find(i => i.label === 'Node.js')?.status).toBe('ok');
      expect(r.items.find(i => i.label === 'Project')?.status).toBe('warn');
      expect(r.items.find(i => i.label === 'Project')?.detail).toContain('not a git repository');
      const md = formatDoctorMd(r, 'en');
      expect(md).toContain('# Diagnosis');
      expect(md).not.toContain('fake-secret-xyz-123');
    } finally {
      if (old === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = old;
    }
  });
});
