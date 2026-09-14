import type { CodeChunk, CodeIndex } from './types.js';
import { getEmbedding, cosineSimilarity } from './embeddings.js';

const STOP_WORDS = new Set([
  'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'and', 'or', 'but', 'so', 'yet', 'a', 'an', 'this', 'that', 'these', 'those', 'it', 'its', 'he', 'she', 'they', 'them', 'their', 'we', 'us', 'our', 'you', 'your', 'i', 'me', 'my', 'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'et', 'ou', 'que', 'qui', 'quoi', 'dont', 'ce', 'cet', 'cette', 'ces', 'est', 'sont', 'etait', 'etaient', 'avoir', 'etre', 'faire', 'dans', 'pour', 'sur', 'avec', 'par', 'a', 'au', 'aux'
]);

function tokenizeQuery(text: string): string[] {
  return text
    .replace(/[^a-zA-Z0-9\u00C0-\u017F]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .filter(t => t.length > 2 && !STOP_WORDS.has(t));
}

interface ScoredChunk extends CodeChunk {
  score: number;
}

function getChunkKey(chunk: CodeChunk): string {
  return `${chunk.relPath}:${chunk.startLine}:${chunk.endLine}`;
}

function lexicalScore(index: CodeIndex, query: string): Map<string, number> {
  const terms = tokenizeQuery(query);
  const scores = new Map<string, number>();

  if (terms.length === 0) return scores;

  const totalFiles = Math.max(Object.keys(index.files).length, 1);

  for (const term of terms) {
    const posting = index.terms[term];
    if (!posting) continue;
    // IDF: rare terms (few files) weigh more than ubiquitous ones.
    const df = Object.keys(posting).length;
    const idf = Math.log(1 + totalFiles / df);
    for (const [relPath, count] of Object.entries(posting)) {
      const file = index.files[relPath];
      if (!file) continue;
      for (const chunk of file.chunks) {
        const key = getChunkKey(chunk);
        const contentHit = chunk.content.toLowerCase().includes(term);
        const nameHit = chunk.name ? tokenizeQuery(chunk.name).includes(term) : false;
        // File-level term counts only matter for chunks that actually mention
        // the term - otherwise every chunk in a matched file inherits the score.
        if (!contentHit && !nameHit) continue;
        const bonus =
          (nameHit ? 4 : 0) +
          (chunk.kind === 'function' || chunk.kind === 'method' ? 1 : 0) +
          (contentHit ? 1 : 0);
        const prev = scores.get(key) ?? 0;
        scores.set(key, prev + count * idf + bonus);
      }
    }
  }

  return scores;
}

/**
 * Score all chunks against a query using the inverted index and, when available,
 * local sentence embeddings.
 */
export async function scoreChunks(index: CodeIndex, query: string, embed = false, opts: { fallback?: boolean } = {}): Promise<ScoredChunk[]> {
  const lexScores = lexicalScore(index, query);

  // gather all chunks once
  const allChunks: CodeChunk[] = [];
  for (const file of Object.values(index.files)) {
    allChunks.push(...file.chunks);
  }

  let queryEmbedding: number[] | null = null;
  const hasEmbeddings = embed && allChunks.some(c => c.embedding && c.embedding.length > 0);

  if (hasEmbeddings) {
    try {
      queryEmbedding = await getEmbedding(query);
    } catch {
      queryEmbedding = null;
    }
  }

  const scored: ScoredChunk[] = [];
  for (const chunk of allChunks) {
    const key = getChunkKey(chunk);
    let score = lexScores.get(key) ?? 0;

    if (queryEmbedding && chunk.embedding && chunk.embedding.length === queryEmbedding.length) {
      const sim = cosineSimilarity(queryEmbedding, chunk.embedding);
      // semantic score is in [0, 1], scale it so it competes with lexical scores
      score += sim * 50;
    } else if (score === 0 && !hasEmbeddings && opts.fallback) {
      // generic queries (audit/intelligence) still get the whole codebase as context
      score = 0.1;
    }

    if (score <= 0) continue;
    scored.push({ ...chunk, score });
  }

  return scored.sort((a, b) => b.score - a.score);
}

/**
 * Select chunks to fit within a token budget, keeping the most relevant first.
 */
export function selectChunks(scored: ScoredChunk[], maxTokens: number, maxChunkTokens = Infinity, opts: { minScoreRatio?: number } = {}): { chunks: CodeChunk[]; tokens: number } {
  const result: CodeChunk[] = [];
  const covered = new Map<string, [number, number][]>();
  const top = scored[0]?.score ?? 0;
  const minScore = top > 0 && opts.minScoreRatio ? top * opts.minScoreRatio : 0;
  let used = 0;
  for (const chunk of scored) {
    if (minScore > 0 && chunk.score < minScore) continue;
    if (chunk.tokens > maxChunkTokens) continue;
    if (used + chunk.tokens > maxTokens) continue;
    // Skip chunks fully covered by an already-selected chunk of the same file
    // (e.g. a method chunk inside a class chunk already picked).
    const ranges = covered.get(chunk.relPath) ?? [];
    const duplicated = ranges.some(([s, e]) => chunk.startLine >= s && chunk.endLine <= e);
    if (duplicated) continue;
    ranges.push([chunk.startLine, chunk.endLine]);
    covered.set(chunk.relPath, ranges);
    result.push(chunk);
    used += chunk.tokens;
  }
  return { chunks: result, tokens: used };
}
