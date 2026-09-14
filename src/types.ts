export interface CodeChunk {
  /** Relative path within the project */
  relPath: string;
  /** Start line (1-based) */
  startLine: number;
  /** End line (1-based) */
  endLine: number;
  /** Chunk content */
  content: string;
  /** Token count */
  tokens: number;
  /** Optional chunk kind */
  kind: 'file' | 'function' | 'class' | 'method' | 'type' | 'import' | 'export' | 'unknown';
  /** Optional symbol name */
  name?: string;
  /** Optional local embedding for semantic retrieval */
  embedding?: number[];
}

export interface CodeIndex {
  projectPath: string;
  projectHash: string;
  version: number;
  createdAt: number;
  updatedAt: number;
  tree: string;
  constraints: string[];
  files: Record<string, IndexedFile>;
  terms: InvertedIndex;
}

export interface IndexedFile {
  relPath: string;
  size: number;
  mtimeMs: number;
  hash: string;
  chunks: CodeChunk[];
}

export interface InvertedIndex {
  /** term -> { relPath -> count } */
  [term: string]: Record<string, number>;
}

export interface ContextOptions {
  /** Absolute or relative path to the project to analyse */
  project: string;
  /** User question or query */
  query: string;
  /** Optional file to focus on */
  filePath?: string;
  /** Optional search query */
  searchQuery?: string;
  /** Maximum total tokens in the returned context */
  maxTokens?: number;
  /** Language for headings */
  lang?: 'en' | 'fr';
  /** Optional final instruction appended to the prompt */
  instruction?: string;
  /** Enable local semantic embeddings for retrieval */
  embed?: boolean;
  /** Git ref (branch/tag/SHA) - scope retrieval to files changed vs this ref */
  diff?: string;
}

export interface ContextResult {
  absProject: string;
  context: string;
  chunks: CodeChunk[];
  tokenCount: number;
  /** Project-relative files in scope when `diff` was requested */
  diffFiles?: string[];
  /** True when a searchQuery matched no code chunk - context holds the tree only */
  noMatch?: boolean;
}
