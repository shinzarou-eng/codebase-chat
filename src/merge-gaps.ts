import type { CodeChunk } from './types.js';
import { countTokens } from './tokenizer.js';

/**
 * Add 'file' chunks covering lines not already in a named chunk,
 * so nothing is lost from the original file.
 */
export function mergeGaps(content: string, relPath: string, namedChunks: CodeChunk[], visitedRanges: [number, number][]): CodeChunk[] {
  const lines = content.split('\n');
  if (lines.length === 0) return namedChunks;

  const covered = new Set<number>();
  for (const [start, end] of visitedRanges) {
    for (let i = start; i <= end; i++) covered.add(i);
  }

  const all: CodeChunk[] = [];
  let start = 1;
  for (let i = 1; i <= lines.length; i++) {
    if (!covered.has(i)) continue;
    if (i > start) {
      const gapText = lines.slice(start - 1, i - 1).join('\n');
      if (gapText.trim()) all.push({ relPath, startLine: start, endLine: i - 1, content: gapText, tokens: countTokens(gapText), kind: 'file' });
    }
    start = i + 1;
  }
  if (start <= lines.length) {
    const gapText = lines.slice(start - 1).join('\n');
    if (gapText.trim()) all.push({ relPath, startLine: start, endLine: lines.length, content: gapText, tokens: countTokens(gapText), kind: 'file' });
  }

  return [...all, ...namedChunks].sort((a, b) => a.startLine - b.startLine);
}
