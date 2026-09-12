import { pipeline, type FeatureExtractionPipeline } from '@xenova/transformers';
import { chunkByTokens, countTokens } from './tokenizer.js';

const DEFAULT_MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';

let extractor: FeatureExtractionPipeline | null = null;
let activeModel = '';

export async function getExtractor(model = DEFAULT_MODEL): Promise<FeatureExtractionPipeline> {
  if (extractor && activeModel === model) return extractor;
  activeModel = model;
  extractor = await pipeline('feature-extraction', model, {
    quantized: true,
  });
  return extractor;
}

/** Truncate long texts to a token budget before embedding. */
function prepareText(text: string, maxTokens = 256): string {
  if (countTokens(text) <= maxTokens) return text;
  return chunkByTokens(text, maxTokens)[0] ?? text.slice(0, 1024);
}

function tensorToVectors(tensor: { dims: number[]; data: Float32Array }): number[][] {
  const [count, dim] = tensor.dims;
  const vectors: number[][] = [];
  for (let i = 0; i < count; i++) {
    vectors.push(Array.from(tensor.data.subarray(i * dim, (i + 1) * dim)));
  }
  return vectors;
}

/** Compute a single embedding. */
export async function getEmbedding(text: string, model = DEFAULT_MODEL): Promise<number[]> {
  const pipe = await getExtractor(model);
  const out = (await pipe(prepareText(text), {
    pooling: 'mean',
    normalize: true,
  })) as unknown as { data: Float32Array };
  return Array.from(out.data);
}

/** Compute embeddings for many texts in one call. */
export async function getEmbeddings(texts: string[], model = DEFAULT_MODEL): Promise<number[][]> {
  const pipe = await getExtractor(model);
  const inputs = texts.map(t => prepareText(t));
  const out = (await pipe(inputs, {
    pooling: 'mean',
    normalize: true,
  })) as unknown as { dims: number[]; data: Float32Array };
  return tensorToVectors(out);
}

/** Cosine similarity of two normalized vectors (or any vectors). */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}
