// Real "power" session: builds a temp git repo from demo-project/, plants a
// PR (circular dep + unused export + hardcoded key), then runs the REAL CLI:
// git status → --diff HEAD --health → --diff HEAD --ask → --watch.
// Prints a transcript ($ cmd + real output) for scripts/render_demo.py.
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'dist', 'cli.js');
const SRC = join(ROOT, 'demo-project');

const dir = join(mkdtempSync(join(tmpdir(), 'codebase-power-')), 'demo-petstore');
mkdirSync(dir, { recursive: true });
const DISPLAY = '~/demo-petstore';
const cache = mkdtempSync(join(tmpdir(), 'codebase-power-cache-'));
const env = { ...process.env, CODEBASE_CACHE_DIR: cache, DEEPSEEK_API_KEY: '', OPENAI_API_KEY: '' };

const out = (s) => console.log(s);
const show = (s) => s.split(dir).join(DISPLAY).split(ROOT).join('~/codebase-chat');
const git = (a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const cli = (args) => {
  const r = spawnSync('node', [CLI, ...args], { cwd: dir, env, encoding: 'utf8' });
  return (r.stdout + (r.stderr || '')).trimEnd();
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const PAYMENTS = `import { verifyToken } from "./auth.js";

// FIXME: move to env — leaked in commit
const STRIPE_KEY = "sk_live_" + "EXAMPLE0NLYDEM0";

export function charge(token: string, amount: number) {
  console.log("charging", amount);
  if (!verifyToken(token)) throw new Error("unauthorized");
  return { id: "ch_" + amount, amount };
}

// TODO: implement refunds
export function refund() {
  return null;
}
`;

async function main() {
  cpSync(SRC, dir, { recursive: true });
  git(['init', '-q']);
  git(['-c', 'user.email=demo@demo.dev', '-c', 'user.name=demo', 'add', '-A']);
  git(['-c', 'user.email=demo@demo.dev', '-c', 'user.name=demo', 'commit', '-qm', 'feat: petstore api']);

  // --- plant the PR: auth ↔ payments cycle, dead export, hardcoded key ---
  writeFileSync(join(dir, 'src', 'payments.ts'), PAYMENTS);
  appendFileSync(join(dir, 'src', 'auth.ts'), '\nimport { charge } from "./payments.js";\nexport const __charge = charge;\n');

  out('$ git status --short');
  out(show(git(['status', '--short']).trimEnd()));
  await wait(150);

  out('$ npx codebase-chat --diff HEAD --health --lang en');
  const health = cli(['--diff', 'HEAD', '--health', '--lang', 'en']);
  out(show(health));
  await wait(150);

  out('$ npx codebase-chat --diff HEAD --ask "review this change" --lang en');
  const ask = cli(['--diff', 'HEAD', '--ask', 'review this change', '--lang', 'en']);
  const askLines = ask.split('\n');
  out(show(askLines.slice(0, 14).join('\n')));
  if (askLines.length > 14) out(`  … ${askLines.length - 14} more lines of cited context`);
  await wait(150);

  // --- watch: real spawn, real file touch, real incremental rebuild ---
  out('$ npx codebase-chat --watch --lang en');
  const watcher = spawn('node', [CLI, '--watch', '--lang', 'en'], { cwd: dir, env });
  let wbuf = '';
  let sawRefresh = false;
  const refresh = new Promise((res) => {
    watcher.stdout.on('data', (d) => {
      wbuf += d;
      if (/index refreshed/i.test(wbuf)) { sawRefresh = true; res(); }
    });
  });
  // wait for the watcher to be ready, then touch a file for real
  await new Promise((res) => {
    const t = setInterval(() => { if (/watch|watching|hot/i.test(wbuf)) { clearInterval(t); res(); } }, 100);
    setTimeout(res, 20000); // cold index can take a few seconds
  });
  appendFileSync(join(dir, 'src', 'payments.ts'), '\n// touched by watch demo\n');
  await Promise.race([refresh, wait(20000)]);
  out(show(wbuf.trimEnd()));
  watcher.kill();
  await new Promise((res) => { watcher.once('exit', res); setTimeout(res, 5000); });
  out('^C');
  if (!sawRefresh) out('(watcher exited before refresh — see above)');

  for (let i = 0; i < 5; i++) {
    try {
      rmSync(join(dir, '..'), { recursive: true, force: true });
      rmSync(cache, { recursive: true, force: true });
      break;
    } catch { await wait(500); }
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
