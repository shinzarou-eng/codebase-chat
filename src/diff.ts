import { execFile } from 'node:child_process';
import { sep } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface DiffScope {
  /** Project-relative paths (forward slashes) changed vs the base ref. */
  files: Set<string>;
  /** False when the project is not a git repo or git is unavailable. */
  ok: boolean;
  /** Why the scope could not be computed (when ok === false). */
  error?: string;
}

async function git(absProject: string, args: string[]): Promise<string> {
  const { stdout } = await run('git', ['-C', absProject, ...args], { maxBuffer: 16 * 1024 * 1024 });
  return stdout;
}

function toRelList(output: string): string[] {
  return output
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => l.split(sep).join('/'));
}

/**
 * Files changed vs a git ref — committed diffs, staged/unstaged edits and
 * untracked files. Used to scope retrieval and audits to "what changed".
 */
export async function getChangedFiles(absProject: string, base: string): Promise<DiffScope> {
  try {
    const [tracked, untracked] = await Promise.all([
      // Working tree vs base — covers committed, staged and unstaged edits.
      git(absProject, ['diff', '--name-only', base, '--']),
      git(absProject, ['ls-files', '--others', '--exclude-standard']),
    ]);
    const files = new Set([...toRelList(tracked), ...toRelList(untracked)]);
    return { files, ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { files: new Set(), ok: false, error: msg.split('\n')[0] };
  }
}
