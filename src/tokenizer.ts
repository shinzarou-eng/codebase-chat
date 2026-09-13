import { encode, decode } from 'gpt-tokenizer';

/**
 * Count the exact number of tokens for a given text using the o200k base
 * tokenizer (gpt-tokenizer v4 default — used by GPT-4o / GPT-5 / o-series).
 */
export function countTokens(text: string): number {
  return encode(text).length;
}

/**
 * Split a text into token chunks of at most `maxTokens`.
 * Tries to keep whole lines when possible.
 */
export function chunkByTokens(text: string, maxTokens: number, overlapTokens = 0): string[] {
  if (maxTokens <= 0) throw new RangeError('maxTokens must be positive');

  const tokens = encode(text);
  const chunks: string[] = [];
  const step = maxTokens - overlapTokens;

  for (let i = 0; i < tokens.length; i += step) {
    const end = Math.min(i + maxTokens, tokens.length);
    const slice = tokens.slice(i, end);
    chunks.push(decode(slice));
    if (end === tokens.length) break;
  }

  return chunks;
}

/**
 * Truncate a text to a maximum number of tokens, appending an ellipsis if truncated.
 */
export function truncateToTokens(text: string, maxTokens: number): string {
  const tokens = encode(text);
  if (tokens.length <= maxTokens) return text;
  const keep = Math.max(0, maxTokens - 5);
  const truncated = tokens.slice(0, keep);
  return `${decode(truncated)} [...]`;
}
