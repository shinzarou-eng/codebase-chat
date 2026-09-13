// Check history — one JSON line per --check run in
// .codebase-chat/history.jsonl. Local audit trail: verdict and score over
// time, so you can see whether the project is actually getting better.
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const HISTORY_REL = '.codebase-chat/history.jsonl';
const HISTORY_KEEP = 200; // lines read back at most

export interface CheckHistoryEntry {
  ts: string;
  base: string;
  head?: string;
  verdict: 'red' | 'yellow' | 'green';
  score: number;
  changed: number;
  added: number;
  resolved: number;
}

export async function appendHistory(absProject: string, entry: CheckHistoryEntry): Promise<void> {
  const p = join(absProject, HISTORY_REL);
  try {
    await mkdir(dirname(p), { recursive: true });
    await appendFile(p, JSON.stringify(entry) + '\n', 'utf8');
  } catch { /* history is best-effort — never break a check */ }
}

export async function readHistory(absProject: string, limit = 20): Promise<CheckHistoryEntry[]> {
  try {
    const lines = (await readFile(join(absProject, HISTORY_REL), 'utf8')).trim().split('\n');
    const entries = lines
      .slice(-HISTORY_KEEP)
      .map(l => { try { return JSON.parse(l) as CheckHistoryEntry; } catch { return null; } })
      .filter((e): e is CheckHistoryEntry => !!e && typeof e.ts === 'string' && typeof e.score === 'number');
    return entries.slice(-limit);
  } catch {
    return [];
  }
}
