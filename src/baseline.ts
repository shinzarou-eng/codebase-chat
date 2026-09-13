// Baseline — snapshot of the audit's findings so later runs can diff
// "what appeared / what was fixed". Stored in the project at
// .codebase-chat/baseline.json — meant to be committed, not ignored.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AuditData, AuditFinding } from './report-types.js';

const run = promisify(execFile);

export const BASELINE_REL = '.codebase-chat/baseline.json';

export interface Baseline {
  version: 1;
  createdAt: string;
  head?: string;
  score: number;
  findings: Pick<AuditFinding, 'id' | 'rule' | 'severity' | 'file'>[];
}

export async function writeBaseline(absProject: string, data: AuditData, findings: AuditFinding[]): Promise<Baseline> {
  let head: string | undefined;
  try {
    head = (await run('git', ['-C', absProject, 'rev-parse', '--short', 'HEAD'])).stdout.trim() || undefined;
  } catch { /* not a git repo */ }
  const baseline: Baseline = {
    version: 1,
    createdAt: new Date().toISOString(),
    head,
    score: data.health.score,
    findings: findings.map(f => ({ id: f.id, rule: f.rule, severity: f.severity, file: f.file })),
  };
  const p = join(absProject, BASELINE_REL);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(baseline, null, 2) + '\n', 'utf8');
  return baseline;
}

export async function readBaseline(absProject: string): Promise<Baseline | null> {
  try {
    const data = JSON.parse(await readFile(join(absProject, BASELINE_REL), 'utf8'));
    if (data?.version !== 1 || !Array.isArray(data.findings)) return null;
    return data as Baseline;
  } catch {
    return null;
  }
}

export function diffFindings(baseline: Baseline | null, current: AuditFinding[]): {
  added: AuditFinding[];
  resolved: Baseline['findings'];
  unchanged: number;
} {
  if (!baseline) return { added: current, resolved: [], unchanged: 0 };
  const baseIds = new Set(baseline.findings.map(f => f.id));
  const curIds = new Set(current.map(f => f.id));
  return {
    added: current.filter(f => !baseIds.has(f.id)),
    resolved: baseline.findings.filter(f => !curIds.has(f.id)),
    unchanged: current.filter(f => baseIds.has(f.id)).length,
  };
}
