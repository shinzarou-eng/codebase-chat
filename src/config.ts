import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export type ConfigLang = 'fr' | 'en';

/**
 * Per-project settings read from `.codebase-chat.json` at the project root.
 * Every field is optional — unset fields fall back to built-in defaults.
 */
export interface ProjectConfig {
  /** Default output language when the caller does not pass `lang` */
  lang?: ConfigLang;
  /** Default token budget for built contexts when the caller does not pass `maxTokens` */
  maxTokens?: number;
  /** Extra directory names skipped during indexing and analysis */
  ignoreDirs?: string[];
  /** Extra file names skipped during indexing and analysis */
  ignoreFiles?: string[];
  /** Glob patterns matched against project-relative paths (e.g. "generated/**") */
  ignoreGlobs?: string[];
  /** Extra paths that can never be patched (project-relative or absolute) */
  protectedPaths?: string[];
}

export const CONFIG_FILE = '.codebase-chat.json';

const configCache = new Map<string, ProjectConfig>();

function strArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
  return out.length ? out.map(s => s.trim()) : undefined;
}

function sanitize(raw: unknown): ProjectConfig {
  if (raw == null || typeof raw !== 'object') return {};
  const o = raw as Record<string, unknown>;
  const cfg: ProjectConfig = {};
  if (o.lang === 'fr' || o.lang === 'en') cfg.lang = o.lang;
  if (typeof o.maxTokens === 'number' && Number.isFinite(o.maxTokens) && o.maxTokens > 0) {
    cfg.maxTokens = Math.floor(o.maxTokens);
  }
  const ignoreDirs = strArray(o.ignoreDirs); if (ignoreDirs) cfg.ignoreDirs = ignoreDirs;
  const ignoreFiles = strArray(o.ignoreFiles); if (ignoreFiles) cfg.ignoreFiles = ignoreFiles;
  const ignoreGlobs = strArray(o.ignoreGlobs); if (ignoreGlobs) cfg.ignoreGlobs = ignoreGlobs;
  const protectedPaths = strArray(o.protectedPaths); if (protectedPaths) cfg.protectedPaths = protectedPaths;
  return cfg;
}

/** Read `.codebase-chat.json` from the project root. Missing/invalid file → defaults. */
export async function loadProjectConfig(absProject: string): Promise<ProjectConfig> {
  const cached = configCache.get(absProject);
  if (cached) return cached;
  let cfg: ProjectConfig = {};
  try {
    cfg = sanitize(JSON.parse(await readFile(join(absProject, CONFIG_FILE), 'utf8')));
  } catch {
    // missing or malformed config file — keep defaults
  }
  configCache.set(absProject, cfg);
  return cfg;
}

/** Test/debug helper: drop the cached config for a project. */
export function clearConfigCache(absProject?: string): void {
  if (absProject == null) configCache.clear();
  else configCache.delete(absProject);
}

function escapeSegment(s: string): string {
  return s.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]');
}

/** Minimal glob → RegExp: `**` spans directories, `*` one segment, `?` one char. */
export function globToRegExp(glob: string): RegExp {
  const src = glob.replace(/\\/g, '/').split('**').map(escapeSegment).join('.*');
  return new RegExp(`^${src}$`);
}

/** Match a project-relative path (posix separators) against a list of globs. Globs without `/` match the basename at any depth (gitignore-style). */
export function matchesAnyGlob(relPath: string, globs: string[] | undefined): boolean {
  if (!globs || globs.length === 0) return false;
  const rel = relPath.replace(/\\/g, '/');
  const base = rel.split('/').pop() ?? rel;
  return globs.some(g => {
    const re = globToRegExp(g);
    return re.test(rel) || (!g.includes('/') && re.test(base));
  });
}
