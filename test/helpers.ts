// Shared test fixture helpers — every suite was copying the same mkdtemp +
// cache-dir + git-init boilerplate.
import { vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

export const GIT = (dir: string, args: string[]) =>
  execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });

/** Temp repo: writes `files` (package.json is provided unless overridden), then
 *  git init + initial commit when git is available. */
export function makeRepo(files: Record<string, string>): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-test-'));
  const cache = mkdtempSync(join(tmpdir(), 'dsh-test-cache-'));
  vi.stubEnv('CODEBASE_CACHE_DIR', cache);
  const all = { 'package.json': JSON.stringify({ name: 'tmp-repo', version: '0.0.1' }), ...files };
  for (const [rel, text] of Object.entries(all)) {
    const p = join(dir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
  }
  try {
    GIT(dir, ['init']);
    GIT(dir, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A']);
    GIT(dir, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'init']);
  } catch { /* git unavailable */ }
  return { dir, cleanup: () => { rmSync(dir, { recursive: true, force: true }); rmSync(cache, { recursive: true, force: true }); } };
}
