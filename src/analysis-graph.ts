import { extname, join, relative, sep } from 'node:path';
import { stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { findProjectRoot, getWalkOptions, resolveProjectPath, safeReadText, walkFiles } from './project.js';
import { CODE_EXTS, SKIP_EXTS, parseImports } from './analysis-scan.js';
import type { Cycle, ImportEdge, ImportGraph } from './analysis-types.js';

/**
 * Detect cycle groups in the local import graph via Tarjan's SCC algorithm —
 * linear time, no combinatorial blow-up on dense graphs. Each reported
 * `Cycle.path` holds the members of one strongly connected component.
 */
export function findCycles(edges: ImportEdge[]): Cycle[] {
  const adj = new Map<string, string[]>();
  const nodes = new Set<string>();
  for (const e of edges) {
    nodes.add(e.from);
    nodes.add(e.to);
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from)!.push(e.to);
  }

  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];
  let counter = 0;

  for (const root of nodes) {
    if (index.has(root)) continue;
    // Iterative DFS — no recursion limit on deep graphs.
    const work: [string, number][] = [[root, 0]];
    while (work.length) {
      const top = work[work.length - 1];
      const [v, ci] = top;
      if (ci === 0) {
        index.set(v, counter);
        low.set(v, counter);
        counter++;
        stack.push(v);
        onStack.add(v);
      }
      const children = adj.get(v) ?? [];
      if (ci < children.length) {
        top[1] = ci + 1;
        const w = children[ci];
        if (!index.has(w)) work.push([w, 0]);
        else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
      } else {
        work.pop();
        if (work.length) {
          const parent = work[work.length - 1][0];
          low.set(parent, Math.min(low.get(parent)!, low.get(v)!));
        }
        if (low.get(v) === index.get(v)) {
          const scc: string[] = [];
          let w: string;
          do { w = stack.pop()!; onStack.delete(w); scc.push(w); } while (w !== v);
          // size > 1 = real cycle; size 1 only when the file imports itself
          if (scc.length > 1 || (adj.get(v) ?? []).includes(v)) sccs.push(scc);
        }
      }
    }
  }

  return sccs
    .map(m => ({ path: m.sort() }))
    .sort((a, b) => b.path.length - a.path.length);
}

/**
 * Walk the project once and build the local import graph (file → files it
 * imports). Shared by `analyzeProject` and `analyzeImpact` so both run the
 * same resolution rules.
 */
export async function collectImportGraph(projectPath: string): Promise<ImportGraph> {
  const abs = await findProjectRoot(resolveProjectPath(projectPath));
  const fileTexts = new Map<string, string>();
  const codeFiles: string[] = [];
  const walk = await getWalkOptions(abs);

  const candidates: string[] = [];
  for await (const full of walkFiles(abs, walk.skipDirs, walk.skipFiles, walk.ignoreGlobs)) {
    const rel = relative(abs, full).split(sep).join('/');
    const ext = extname(rel).toLowerCase();
    if (!CODE_EXTS.has(ext) || SKIP_EXTS.has(ext) || rel.includes('.min.')) continue;
    candidates.push(rel);
  }
  // Reads are I/O-bound — run them in parallel, order preserved.
  const texts = await Promise.all(candidates.map(rel => safeReadText(join(abs, rel))));
  for (let i = 0; i < candidates.length; i++) {
    const text = texts[i];
    if (!text) continue;
    codeFiles.push(candidates[i]);
    fileTexts.set(candidates[i], text);
  }

  const known = new Set(codeFiles);
  const edges: ImportEdge[] = [];
  const inDegree = new Map<string, number>();
  for (const rel of codeFiles) {
    for (const to of parseImports(fileTexts.get(rel)!, rel, known)) {
      edges.push({ from: rel, to });
      inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
    }
  }
  return { abs, codeFiles, fileTexts, edges, inDegree };
}

/** Content signature of the walked file set — stats only, zero file reads.
 *  Used to memoize analyses: same signature ⇒ same files ⇒ same result. */
export async function projectSignature(abs: string): Promise<string> {
  const walk = await getWalkOptions(abs);
  const parts: string[] = [];
  for await (const full of walkFiles(abs, walk.skipDirs, walk.skipFiles, walk.ignoreGlobs)) {
    try {
      const s = await stat(full);
      parts.push(`${relative(abs, full).split(sep).join('/')}|${s.mtimeMs}|${s.size}`);
    } catch { /* vanished mid-walk */ }
  }
  parts.sort();
  return createHash('sha1').update(parts.join('\n')).digest('hex');
}
