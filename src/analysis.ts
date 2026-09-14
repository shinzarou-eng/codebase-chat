import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { findProjectRoot, resolveProjectPath } from './project.js';
import { collectImportGraph, findCycles, projectSignature } from './analysis-graph.js';
import {
  complexityOf, findDuplicates, insideString, isTestPath, lineStartsInString,
  looksLikeEntry, parseExports,
} from './analysis-scan.js';
import type { AnalyzeOptions, HealthReport, ImportGraph, UnusedExport } from './analysis-types.js';

export * from './analysis-types.js';
export * from './analysis-scan.js';
export * from './analysis-graph.js';
export * from './analysis-report.js';

const ANALYSIS_TTL_MS = 10_000;
const healthCache = new Map<string, { sig: string; at: number; report: HealthReport }>();

export async function analyzeProject(projectPath: string, opts: AnalyzeOptions = {}): Promise<HealthReport> {
  // Scoped runs (--diff) are rarer and cheaper - skip the memo.
  if (opts.files) {
    return analyzeGraph(await collectImportGraph(projectPath), opts);
  }
  const abs = await findProjectRoot(resolveProjectPath(projectPath));
  const sig = await projectSignature(abs);
  const hit = healthCache.get(abs);
  if (hit && hit.sig === sig && Date.now() - hit.at < ANALYSIS_TTL_MS) return hit.report;
  const report = await analyzeGraph(await collectImportGraph(projectPath), opts);
  healthCache.set(abs, { sig, at: Date.now(), report });
  return report;
}

/** The analysis itself, on an already-collected import graph. Exported so
 *  callers that need the graph too (collectAudit) don't walk the tree twice. */
export async function analyzeGraph(graph: ImportGraph, opts: AnalyzeOptions = {}): Promise<HealthReport> {
  const { abs, codeFiles, fileTexts, edges, inDegree } = graph;
  const scope = opts.files;
  const scopedFiles = scope ? codeFiles.filter(f => scope.has(f)) : codeFiles;

  let pkg: Record<string, any> = {};
  try { pkg = JSON.parse(await readFile(join(abs, 'package.json'), 'utf8')); } catch {}

  // Full-graph cycles - when scoped, keep only cycles touching a changed file.
  const cycles = findCycles(edges)
    .filter(c => !scope || c.path.some(node => scope.has(node)));

  const unusedFiles = scopedFiles
    .filter(rel => !inDegree.has(rel) && !looksLikeEntry(rel, pkg))
    .sort();

  // Unused exports: name not imported and not referenced elsewhere.
  // A name is "used" when referenced on any line other than its own export
  // declaration - e.g. a type appearing in another export's signature, or a
  // helper consumed by the module's public functions.
  const IDENT_RE = /[A-Za-z_$][\w$]*/g;
  const identifiersByFile = new Map<string, Set<string>>();
  const idsPerLineByFile = new Map<string, Set<string>[]>();
  for (const [file, text] of fileTexts) {
    identifiersByFile.set(file, new Set(text.match(IDENT_RE) ?? []));
    idsPerLineByFile.set(file, text.split('\n').map(l => new Set(l.match(IDENT_RE) ?? [])));
  }
  const unusedExports: UnusedExport[] = [];
  for (const rel of scopedFiles) {
    if (isTestPath(rel)) continue; // test files export fixtures - executed, not imported
    const ownLines = idsPerLineByFile.get(rel)!;
    const text = fileTexts.get(rel)!;
    const textLines = text.split('\n');
    const startsInStr = lineStartsInString(text);
    for (const exp of parseExports(text)) {
      if (exp.name === 'default') continue;
      const dLine = textLines[exp.line - 1] ?? '';
      const expIdx = dLine.indexOf('export');
      // `export` inside a string literal is fixture/generated text, not code.
      if (startsInStr[exp.line - 1] || (expIdx >= 0 && insideString(dLine, expIdx))) continue;
      // Same-file use: any line other than the export declaration itself.
      let used = ownLines.some((ids, i) => i !== exp.line - 1 && ids.has(exp.name));
      for (const [otherFile, ids] of identifiersByFile) {
        if (used) break;
        if (otherFile === rel) continue;
        if (ids.has(exp.name)) used = true;
      }
      if (!used) unusedExports.push({ file: rel, name: exp.name, line: exp.line });
    }
  }

  // Duplicates across the whole project, but when scoped only report groups
  // that include at least one changed file.
  const duplicates = findDuplicates(fileTexts)
    .filter(g => !scope || g.files.some(f => scope.has(f)));

  const hotspots: HealthReport['hotspots'] = [];
  for (const rel of scopedFiles) {
    const score = complexityOf(fileTexts.get(rel)!);
    if (score >= 12) hotspots.push({ file: rel, startLine: 1, score });
  }
  hotspots.sort((a, b) => b.score - a.score);

  const codeLines = scopedFiles.reduce((s, f) => s + fileTexts.get(f)!.split('\n').length, 0);
  const dupLines = duplicates.reduce((s, g) => s + g.lines, 0);
  // Cycle penalty scales with how many files are trapped in cycle groups.
  const cyclesPenalty = cycles.reduce((s, c) => s + c.path.length, 0) * 2;
  const penalties =
    cyclesPenalty +
    unusedFiles.length * 2 +
    Math.min(unusedExports.length, 20) * 1 +
    Math.round((dupLines / Math.max(codeLines, 1)) * 100) +
    Math.min(hotspots.length, 15) * 2;
  const score = Math.max(0, Math.min(100, 100 - penalties));
  const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 65 ? 'C' : score >= 50 ? 'D' : 'E';

  return {
    projectPath: abs,
    analyzedFiles: scopedFiles.length,
    importEdges: edges.length,
    cycles,
    unusedFiles,
    unusedExports,
    duplicates,
    hotspots,
    score,
    grade,
  };
}
