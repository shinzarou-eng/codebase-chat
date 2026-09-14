export interface ImportEdge { from: string; to: string; }
export interface Cycle { path: string[]; }
export interface UnusedExport { file: string; name: string; line: number; }
export interface CloneGroup { files: string[]; lines: number; preview: string; }
export interface Hotspot { file: string; name?: string; startLine: number; score: number; }

export interface HealthReport {
  projectPath: string;
  analyzedFiles: number;
  importEdges: number;
  cycles: Cycle[];
  unusedFiles: string[];
  unusedExports: UnusedExport[];
  duplicates: CloneGroup[];
  hotspots: Hotspot[];
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'E';
}

export interface AnalyzeOptions {
  /** Restrict *reported findings* to these project-relative paths (e.g. a diff
   * scope). The import graph and usage checks still run on the whole project
   * so cycles/uses crossing the scope boundary are detected. */
  files?: Set<string>;
}

export interface ImportGraph {
  abs: string;
  codeFiles: string[];
  fileTexts: Map<string, string>;
  edges: ImportEdge[];
  inDegree: Map<string, number>;
}
