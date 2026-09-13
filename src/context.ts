import { join } from 'node:path';
import type { ContextOptions, ContextResult, CodeChunk } from './types.js';
import { countTokens, truncateToTokens } from './tokenizer.js';
import { embedIndex, getIndex } from './indexer.js';
import { scoreChunks, selectChunks } from './retriever.js';
import { findProjectRoot, resolveProjectPath, safeReadText } from './project.js';
import { loadProjectConfig } from './config.js';
import { getChangedFiles } from './diff.js';

const DEFAULT_MAX_TOKENS = 60_000;
const HEAD_BUDGET_TOKENS = 800;

interface Labels {
  project: string;
  focus: string;
  tree: string;
  noConstraints: string;
  constraints: string;
  answerIn: string;
  diffScope: (base: string, n: number) => string;
  diffUnavailable: (base: string) => string;
  noMatch: (q: string) => string;
}

function getLabels(lang: 'en' | 'fr'): Labels {
  return lang === 'en'
    ? {
        project: 'Project',
        focus: 'Focus',
        tree: 'File tree',
        noConstraints: 'No explicit constraints documented.',
        constraints: 'IDENTIFIED PRODUCT CONSTRAINTS',
        answerIn: 'Answer in English.',
        diffScope: (base, n) => `Scope: ${n} file(s) changed vs ${base}`,
        diffUnavailable: base => `Scope: diff vs ${base} unavailable (not a git repo?) — full project`,
        noMatch: q => `No code chunk matches "${q}" — context holds the file tree only.`,
      }
    : {
        project: 'Projet',
        focus: 'Focus',
        tree: 'Arborescence',
        noConstraints: 'Aucune contrainte explicite documentée.',
        constraints: 'CONTRAINTES PRODUIT IDENTIFIÉES',
        answerIn: 'Réponds obligatoirement en français.',
        diffScope: (base, n) => `Périmètre : ${n} fichier(s) modifié(s) vs ${base}`,
        diffUnavailable: base => `Périmètre : diff vs ${base} indisponible (pas un repo git ?) — projet complet`,
        noMatch: q => `Aucun fragment ne correspond à « ${q} » — le contexte ne contient que l'arborescence.`,
      };
}

async function extractProductConstraints(absProject: string): Promise<string[]> {
  const candidates = [
    'README.md', 'README.MD', 'readme.md', 'MEMORY.md', 'CONTRIBUTING.md',
    'AGENTS.md', 'CLAUDE.md', '.windsurfrules', '.cursorrules', '.cursorrules.md',
  ];
  const constraints: string[] = [];
  for (const name of candidates) {
    const text = await safeReadText(join(absProject, name));
    if (!text) continue;
    const regex = /(?:constraint|contrainte|must|doit|interdit|forbidden|rule|règle|limitation|never|always|jamais|toujours|zéro|zero)[\s\S]{0,200}/gi;
    let m;
    while ((m = regex.exec(text)) !== null) {
      const line = m[0].replace(/\s+/g, ' ').trim();
      if (line.length > 20) constraints.push(`[${name}] ${line}`);
    }
  }
  return constraints.slice(0, 12);
}

function formatChunk(chunk: CodeChunk): string {
  const kind = chunk.kind.toUpperCase();
  const source = `[source: ${chunk.relPath}:${chunk.startLine}-${chunk.endLine}]`;
  const kindLabel = chunk.kind === 'unknown' ? '' : ` (${kind})`;
  const header = `--- ${chunk.relPath}${chunk.name ? ` :: ${chunk.name}` : ''}${kindLabel} ${source} ---`;
  return `${header}\n${chunk.content}`;
}

export async function buildContext(options: ContextOptions): Promise<ContextResult> {
  const { project, query, filePath, searchQuery, instruction, embed = false, diff } = options;
  const absProject = await findProjectRoot(resolveProjectPath(project));
  const cfg = await loadProjectConfig(absProject);
  const maxTokens = options.maxTokens ?? cfg.maxTokens ?? DEFAULT_MAX_TOKENS;
  const lang = options.lang ?? cfg.lang ?? 'fr';
  const labels = getLabels(lang);
  const index = await getIndex(absProject);

  // --diff <base> — restrict retrieval to files changed vs the git ref.
  // The inverted index needs no rebuild: postings for out-of-scope files are
  // skipped by the index.files lookup during scoring.
  let scopedIndex = index;
  let diffFiles: string[] | undefined;
  let scopeLine = '';
  if (diff && !filePath) {
    const scope = await getChangedFiles(absProject, diff);
    if (scope.ok) {
      diffFiles = [...scope.files].filter(f => index.files[f]);
      const files: typeof index.files = {};
      for (const f of diffFiles) files[f] = index.files[f];
      scopedIndex = { ...index, files };
      scopeLine = `${labels.diffScope(diff, diffFiles.length)}\n`;
    } else {
      scopeLine = `${labels.diffUnavailable(diff)}\n`;
    }
  }

  if (embed) {
    try {
      await embedIndex(index);
    } catch {
      // embeddings are optional: fallback to lexical if the model is unavailable
    }
  }

  const focus = filePath ?? searchQuery ?? query;

  let selectedChunks: CodeChunk[] = [];
  let noMatch = false;

  const bodyLimit = maxTokens - HEAD_BUDGET_TOKENS;
  const maxChunkTokens = Math.floor(bodyLimit / 2);

  if (filePath) {
    const all = Object.values(index.files);
    const target =
      all.find(f => f.relPath === filePath) ??
      all.filter(f => f.relPath.endsWith(`/${filePath}`) || f.relPath.endsWith(filePath))
        .sort((a, b) => a.relPath.length - b.relPath.length)[0];
    if (target) {
      const { chunks } = selectChunks(
        target.chunks.map(c => ({ ...c, score: 0 })),
        bodyLimit,
        Infinity
      );
      selectedChunks = chunks;
    } else {
      // Not a file path — treat it as a symbol/term and search instead of failing.
      const scored = await scoreChunks(scopedIndex, filePath, embed);
      const { chunks } = selectChunks(scored, bodyLimit, maxChunkTokens, { minScoreRatio: 0.1 });
      if (chunks.length === 0) throw new Error(`File not found: ${filePath}`);
      selectedChunks = chunks;
    }
  } else if (searchQuery) {
    const scored = await scoreChunks(scopedIndex, searchQuery, embed);
    const { chunks } = selectChunks(scored, bodyLimit, maxChunkTokens, { minScoreRatio: 0.1 });
    selectedChunks = chunks;
    noMatch = chunks.length === 0;
  } else {
    const scored = await scoreChunks(scopedIndex, query, embed, { fallback: true });
    const { chunks } = selectChunks(scored, bodyLimit, maxChunkTokens);
    selectedChunks = chunks;
  }

  const constraints = await extractProductConstraints(absProject);
  const constraintsText = constraints.length
    ? `== ${labels.constraints} ==\n${constraints.map(c => `- ${c}`).join('\n')}`
    : `== ${labels.constraints} ==\n${labels.noConstraints}`;

  const head = `${labels.project} : ${absProject}\n${labels.focus} : ${focus}\n${scopeLine}${noMatch && searchQuery ? `${labels.noMatch(searchQuery)}\n` : ''}${constraintsText}\n\n== ${labels.tree} ==\n${index.tree}\n`;
  const headTokens = countTokens(head);

  const body = selectedChunks.map(c => formatChunk(c)).join('\n\n');
  const bodyBudget = Math.max(0, maxTokens - headTokens - 100);
  const truncatedBody = truncateToTokens(body, bodyBudget);

  const baseInstruction = `${labels.answerIn}\nAnswer the question or perform the requested task using the code context above. Cite every technical claim with [source: relative/path:line]. Provide confidence and severity where relevant.`;
  const finalInstruction = instruction ? `${instruction}\n\n${baseInstruction}` : baseInstruction;
  const prompt = `${head}\n\n${truncatedBody}\n\n${finalInstruction}`;

  const tokenCount = countTokens(prompt);

  return {
    absProject,
    context: prompt,
    chunks: selectedChunks,
    tokenCount,
    diffFiles,
    noMatch: noMatch || undefined,
  };
}
