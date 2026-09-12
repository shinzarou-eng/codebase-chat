import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, relative, resolve, sep, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { loadProjectConfig, matchesAnyGlob, type ProjectConfig } from './config.js';

export interface TreeOptions {
  maxLines?: number;
  skipDirs?: Set<string>;
}

const SOURCE_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.vue', '.svelte', '.py', '.rs', '.go', '.java', '.kt',
  '.swift', '.cs', '.cpp', '.c', '.h', '.hpp',
  '.css', '.scss', '.less', '.html', '.json', '.yaml', '.yml', '.md'
]);

const DEFAULT_SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.output',
  'coverage', 'tmp', 'temp', '.cache', '.turbo', '.next',
  'android', 'ios', 'e2e-shots', 'playstore_screenshots',
  '.cursor', '.idea', '.memsearch', '.vscode', '__pycache__',
  '.dsh-tmp', '.dsh-vision-router',
  '.agents', '.claude', '.devin', '.playwright-mcp', '.windsurf'
]);

const DEFAULT_SKIP_FILES = new Set<string>([]);

export interface WalkOptions {
  skipDirs?: Set<string>;
  skipFiles?: Set<string>;
  ignoreGlobs?: string[];
}

/** Merge built-in skip lists with the project's `.codebase-chat.json` settings. */
export async function getWalkOptions(absProject: string): Promise<Required<WalkOptions>> {
  const cfg: ProjectConfig = await loadProjectConfig(absProject);
  return {
    skipDirs: new Set([...DEFAULT_SKIP_DIRS, ...(cfg.ignoreDirs ?? [])]),
    skipFiles: new Set([...DEFAULT_SKIP_FILES, ...(cfg.ignoreFiles ?? [])]),
    ignoreGlobs: cfg.ignoreGlobs ?? [],
  };
}

export function projectHash(absProject: string): string {
  return createHash('sha256').update(absProject.toLowerCase()).digest('hex').slice(0, 16);
}

export function resolveProjectPath(projectPath?: string): string {
  const raw = (projectPath ?? '').trim().replace(/['"]/g, '');
  if (!raw) return process.cwd();
  if (isAbsolute(raw)) return resolve(raw);
  return resolve(process.cwd(), raw);
}

export async function findProjectRoot(absProject: string): Promise<string> {
  try {
    const s = await stat(absProject);
    if (s.isDirectory()) return absProject;
    // If user points to a file, use its directory
    return resolve(absProject, '..');
  } catch {
    throw new Error(`Project path not found: ${absProject}`);
  }
}

export function getCacheDir(): string {
  const base = process.env.CODEBASE_CACHE_DIR
    || process.env.LOCALAPPDATA
    || process.env.APPDATA
    || join(homedir(), '.cache');
  return join(base, 'dsh-codebase-chat-cache');
}

export function cacheFilePath(absProject: string): string {
  return join(getCacheDir(), `${projectHash(absProject)}.json`);
}

export function fileHash(stats: { mtimeMs: number; size: number }, firstBytes = ''): string {
  return createHash('sha256')
    .update(`${stats.mtimeMs}:${stats.size}:${firstBytes.slice(0, 512)}`)
    .digest('hex')
    .slice(0, 24);
}

export async function* walkFiles(startDir: string, skipDirs = DEFAULT_SKIP_DIRS, skipFiles = DEFAULT_SKIP_FILES, ignoreGlobs: string[] = []): AsyncGenerator<string> {
  const queue: string[] = [startDir];
  while (queue.length) {
    const dir = queue.shift()!;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const rel = relative(startDir, fullPath).split(sep).join('/');
      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name) && !matchesAnyGlob(rel, ignoreGlobs)) queue.push(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (skipFiles.has(entry.name)) continue;
      if (matchesAnyGlob(rel, ignoreGlobs)) continue;
      const ext = extname(entry.name).toLowerCase();
      if (!SOURCE_EXTS.has(ext)) continue;
      yield fullPath;
    }
  }
}

export async function safeReadText(filePath: string): Promise<string | undefined> {
  try {
    const text = await readFile(filePath, 'utf8');
    return text;
  } catch {
    return undefined;
  }
}

export async function buildTree(startDir: string, maxLines = 500, skipDirs = DEFAULT_SKIP_DIRS): Promise<string> {
  const lines: string[] = [];

  async function walk(dir: string, prefix = '') {
    if (lines.length >= maxLines) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1));
    for (const entry of entries) {
      if (lines.length >= maxLines) return;
      if (skipDirs.has(entry.name)) continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        lines.push(`${prefix}${entry.name}/`);
        await walk(fullPath, `${prefix}  `);
      } else {
        lines.push(`${prefix}${entry.name}`);
      }
    }
  }

  await walk(startDir);
  return lines.join('\n');
}
