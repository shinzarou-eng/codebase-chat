// Embedded local LLM — a small GGUF model served by node-llama-cpp, downloaded
// into the shared cache dir on first use. Enables fully-offline answers with
// no API key and no host model. Quality is limited vs hosted models, so it is
// opt-in via CODEBASE_LOCAL_LLM, the `localLlm` tool argument or `--local`.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getCacheDir } from './project.js';

// Small instruct model (~1 GB, CPU-friendly). Override with CODEBASE_LOCAL_LLM
// set to an `hf:owner/repo:QUANT` URI or an absolute path to a .gguf file.
const DEFAULT_MODEL_URI = 'hf:Qwen/Qwen2.5-1.5B-Instruct-GGUF:Q4_K_M';
const LOCAL_CONTEXT_SIZE = 8192;
const LOCAL_MAX_TOKENS = 1024;

export function isLocalLlmEnabled(): boolean {
  return !!(process.env.CODEBASE_LOCAL_LLM || '').trim();
}

function configuredModel(): string {
  const v = (process.env.CODEBASE_LOCAL_LLM || '').trim();
  if (!v || v === '1' || v.toLowerCase() === 'true') return DEFAULT_MODEL_URI;
  return v;
}

async function importLlama(): Promise<any> {
  try {
    return await import('node-llama-cpp');
  } catch {
    throw new Error('Local LLM needs the optional dependency: npm i node-llama-cpp');
  }
}

let modelPromise: Promise<any> | null = null;

function loadLocalModel(): Promise<any> {
  if (!modelPromise) {
    modelPromise = (async () => {
      const spec = configuredModel();
      let modelPath = spec;
      if (spec.startsWith('hf:')) {
        const { createModelDownloader } = await importLlama();
        const downloader = await createModelDownloader({
          modelUri: spec,
          dirPath: join(getCacheDir(), 'models'),
        });
        modelPath = await downloader.download();
      } else if (!existsSync(spec)) {
        throw new Error(`Local model not found: ${spec}`);
      }
      const { getLlama } = await importLlama();
      const llama = await getLlama();
      return llama.loadModel({ modelPath });
    })();
    modelPromise.catch(() => { modelPromise = null; });
  }
  return modelPromise;
}

export async function callLocalLlm(prompt: string, lang = 'fr'): Promise<string> {
  const model = await loadLocalModel();
  const { LlamaChatSession } = await importLlama();
  const context = await model.createContext({ contextSize: LOCAL_CONTEXT_SIZE });
  try {
    const session = new LlamaChatSession({
      contextSequence: context.getSequence(),
      systemPrompt: lang === 'en'
        ? 'You are a senior codebase analyst. Be precise and cite files with [source: path:line].'
        : 'Tu es un analyste codebase senior. Sois precis et cite les fichiers avec [source: chemin:ligne].',
    });
    return await session.prompt(prompt, { temperature: 0.2, maxTokens: LOCAL_MAX_TOKENS });
  } finally {
    await context.dispose();
  }
}
