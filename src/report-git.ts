// Git activity - local, deterministic, no network.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { GitStats } from './report-types.js';

const run = promisify(execFile);

export const SENSITIVE_PATS = /(^|\/)\.env$|(^|\/)\.env\.(local|prod|production|dev|development)$|\.(pem|key|p12|pfx|keystore)$|id_rsa|id_ed25519|credentials\.json|service-account/i;

export async function gitActivity(abs: string): Promise<GitStats | null> {
  try {
    const { stdout } = await run('git', [
      '-C', abs, 'log', '--numstat', '--format=@@@%an|%ad|%s', '--date=short', '-n', '400',
    ], { maxBuffer: 32 * 1024 * 1024 });
    const stats: GitStats = { commits: 0, authors: new Map(), lastDate: '', churn: new Map(), fileCommits: new Map(), fileAuthors: new Map(), months: new Map(), sensitiveTracked: [], fileLastCommit: new Map(), subjects: [], commitSizes: [] };
    let author = '';
    let date = '';
    let curFiles = 0, curLines = 0;
    const flush = () => { if (curFiles || curLines) stats.commitSizes.push({ files: curFiles, lines: curLines }); curFiles = 0; curLines = 0; };
    for (const line of stdout.split('\n')) {
      if (line.startsWith('@@@')) {
        flush();
        stats.commits++;
        const [a, d, s] = line.slice(3).split('|');
        author = a;
        date = d;
        if (s) stats.subjects.push(s);
        if (!stats.lastDate) stats.lastDate = d;
        stats.authors.set(a, (stats.authors.get(a) ?? 0) + 1);
        const month = d.slice(0, 7);
        stats.months.set(month, (stats.months.get(month) ?? 0) + 1);
        continue;
      }
      const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
      if (!m || m[1] === '-') continue; // binary
      const file = m[3].replace(/\\/g, '/');
      const delta = Number(m[1]) + Number(m[2]);
      curFiles++;
      curLines += delta;
      stats.churn.set(file, (stats.churn.get(file) ?? 0) + delta);
      stats.fileCommits.set(file, (stats.fileCommits.get(file) ?? 0) + 1);
      if (!stats.fileLastCommit.has(file) && date) stats.fileLastCommit.set(file, date);
      if (author) (stats.fileAuthors.get(file) ?? stats.fileAuthors.set(file, new Set()).get(file)!).add(author);
    }
    flush();
    try {
      const { stdout: tracked } = await run('git', ['-C', abs, 'ls-files'], { maxBuffer: 8 * 1024 * 1024 });
      stats.sensitiveTracked = tracked.split('\n').map(l => l.trim()).filter(f => f && SENSITIVE_PATS.test(f));
    } catch { /* ls-files failed — leave empty */ }
    return stats;
  } catch {
    return null; // not a git repo / no git
  }
}

/** Commit message quality: % conventional, avg subject length. */
export function commitQuality(subjects: string[]) {
  if (!subjects.length) return null;
  const CONV = /^(feat|fix|docs|style|refactor|perf|test|chore|ci|build|revert|tweak|release|hotfix|init|merge|wip)(\(.+\))?!?:\s/i;
  const conv = subjects.filter(s => CONV.test(s)).length;
  const avgLen = Math.round(subjects.reduce((s, x) => s + x.length, 0) / subjects.length);
  return { conventionalPct: Math.round((conv / subjects.length) * 100), avgLen };
}
