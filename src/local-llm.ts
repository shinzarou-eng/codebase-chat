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
const LOCAL_MAX_TOKENS = 1536;

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

// Models are cached per backend — a GPU-loaded model can't serve a CPU retry.
const modelPromises = new Map<boolean, Promise<any>>();

function cpuOnly(): boolean {
  return /^(0|off|false|cpu)$/i.test(process.env.CODEBASE_LOCAL_GPU || '');
}

function loadLocalModel(gpu: boolean): Promise<any> {
  let p = modelPromises.get(gpu);
  if (!p) {
    p = (async () => {
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
      const llama = await getLlama(gpu ? {} : { gpu: false });
      return llama.loadModel({ modelPath });
    })();
    p.catch(() => modelPromises.delete(gpu));
    modelPromises.set(gpu, p);
  }
  return p;
}

async function runPrompt(prompt: string, lang: string, gpu: boolean): Promise<string> {
  const model = await loadLocalModel(gpu);
  const { LlamaChatSession } = await importLlama();
  const context = await model.createContext({ contextSize: LOCAL_CONTEXT_SIZE });
  try {
    const session = new LlamaChatSession({
      contextSequence: context.getSequence(),
      systemPrompt: lang === 'en'
        ? 'You are a senior codebase analyst. Be precise and cite files with [source: path:line].'
        : 'Tu es un analyste codebase senior. Sois precis et cite les fichiers avec [source: chemin:ligne].',
    });
    return await session.prompt(prompt, {
      temperature: 0.2,
      maxTokens: LOCAL_MAX_TOKENS,
      // Small models degenerate into loops at low temperature — penalize
      // repeated tokens so the answer moves forward instead of echoing.
      repeatPenalty: { lastTokens: 128, penalty: 1.2, penalizeNewLine: false },
    });
  } finally {
    await context.dispose();
  }
}

export async function callLocalLlm(prompt: string, lang = 'fr'): Promise<string> {
  if (cpuOnly()) return runPrompt(prompt, lang, false);
  try {
    return await runPrompt(prompt, lang, true);
  } catch (err) {
    // CUDA OOM can hit at model load OR context creation — retry the whole
    // pipeline on CPU.
    console.error(`[local-llm] GPU run failed (${err instanceof Error ? err.message : err}) — falling back to CPU. Slower, but works. Set CODEBASE_LOCAL_GPU=off to skip GPU entirely.`);
    return runPrompt(prompt, lang, false);
  }
}
