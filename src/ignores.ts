// Ignores — findings deliberately silenced with a justification, so --check
// only reports what's new or still actionable. Stored in the project at
// .codebase-chat/ignores.json — meant to be committed (decisions are shared).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AuditFinding } from './report-types.js';

export const IGNORES_REL = '.codebase-chat/ignores.json';

export interface Ignore {
  /** Finding id or prefix — `sec:innerHTML:src/x.ts` covers every innerHTML finding in that file. */
  id: string;
  reason: string;
  createdAt: string;
}

export async function readIgnores(absProject: string): Promise<Ignore[]> {
  try {
    const data = JSON.parse(await readFile(join(absProject, IGNORES_REL), 'utf8'));
    if (!Array.isArray(data?.ignores)) return [];
    return data.ignores.filter((i: any) => typeof i?.id === 'string' && typeof i?.reason === 'string');
  } catch {
    return [];
  }
}

async function writeIgnores(absProject: string, ignores: Ignore[]): Promise<void> {
  const p = join(absProject, IGNORES_REL);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify({ version: 1, ignores }, null, 2) + '\n', 'utf8');
}

export async function addIgnore(absProject: string, id: string, reason: string): Promise<Ignore | null> {
  const ignores = await readIgnores(absProject);
  if (ignores.some(i => i.id === id)) return null;
  const entry: Ignore = { id, reason, createdAt: new Date().toISOString() };
  await writeIgnores(absProject, [...ignores, entry]);
  return entry;
}

export async function removeIgnore(absProject: string, id: string): Promise<boolean> {
  const ignores = await readIgnores(absProject);
  const next = ignores.filter(i => i.id !== id);
  if (next.length === ignores.length) return false;
  await writeIgnores(absProject, next);
  return true;
}

/** Exact id OR prefix key — `sec:innerHTML:src/x.ts` silences every innerHTML in that file. */
export function isIgnored(id: string, ignores: Ignore[]): boolean {
  return ignores.some(i => id === i.id || id.startsWith(i.id + ':'));
}

/** Split findings into the ones that still count vs the silenced ones. */
export function splitIgnored(findings: AuditFinding[], ignores: Ignore[]): { active: AuditFinding[]; ignored: AuditFinding[] } {
  if (!ignores.length) return { active: findings, ignored: [] };
  return {
    active: findings.filter(f => !isIgnored(f.id, ignores)),
    ignored: findings.filter(f => isIgnored(f.id, ignores)),
  };
}
