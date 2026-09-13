/**
 * Standard list prices ($ per 1M tokens) for the current model lineup —
 * September 2026. Approximations: providers change tiers, intro pricing and
 * cache discounts often; verify on the provider's pricing page before
 * budgeting. CNY list prices converted at ≈ ¥7.1/$.
 *
 * `tokMult` = token-count multiplier vs cl100k for code-heavy text
 * (o200k ≈ cl100k × 0.997 — treated as 1.0).
 */

export interface ModelPrice {
  /** API id — also used to match CODEBASE_MODEL values. */
  id: string;
  label: string;
  tokMult: number;
  inPerM: number;
  outPerM: number;
  /** Human-readable context window / note. */
  context?: string;
  free?: boolean;
}

/** Default retrieval budget (o200k tokens) for one --call — see context.ts. */
export const CALL_INPUT_TOKENS = 60_000;
/** max_tokens sent by the --call request. */
export const CALL_OUTPUT_TOKENS = 8_192;

export const MODEL_PRICES: ModelPrice[] = [
  { id: 'gpt-6-astra',       label: 'GPT-6 Astra',       tokMult: 1.00, inPerM: 10,   outPerM: 50,   context: '1.05M' },
  { id: 'claude-fable-5-1',  label: 'Claude Fable 5.1',  tokMult: 1.20, inPerM: 10,   outPerM: 50,   context: '1M' },
  { id: 'claude-mythos-5-1', label: 'Claude Mythos 5.1', tokMult: 1.20, inPerM: 10,   outPerM: 50,   context: '1M — restricted (Glasswing)' },
  { id: 'claude-opus-5',     label: 'Claude Opus 5',     tokMult: 1.20, inPerM: 5,    outPerM: 25,   context: '1M' },
  { id: 'gpt-5.6-sol',       label: 'GPT-5.6 Sol',       tokMult: 1.00, inPerM: 5,    outPerM: 30,   context: '1.05M' },
  { id: 'claude-sonnet-5',   label: 'Claude Sonnet 5',   tokMult: 1.20, inPerM: 3,    outPerM: 15,   context: '1M' },
  { id: 'kimi-k3',           label: 'Kimi K3',           tokMult: 1.05, inPerM: 2.8,  outPerM: 14,   context: '—' },
  { id: 'gpt-5.4',           label: 'GPT-5.4',           tokMult: 1.00, inPerM: 2.5,  outPerM: 15,   context: '1.05M' },
  { id: 'gpt-5.6-terra',     label: 'GPT-5.6 Terra',     tokMult: 1.00, inPerM: 2,    outPerM: 12,   context: '1.05M' },
  { id: 'gemini-3.1-pro',    label: 'Gemini 3.1 Pro',    tokMult: 0.95, inPerM: 2,    outPerM: 12,   context: '1M' },
  { id: 'glm-5.2',           label: 'GLM-5.2',           tokMult: 1.05, inPerM: 1.1,  outPerM: 3.9,  context: '—' },
  { id: 'claude-haiku-4.5',  label: 'Claude Haiku 4.5',  tokMult: 1.20, inPerM: 1,    outPerM: 5,    context: '—' },
  { id: 'gpt-5.4-mini',      label: 'GPT-5.4-mini',      tokMult: 1.00, inPerM: 0.75, outPerM: 4.5,  context: '—' },
  { id: 'gemini-3.8-flash',  label: 'Gemini 3.8 Flash',  tokMult: 0.95, inPerM: 0.75, outPerM: 3.75, context: '1M — intro until 2027' },
  { id: 'deepseek-reasoner', label: 'DeepSeek V4 Pro',   tokMult: 1.00, inPerM: 0.42, outPerM: 0.84, context: '1M' },
  { id: 'gpt-5.6-luna',      label: 'GPT-5.6 Luna',      tokMult: 1.00, inPerM: 0.2,  outPerM: 1.2,  context: '—' },
  { id: 'grok-4.1-fast',     label: 'Grok 4.1 Fast',     tokMult: 1.05, inPerM: 0.2,  outPerM: 0.5,  context: '2M' },
  { id: 'deepseek-chat',     label: 'DeepSeek V4 Flash', tokMult: 1.00, inPerM: 0.14, outPerM: 0.28, context: '1M' },
  { id: 'mistral-nemo',      label: 'Mistral Nemo',      tokMult: 1.05, inPerM: 0.02, outPerM: 0.04, context: '128k' },
  { id: 'local',             label: 'Ollama / local',    tokMult: 1.05, inPerM: 0,    outPerM: 0,    free: true },
];

/** Estimated USD cost of one request at the given token counts. */
export function callCost(p: ModelPrice, inTok: number, outTok: number): number {
  return (inTok * p.inPerM + outTok * p.outPerM) / 1_000_000;
}

const KEYWORDS: [string, string][] = [
  ['astra', 'gpt-6-astra'], ['fable', 'claude-fable-5-1'], ['mythos', 'claude-mythos-5-1'],
  ['opus', 'claude-opus-5'], ['sonnet', 'claude-sonnet-5'], ['haiku', 'claude-haiku-4.5'],
  ['deepseek-reasoner', 'deepseek-reasoner'], ['deepseek', 'deepseek-chat'],
  ['gemini', 'gemini-3.8-flash'], ['grok', 'grok-4.1-fast'], ['kimi', 'kimi-k3'],
  ['glm', 'glm-5.2'], ['mistral', 'mistral-nemo'], ['nemo', 'mistral-nemo'],
  ['ollama', 'local'], ['local', 'local'], ['gpt-5.6', 'gpt-5.6-terra'], ['gpt', 'gpt-5.4'],
];

/** Match a CODEBASE_MODEL / --model value to a price row. */
export function matchModelPrice(modelId: string): ModelPrice | undefined {
  const m = modelId.toLowerCase();
  const exact = [...MODEL_PRICES].sort((a, b) => b.id.length - a.id.length).find(p => m.includes(p.id));
  if (exact) return exact;
  const hit = KEYWORDS.find(([k]) => m.includes(k));
  return hit ? MODEL_PRICES.find(p => p.id === hit[1]) : undefined;
}

/** Format a cost like `$0.026` / `$1.13` for display. */
export function fmtCost(usd: number): string {
  return usd < 0.01 ? `$${usd.toFixed(4)}` : usd < 1 ? `$${usd.toFixed(3)}` : `$${usd.toFixed(2)}`;
}
