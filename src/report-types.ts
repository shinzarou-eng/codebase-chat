// Shared types for the deterministic report - leaf module so report.ts and
// recommendations.ts don't import each other.
import type { CodeIndex } from './types.js';
import type { HealthReport, ImportGraph } from './analysis.js';

export interface Finding { file: string; line: number; sample: string; }
export interface SmellScan { [key: string]: Finding[]; }

export type Severity = 'Critique' | 'Élevée' | 'Moyenne' | 'Faible';
export interface AuditFinding {
  /** Stable across line drift: `${rule}:${file}` for file-level rules, `${rule}:${file}:${fp}` for line-level (fp = sample lowercased, whitespace collapsed, first 60 chars). Never includes the line number. */
  id: string;
  rule: string;
  severity: Severity;
  file?: string;
  line?: number;
  message: string;
}

/** Everything the deterministic audit computes - collectAudit output, consumed
 *  by renderAuditMd, auditFindings, baselines and --check. */
export interface AuditData {
  index: CodeIndex;
  graph: ImportGraph;
  health: HealthReport;
  name: string;
  pkg: Record<string, any>;
  langs: [string, number][];
  deps: string[];
  devDeps: string[];
  scripts: string[];
  symbols: number;
  hubs: [string, number][];
  entryPoints: string[];
  leaves: number;
  testFiles: string[];
  srcFiles: string[];
  testRatio: number;
  largest: { f: string; lines: number }[];
  docs: string[];
  smells: SmellScan;
  sec: SmellScan;
  secTotals: Record<string, number>;
  hasTests: boolean;
  git: GitStats | null;
  infra: string[];
  env: { used: string[]; undocumented: string[]; hasTemplate: boolean };
  deadDeps: string[];
  missing: string[];
  lockDrift: string[];
  fnComplex: { file: string; name: string; score: number }[];
  dupNames: { name: string; files: string[] }[];
  asyncNoAwait: { file: string; name: string }[];
  maxDepth: number;
  cfg: { tsStrict: boolean | null; gitignore: boolean; pkgMissing: string[]; isGit: boolean };
  longFns: { file: string; name: string; lines: number }[];
  brokenEntries: string[];
  deepRel: Finding[];
  shape: { commentPct: number; deepNest: { file: string; depth: number }[] };
  readme: { install: boolean; usage: boolean; codeBlocks: number; badges: number } | null;
  commitQ: { conventionalPct: number; avgLen: number } | null;
  typedFiles: number;
  typedPct: number;
  staleHubs: { f: string; n: number; last: string }[];
  sensitive: string[];
  docCov: { documented: number; total: number };
  docPct: number;
  riskFiles: { file: string; churn: number; commits: number; score: number }[];
  untestedRisk: { file: string; churn: number; commits: number; score: number }[];
  testBases: Set<string>;
  topChurn: [string, number][];
}

export interface GitStats {
  commits: number;
  authors: Map<string, number>;
  lastDate: string;
  /** file -> total added+deleted lines across history */
  churn: Map<string, number>;
  /** file -> commit count touching it */
  fileCommits: Map<string, number>;
  /** file -> distinct authors */
  fileAuthors: Map<string, Set<string>>;
  /** YYYY-MM -> commit count (activity timeline) */
  months: Map<string, number>;
  /** git-tracked files matching sensitive patterns (.env, *.pem, …) */
  sensitiveTracked: string[];
  /** file -> date of its most recent commit (first seen in log order) */
  fileLastCommit: Map<string, string>;
  /** commit subjects for message-quality stats */
  subjects: string[];
  /** per-commit size: files touched + lines changed */
  commitSizes: { files: number; lines: number }[];
}
