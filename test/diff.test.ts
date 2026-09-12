import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { getChangedFiles } from '../src/diff.js';

const run = promisify(execFile);
const git = (cwd: string, args: string[]) => run('git', ['-C', cwd, ...args]);

let dir: string;
let gitAvailable = true;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-diff-'));
  try {
    await git(dir, ['init', '-q']);
    await git(dir, ['config', 'user.email', 'test@test.dev']);
    await git(dir, ['config', 'user.name', 'test']);
    await writeFile(join(dir, 'a.ts'), 'export const a = 1;\n');
    await writeFile(join(dir, 'b.ts'), 'export const b = 1;\n');
    await git(dir, ['add', '-A']);
    await git(dir, ['commit', '-qm', 'init']);
  } catch {
    gitAvailable = false;
  }
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

describe('getChangedFiles', () => {
  it('returns modified and untracked files vs HEAD', async () => {
    if (!gitAvailable) return;
    await writeFile(join(dir, 'a.ts'), 'export const a = 2;\n'); // modified
    await writeFile(join(dir, 'new.ts'), 'export const n = 1;\n'); // untracked

    const scope = await getChangedFiles(dir, 'HEAD');
    expect(scope.ok).toBe(true);
    expect(scope.files.has('a.ts')).toBe(true);
    expect(scope.files.has('new.ts')).toBe(true);
    expect(scope.files.has('b.ts')).toBe(false);
  });

  it('reports failure gracefully outside a git repo', async () => {
    const plain = await mkdtemp(join(tmpdir(), 'dsh-nogit-'));
    try {
      const scope = await getChangedFiles(plain, 'HEAD');
      expect(scope.ok).toBe(false);
      expect(scope.files.size).toBe(0);
      expect(typeof scope.error).toBe('string');
    } finally {
      await rm(plain, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  });
});
