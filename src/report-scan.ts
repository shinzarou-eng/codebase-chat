// Deterministic smell & security scan — grep-grade evidence, no guessing.
// Every finding is a real file:line hit.
import { insideString, isSkippablePath, lineStartsInString } from './analysis.js';
import type { SmellScan } from './report-types.js';

export const SMELL_PATS: [string, RegExp][] = [
  // The (?:) no-ops keep this pattern table from matching its own source.
  ['todo', /\b(?:TOD(?:)O|FIXM(?:)E|HAC(?:)K|XX(?:)X|WI(?:)P)\b/],
  ['console', /\bconsole\.(log|warn|error|debug|info)\s*\(/],
  ['tsIgnore', /@ts-(ignore|expect-error|nocheck)\b/],
  ['any', /:\s*any\b/],
  ['emptyCatch', /catch\s*\([^)]*\)\s*\{\s*\}/],
  ['debugger', /\bdebugger\s*;/],
  ['syncIo', /\b(readFileSync|writeFileSync|appendFileSync|readdirSync|mkdirSync|execSync)\s*\(/],
];

export const SEC_PATS: [string, RegExp][] = [
  ['secret', /(?:api[_-]?key|secret|passwd|password|token|private[_-]?key)\s*[:=]\s*['"`][A-Za-z0-9_\/+\-.]{8,}['"`]/i],
  ['eval', /\beval\s*\(|new\s+Function\s*\(/],
  // Only shell-string execution is a risky sink — exec/execSync take a shell
  // string, and spawn*/execFile* with `shell: true` opt into a shell too.
  // spawn(cmd, args[]) and execFile are the safe array-arg APIs.
  ['exec', /(?<![.\w$])exec(?:Sync)?\s*\((?!\?)|shell\s*:\s*true/],
  ['innerHTML', /\.innerHTML\s*=/],
  ['unsafeRegex', /new\s+RegExp\s*\([^'"`]/],
];

export function scanCode(
  fileTexts: Map<string, string>, pats: [string, RegExp][], perFileCap = 3,
  opts: { skipComments?: boolean; skipCommentsExcept?: ReadonlySet<string>; skipStrings?: boolean; totals?: Record<string, number> } = {},
): SmellScan {
  const out: SmellScan = {};
  for (const [file, text] of fileTexts) {
    if (isSkippablePath(file)) continue; // tests legitimately console/TODO
    // CLI entry points and helper scripts print to stdout on purpose, and sync
    // IO is fine there too — console.*/readFileSync are their interface.
    const isCli = /^#!/m.test(text) || /\bprocess\.argv\b/.test(text) || /(^|\/)scripts?\//.test(file);
    const lines = text.split('\n');
    const startsInStr = opts.skipStrings ? lineStartsInString(text) : [];
    for (const [key, re] of pats) {
      if (isCli && (key === 'console' || key === 'syncIo')) continue;
      let found = 0;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const isComment = /^\/\//.test(line) || /^\* /.test(line) || /^\/\*/.test(line);
        // Comments mentioning `shell: true` or `eval(` are not sinks.
        if (opts.skipComments && isComment) continue;
        // Smell rules live in code — a comment saying "use: any" is not an
        // `any` type. Only comment-based patterns (todo, tsIgnore) match there.
        if (isComment && opts.skipCommentsExcept && !opts.skipCommentsExcept.has(key)) continue;
        // Smell patterns inside string literals are prompt text / fixtures —
        // but security patterns keep strings (secrets and generated code
        // like `out.innerHTML = ...` in a template live inside them).
        const m = re.exec(lines[i]);
        if (!m) continue;
        if (opts.skipStrings && (startsInStr[i] || insideString(lines[i], m.index))) continue;
        if (opts.totals) opts.totals[key] = (opts.totals[key] ?? 0) + 1;
        if (found >= perFileCap) continue;
        (out[key] ??= []).push({ file, line: i + 1, sample: line.slice(0, 90) });
        found++;
      }
    }
  }
  return out;
}

export function countHits(scan: SmellScan): number {
  return Object.values(scan).reduce((s, f) => s + f.length, 0);
}
