import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Smoke test: the DSH plugin entry (lib/index.js) must load and expose the
// DeepSeek Harness contract — apply(ctx), inject, prompt builders.
describe('dsh plugin entry (lib/index.js)', () => {
  it('exports apply + inject + prompt builders', async () => {
    const mod: any = await import('../lib/index.js');
    expect(typeof mod.apply).toBe('function');
    expect(Array.isArray(mod.inject)).toBe(true);
    expect(typeof mod.buildIntelligencePrompt).toBe('function');
    expect(typeof mod.collectCodebaseContext).toBe('function');
  });
});

describe('isWithinProject (plugin path boundary)', () => {
  const setup = async () => {
    const mod: any = await import('../lib/index.js');
    const tmp = mkdtempSync(join(tmpdir(), 'dsh-proj-'));
    const proj = join(tmp, 'proj');
    mkdirSync(join(proj, 'src'), { recursive: true });
    writeFileSync(join(proj, 'src', 'a.ts'), 'export const a = 1;\n');
    return { mod, tmp, proj };
  };

  it('accepts a file inside the project', async () => {
    const { mod, proj } = await setup();
    expect(await mod.isWithinProject(proj, 'src/a.ts')).toBe(true);
  });

  it('rejects ../outside.ts', async () => {
    const { mod, proj } = await setup();
    expect(await mod.isWithinProject(proj, '../outside.ts')).toBe(false);
  });

  it('rejects a sibling directory sharing the root prefix', async () => {
    const { mod, tmp, proj } = await setup();
    const other = join(tmp, 'proj-other');
    mkdirSync(other, { recursive: true });
    writeFileSync(join(other, 'x.ts'), 'export const x = 1;\n');
    expect(await mod.isWithinProject(proj, '..\\proj-other\\x.ts')).toBe(false);
    expect(await mod.isWithinProject(proj, '../proj-other/x.ts')).toBe(false);
  });

  it('rejects an absolute path outside the root', async () => {
    const { mod, tmp, proj } = await setup();
    expect(await mod.isWithinProject(proj, join(tmp, 'abs.ts'))).toBe(false);
  });

  it('rejects a junction/symlink pointing outside the root', async (t) => {
    const { mod, tmp, proj } = await setup();
    const elsewhere = join(tmp, 'elsewhere');
    mkdirSync(elsewhere, { recursive: true });
    try {
      symlinkSync(elsewhere, join(proj, 'link'), 'junction');
    } catch (e: any) {
      if (e?.code === 'EPERM' || e?.code === 'EACCES') return t.skip('symlink/junction not permitted');
      throw e;
    }
    expect(await mod.isWithinProject(proj, 'link/x.ts')).toBe(false);
  });

  it('rejects protectedPaths and not their prefixed siblings', async () => {
    const { mod, proj } = await setup();
    writeFileSync(join(proj, '.codebase-chat.json'), JSON.stringify({ protectedPaths: ['secrets'] }));
    mkdirSync(join(proj, 'secrets'), { recursive: true });
    mkdirSync(join(proj, 'secrets-ok'), { recursive: true });
    expect(await mod.isWithinProject(proj, 'secrets/k.txt')).toBe(false);
    expect(await mod.isWithinProject(proj, 'secrets-ok/k.txt')).toBe(true);
  });
});
