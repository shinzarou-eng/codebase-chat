// Project statistics - shared between `--stats` (CLI) and the `--ui` dashboard.
// o200k comes from the index (per-chunk counts), cl100k is re-encoded exactly;
// other model families are estimated ratios of cl100k on code-heavy text.

import { encode as encodeCl100k } from 'gpt-tokenizer/encoding/cl100k_base';
import { extname } from 'node:path';
import type { CodeIndex } from './types.js';
import { MODEL_PRICES, callCost, CALL_INPUT_TOKENS, CALL_OUTPUT_TOKENS } from './pricing.js';

export interface ModelTokenEstimate {
  family: string;
  tokenizer: string;
  tokens: number;
  exact: boolean;
  note: string;
}

export interface ContextWindowFit {
  model: string;
  window: number;
  fits: boolean;
  usedPct: number;
}

export interface ModelCallCost {
  label: string;
  priceIn: number;
  priceOut: number;
  /** USD for one --call at the default retrieval budget. */
  estCost: number;
  context?: string;
  free?: boolean;
}

export interface ProjectStats {
  projectPath: string;
  projectHash: string;
  files: number;
  chunks: number;
  terms: number;
  bytes: number;
  o200k: number;
  cl100k: number;
  models: ModelTokenEstimate[];
  windows: ContextWindowFit[];
  costs: ModelCallCost[];
  topFiles: { path: string; tokens: number }[];
  topExts: { ext: string; count: number }[];
}

const MODEL_RATIOS: { family: string; tokenizer: string; ratio: number; note: string }[] = [
  { family: 'DeepSeek V4', tokenizer: 'custom BPE', ratio: 1.0, note: 'close to cl100k on code' },
  { family: 'Claude 5', tokenizer: 'proprietary', ratio: 1.2, note: '~15-25% above cl100k on code' },
  { family: 'Gemini 3.x', tokenizer: 'SentencePiece', ratio: 0.95, note: 'within ±10% of cl100k' },
  { family: 'Grok/Llama/Mistral', tokenizer: 'BPE', ratio: 1.05, note: 'within ±10% of cl100k' },
];

const CONTEXT_WINDOWS: { model: string; window: number }[] = [
  { model: 'GPT-6 Astra / GPT-5.x', window: 1_050_000 },
  { model: 'Muse Spark 1.3', window: 1_050_000 },
  { model: 'Claude Fable/Opus/Sonnet 5', window: 1_000_000 },
  { model: 'Gemini 3.1 Pro / 3.8 Flash', window: 1_000_000 },
  { model: 'DeepSeek/Kimi/GLM', window: 1_000_000 },
  { model: 'Grok 4.6', window: 500_000 },
  { model: 'Mistral Nemo', window: 128_000 },
];

export function computeStats(index: CodeIndex): ProjectStats {
  const files = Object.values(index.files);
  const fileCount = files.length;
  const o200k = files.reduce((sum, f) => sum + f.chunks.reduce((s, c) => s + c.tokens, 0), 0);
  const chunkCount = files.reduce((sum, f) => sum + f.chunks.length, 0);
  const bytes = files.reduce((sum, f) => sum + f.size, 0);
  const allText = files.flatMap(f => f.chunks.map(c => c.content)).join('\n');
  const cl100k = encodeCl100k(allText).length;

  const models: ModelTokenEstimate[] = [
    { family: 'OpenAI GPT-5/6', tokenizer: 'o200k', tokens: o200k, exact: true, note: 'exact' },
    { family: 'OpenAI GPT-4 era', tokenizer: 'cl100k', tokens: cl100k, exact: true, note: 'exact' },
    ...MODEL_RATIOS.map(m => ({ family: m.family, tokenizer: m.tokenizer, tokens: Math.round(cl100k * m.ratio), exact: false, note: m.note })),
  ];

  const windows: ContextWindowFit[] = CONTEXT_WINDOWS.map(w => ({
    model: w.model,
    window: w.window,
    fits: cl100k < w.window,
    usedPct: Math.round(cl100k / w.window * 1000) / 10,
  }));

  // Cost of one --call: the 60k o200k budget converted into each family's
  // token count, plus up to 8,192 output tokens, at list price.
  const clRatio = o200k > 0 ? cl100k / o200k : 1;
  const costs: ModelCallCost[] = MODEL_PRICES.map(p => ({
    label: p.label,
    priceIn: p.inPerM,
    priceOut: p.outPerM,
    estCost: callCost(p, CALL_INPUT_TOKENS * clRatio * p.tokMult, CALL_OUTPUT_TOKENS),
    context: p.context,
    free: p.free,
  }));

  const topFiles = files
    .map(f => ({ path: f.relPath, tokens: f.chunks.reduce((s, c) => s + c.tokens, 0) }))
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 8);

  const extCount = new Map<string, number>();
  for (const f of files) extCount.set(extname(f.relPath) || '(none)', (extCount.get(extname(f.relPath) || '(none)') ?? 0) + 1);
  const topExts = [...extCount.entries()].map(([ext, count]) => ({ ext, count })).sort((a, b) => b.count - a.count).slice(0, 8);

  return {
    projectPath: index.projectPath,
    projectHash: index.projectHash,
    files: fileCount,
    chunks: chunkCount,
    terms: Object.keys(index.terms).length,
    bytes,
    o200k,
    cl100k,
    models,
    windows,
    costs,
    topFiles,
    topExts,
  };
}
