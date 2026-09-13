import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { existsSync } from 'node:fs';
import type { CodeIndex, IndexedFile, InvertedIndex } from './types.js';
import { extractChunks } from './extractor.js';
import { ensureTreeSitterForExt } from './treesitter.js';
import { countTokens } from './tokenizer.js';
import { getEmbeddings } from './embeddings.js';
import {
  buildTree,
  cacheFilePath,
  fileHash,
  findProjectRoot,
  getWalkOptions,
  projectHash,
  resolveProjectPath,
  safeReadText,
  walkFiles,
} from './project.js';

const INDEX_VERSION = 5;

const STOP_WORDS = new Set([
  'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'and', 'or', 'but', 'so', 'yet', 'a', 'an', 'this', 'that', 'these', 'those', 'it', 'its', 'he', 'she', 'they', 'them', 'their', 'we', 'us', 'our', 'you', 'your', 'i', 'me', 'my', 'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'et', 'ou', 'que', 'qui', 'quoi', 'dont', 'ce', 'cet', 'cette', 'ces', 'est', 'sont', 'etait', 'etaient', 'avoir', 'etre', 'faire', 'dans', 'pour', 'sur', 'avec', 'par', 'a', 'au', 'aux'
]);

function tokenizeTerms(text: string): string[] {
  return text
    .replace(/[^a-zA-Z0-9\u00C0-\u017F]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .filter(t => t.length > 1 && !STOP_WORDS.has(t));
}

function buildInvertedIndex(files: Record<string, IndexedFile>): InvertedIndex {
  const index: InvertedIndex = {};
  for (const file of Object.values(files)) {
    for (const chunk of file.chunks) {
      const terms = new Set([
        ...tokenizeTerms(chunk.content),
        ...tokenizeTerms(chunk.relPath),
        ...tokenizeTerms(chunk.name ?? ''),
      ]);
      for (const term of terms) {
        if (!index[term]) index[term] = {};
        if (!index[term][file.relPath]) index[term][file.relPath] = 0;
        index[term][file.relPath] += 1;
      }
    }
  }
  return index;
}

export async function loadIndex(projectPath: string): Promise<CodeIndex | null> {
  const absProject = await findProjectRoot(resolveProjectPath(projectPath));
  const p = cacheFilePath(absProject);
  if (!existsSync(p)) return null;
  try {
    const raw = await readFile(p, 'utf8');
    const data = JSON.parse(raw) as CodeIndex;
    if (data.version !== INDEX_VERSION) return null;
    return data;
  } catch {
    return null;
  }
}

export async function saveIndex(index: CodeIndex): Promise<void> {
  const p = cacheFilePath(index.projectPath);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(index), 'utf8');
}

export async function embedIndex(index: CodeIndex, progress?: (message: string) => void): Promise<void> {
  const allChunks = Object.values(index.files).flatMap(f => f.chunks);
  const missing = allChunks.filter(c => !c.embedding || c.embedding.length === 0);
  if (missing.length === 0) return;

  const batchSize = 32;
  for (let i = 0; i < missing.length; i += batchSize) {
    const batch = missing.slice(i, i + batchSize);
    progress?.(`Embedding ${i + batch.length}/${missing.length} chunks...`);
    try {
      const vectors = await getEmbeddings(batch.map(c => c.content));
      for (let j = 0; j < batch.length; j++) {
        batch[j].embedding = vectors[j];
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      progress?.(`Embedding failed: ${msg}`);
      break;
    }
  }

  await saveIndex(index);
}

export async function buildIndex(projectPath: string, progress?: (message: string) => void): Promise<CodeIndex> {
  const absProject = await findProjectRoot(resolveProjectPath(projectPath));
  const projectName = absProject.split(sep).pop() ?? 'project';

  progress?.(`Indexing ${projectName}...`);

  const walk = await getWalkOptions(absProject);
  const tree = await buildTree(absProject, undefined, walk.skipDirs, walk.skipFiles, walk.ignoreGlobs);
  const startDir = absProject;
  const previous = await loadIndex(absProject);
  const previousFiles = previous?.projectPath === absProject ? previous.files : {};
  const files: Record<string, IndexedFile> = {};
  let totalTokens = 0;
  let reused = 0;

  for await (const fullPath of walkFiles(startDir, walk.skipDirs, walk.skipFiles, walk.ignoreGlobs)) {
    const relPath = relative(startDir, fullPath).split(sep).join('/');
    progress?.(`Reading ${relPath}`);

    const fstats = await stat(fullPath);

    // Reuse cached chunks when the file signature is unchanged (mtime + size).
    const cached = previousFiles[relPath];
    if (cached && cached.mtimeMs === fstats.mtimeMs && cached.size === fstats.size) {
      files[relPath] = cached;
      reused++;
      totalTokens += cached.chunks.reduce((sum, c) => sum + c.tokens, 0);
      continue;
    }

    const text = await safeReadText(fullPath);
    if (!text) continue;

    const hash = fileHash(fstats, text);

    // Lazy-load the tree-sitter grammar for this extension (cached after first call).
    const ext = relPath.slice(relPath.lastIndexOf('.')).toLowerCase();
    await ensureTreeSitterForExt(ext);

    const chunks = extractChunks(relPath, text).map(chunk => ({
      ...chunk,
      // recompute tokens to be safe
      tokens: countTokens(chunk.content),
    }));

    totalTokens += chunks.reduce((sum, c) => sum + c.tokens, 0);

    files[relPath] = {
      relPath,
      size: fstats.size,
      mtimeMs: fstats.mtimeMs,
      hash,
      chunks,
    };
  }

  const now = Date.now();
  const index: CodeIndex = {
    projectPath: absProject,
    projectHash: projectHash(absProject),
    version: INDEX_VERSION,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    tree,
    constraints: [],
    files,
    terms: buildInvertedIndex(files),
  };

  await saveIndex(index);
  progress?.(`Indexed ${Object.keys(files).length} files, ~${totalTokens} tokens${reused ? ` (${reused} unchanged reused)` : ''}`);
  return index;
}

export async function getIndex(projectPath: string, progress?: (message: string) => void, force = false): Promise<CodeIndex> {
  const resolved = resolveProjectPath(projectPath);
  const absProject = await findProjectRoot(resolved);
  const existing = force ? null : await loadIndex(resolved);
  if (existing && existing.projectPath === absProject) {
    // Fast freshness check: mtime + size only, no file reads.
    let stale = false;
    for (const file of Object.values(existing.files)) {
      const fullPath = join(absProject, file.relPath);
      try {
        const fstats = await stat(fullPath);
        if (fstats.mtimeMs !== file.mtimeMs || fstats.size !== file.size) {
          stale = true;
          break;
        }
      } catch {
        stale = true;
        break;
      }
    }
    if (!stale) {
      // Same walk as buildIndex: catch files added or deleted since indexing.
      const walk = await getWalkOptions(absProject);
      const current = new Set<string>();
      for await (const fullPath of walkFiles(absProject, walk.skipDirs, walk.skipFiles, walk.ignoreGlobs)) {
        current.add(relative(absProject, fullPath).split(sep).join('/'));
      }
      const indexed = Object.keys(existing.files);
      stale = current.size !== indexed.length || indexed.some(f => !current.has(f));
    }
    if (!stale) {
      progress?.('Loaded index from cache');
      return existing;
    }
  }
  return buildIndex(projectPath, progress);
}


