// --doctor - installation & environment diagnostic. Read-only: never prints
// secret values, only presence/absence.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { basename, join } from 'node:path';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import { findProjectRoot, resolveProjectPath, getCacheDir, cacheFilePath } from './project.js';
import { loadIndex, INDEX_VERSION } from './indexer.js';
import { loadProjectConfig, CONFIG_FILE } from './config.js';
import { getChangedFiles } from './diff.js';
import { readBaseline, BASELINE_REL } from './baseline.js';
import { matchModelPrice } from './pricing.js';
import { initTreeSitter } from './treesitter.js';

const run = promisify(execFile);
const require = createRequire(import.meta.url);

export interface DoctorItem { label: string; status: 'ok' | 'warn' | 'fail'; detail: string }
export interface DoctorReport { project: string; items: DoctorItem[]; ok: boolean }

function pkgVersion(): string {
  try { return (require('../package.json') as { version?: string }).version ?? '?'; } catch { return '?'; }
}

function mcpClientPaths(home: string): { id: string; path: string }[] {
  const appdata = process.env.APPDATA || join(home, 'AppData', 'Roaming');
  return [
    { id: 'Claude Desktop', path: join(appdata, 'Claude', 'claude_desktop_config.json') },
    { id: 'Claude Code', path: join(home, '.claude.json') },
    { id: 'Cursor', path: join(home, '.cursor', 'mcp.json') },
    { id: 'Windsurf', path: join(home, '.codeium', 'windsurf', 'mcp_config.json') },
    { id: 'VS Code', path: join(appdata, 'Code', 'User', 'mcp.json') },
  ];
}

export async function runDoctor(projectPath: string, lang: 'fr' | 'en'): Promise<DoctorReport> {
  const en = lang === 'en';
  const items: DoctorItem[] = [];
  const add = (label: string, status: DoctorItem['status'], detail: string) => items.push({ label, status, detail });

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  add('Node.js', nodeMajor >= 20 ? 'ok' : 'fail',
    `v${process.versions.node}${nodeMajor < 20 ? (en ? ' — requires >= 20' : ' — >= 20 requis') : ''}`);

  add('codebase-chat', 'ok', `v${pkgVersion()}`);

  // Project / git
  const abs = await findProjectRoot(resolveProjectPath(projectPath));
  let head: string | undefined;
  try {
    head = (await run('git', ['-C', abs, 'rev-parse', '--short', 'HEAD'])).stdout.trim() || undefined;
  } catch { /* not a git repo */ }
  if (head) {
    const scope = await getChangedFiles(abs, 'HEAD');
    const n = scope.ok ? scope.files.size : 0;
    add(en ? 'Project' : 'Projet', 'ok',
      `${abs} — git, HEAD \`${head}\`, ${n} ${en ? 'file(s) changed vs HEAD' : 'fichier(s) modifié(s) vs HEAD'}`);
  } else {
    add(en ? 'Project' : 'Projet', 'warn', `${abs} — ${en ? 'not a git repository' : 'pas un dépôt git'}`);
  }

  // Index cache
  const idx = await loadIndex(abs);
  const cachePath = cacheFilePath(abs);
  if (idx) {
    const ageH = Math.round((Date.now() - idx.updatedAt) / 3600000);
    const verOk = idx.version === INDEX_VERSION;
    add('Index', 'ok',
      `${Object.keys(idx.files).length} ${en ? 'files' : 'fichiers'} · ${ageH}h · v${idx.version}${verOk ? '' : ` (≠ ${INDEX_VERSION})`} · ${cachePath}`);
  } else {
    add('Index', 'warn',
      `${en ? 'no cached index (or stale version) — run' : 'aucun index en cache (ou version périmée) — lancez'} \`--index\` · ${getCacheDir()}`);
  }

  // Project config
  const cfgPath = join(abs, CONFIG_FILE);
  if (existsSync(cfgPath)) {
    const cfg = await loadProjectConfig(abs);
    add('Config', 'ok',
      `${CONFIG_FILE} — lang ${cfg.lang ?? '-'} · ${cfg.ignoreGlobs?.length ?? 0} ignore globs · ${cfg.protectedPaths?.length ?? 0} protectedPaths`);
  } else {
    add('Config', 'ok', `${en ? 'no' : 'pas de'} ${CONFIG_FILE} (${en ? 'defaults' : 'défauts'})`);
  }

  // LLM - presence only, never values
  const model = process.env.CODEBASE_MODEL || 'deepseek-chat';
  const hasKey = !!(process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY);
  const base = process.env.OPENAI_BASE_URL || process.env.DEEPSEEK_BASE_URL;
  const mp = matchModelPrice(model);
  add('LLM', hasKey ? 'ok' : 'warn',
    hasKey
      ? `${en ? 'API key set' : 'clé API présente'} · model \`${model}\`${mp ? '' : (en ? ' (unknown pricing)' : ' (prix inconnu)')}${base ? ' · custom base URL' : ''}`
      : `${en ? 'no API key — prompt-only mode (--no-llm)' : 'pas de clé API — mode prompt-only (--no-llm)'}`);

  // Embeddings - probing would download the model; report opt-in only
  add('Embeddings', 'ok', en ? 'optional — enable with --embed' : 'optionnel — activer avec --embed');

  const ts = await initTreeSitter();
  add('tree-sitter', ts ? 'ok' : 'warn',
    ts ? (en ? 'WASM parser loaded' : 'parseur WASM chargé') : (en ? 'fallback regex extraction' : 'extraction regex de secours'));

  // Baseline
  const bl = await readBaseline(abs);
  if (bl) {
    const stale = head && bl.head && bl.head !== head;
    add('Baseline', stale ? 'warn' : 'ok',
      `${BASELINE_REL} — ${bl.createdAt.slice(0, 10)} · HEAD \`${bl.head ?? '-'}\` · ${bl.findings.length} findings${stale ? (en ? ' — stale (HEAD moved)' : ' — périmée (HEAD a bougé)') : ''}`);
  } else {
    add('Baseline', 'warn', `${en ? 'none —' : 'absente —'} \`--baseline\` ${en ? 'to create one' : 'pour en créer une'}`);
  }

  // Integrations
  const home = homedir();
  const cmd = join(home, '.claude', 'commands', 'codebase.md');
  const clients: string[] = [];
  for (const c of mcpClientPaths(home)) {
    try {
      if (existsSync(c.path) && (await readFile(c.path, 'utf8')).includes('codebase-chat')) clients.push(c.id);
    } catch { /* unreadable — skip */ }
  }
  add(en ? 'Integrations' : 'Intégrations', existsSync(cmd) || clients.length ? 'ok' : 'warn',
    `${existsSync(cmd) ? '/codebase ✓' : `/codebase ${en ? 'missing' : 'absent'}`} · MCP: ${clients.length ? clients.join(', ') : (en ? 'none configured' : 'aucun client configuré')}`);

  return { project: abs, items, ok: !items.some(i => i.status === 'fail') };
}

export function formatDoctorMd(r: DoctorReport, lang: 'fr' | 'en'): string {
  const en = lang === 'en';
  const icon = { ok: '🟢', warn: '🟡', fail: '🔴' } as const;
  const out = [
    `# ${en ? 'Diagnosis' : 'Diagnostic'} — \`${basename(r.project)}\``, '',
    `| ${en ? 'Status' : 'État'} | ${en ? 'Check' : 'Point'} | ${en ? 'Detail' : 'Détail'} |`,
    '|---|---|---|',
    ...r.items.map(i => `| ${icon[i.status]} | ${i.label} | ${i.detail} |`),
    '', '---',
    `_${en ? 'Made with passion by shinzarou-eng' : 'Fait avec passion par shinzarou-eng'} — codebase-chat · ${en ? 'deterministic mode' : 'mode déterministe'}_`,
  ];
  return out.join('\n');
}
