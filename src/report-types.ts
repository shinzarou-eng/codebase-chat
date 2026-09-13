// Shared types for the deterministic report — leaf module so report.ts and
// recommendations.ts don't import each other.

export interface Finding { file: string; line: number; sample: string; }
export interface SmellScan { [key: string]: Finding[]; }

export interface GitStats {
  commits: number;
  authors: Map<string, number>;
  lastDate: string;
  /** file -> total added+deleted lines across history */
  churn: Map<string, number>;
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
