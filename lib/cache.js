import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const CACHE_VERSION = 1;

function getCacheDir() {
  const base = process.env.CODEBASE_CACHE_DIR
    || process.env.LOCALAPPDATA
    || process.env.APPDATA
    || join(homedir(), ".cache");
  return join(base, "codebase-chat-cache");
}

function projectHash(absProject) {
  return createHash("sha256").update(absProject.toLowerCase()).digest("hex").slice(0, 16);
}

export function cachePath(absProject) {
  return join(getCacheDir(), `${projectHash(absProject)}.json`);
}

export async function loadCache(absProject) {
  const p = cachePath(absProject);
  if (!existsSync(p)) return null;
  try {
    const raw = await readFile(p, "utf8");
    const data = JSON.parse(raw);
    if (data?.version !== CACHE_VERSION) return null;
    return data;
  } catch {
    return null;
  }
}

export async function saveCache(absProject, data) {
  const p = cachePath(absProject);
  await mkdir(dirname(p), { recursive: true });
  const payload = {
    version: CACHE_VERSION,
    projectPath: absProject,
    updatedAt: Date.now(),
    ...data
  };
  await writeFile(p, JSON.stringify(payload), "utf8");
}

export function hashFile(stats, firstBytes = "") {
  return createHash("sha256")
    .update(`${stats.mtimeMs}:${stats.size}:${firstBytes.slice(0, 512)}`)
    .digest("hex")
    .slice(0, 24);
}

export async function fileStats(filePath) {
  try {
    return await stat(filePath);
  } catch {
    return null;
  }
}

export function estimateTokens(text) {
  return Math.ceil(text.length / 3.5);
}

export function truncateByTokens(text, maxTokens) {
  if (estimateTokens(text) <= maxTokens) return text;
  const targetChars = Math.floor(maxTokens * 3.5);
  const lines = text.split("\n");
  let acc = [];
  let chars = 0;
  for (const line of lines) {
    if (chars + line.length + 1 > targetChars) {
      acc.push("[... tronque pour respecter le budget de tokens ...]");
      break;
    }
    acc.push(line);
    chars += line.length + 1;
  }
  return acc.join("\n");
}
