// Auto-fix - mechanical repairs for the rules where the correct change is
// unambiguous. Every fix re-checks: the finding disappears from --check, which
// is the proof the repair worked. Nothing here rewrites logic.
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AuditFinding } from './report-types.js';

export interface Fix {
  /** The finding this repairs. */
  finding: AuditFinding;
  /** Human-readable summary of what will change. */
  description: string;
  /** Returns true when the file actually changed (false = nothing to repair). */
  apply(abs: string): Promise<boolean>;
}

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Mechanical fixes for the findings we can repair without judgment. */
export function planFixes(findings: AuditFinding[], lang: 'fr' | 'en' = 'fr'): Fix[] {
  const en = lang === 'en';
  const fixes: Fix[] = [];

  for (const f of findings) {
    // env-undoc:VAR → document it in .env.example
    let m = f.id.match(/^env-undoc:(.+)$/);
    if (m) {
      const v = m[1];
      fixes.push({
        finding: f,
        description: en ? `Append \`${v}=\` to .env.example` : `Ajouter \`${v}=\` dans .env.example`,
        apply: async (abs) => {
          const p = join(abs, '.env.example');
          const cur = existsSync(p) ? await readFile(p, 'utf8') : '';
          if (new RegExp(`^${escRe(v)}=`, 'm').test(cur)) return false;
          await writeFile(p, cur + (cur && !cur.endsWith('\n') ? '\n' : '') + `${v}=\n`, 'utf8');
          return true;
        },
      });
      continue;
    }

    // dead-dep:name → drop it from package.json deps/devDeps
    m = f.id.match(/^dead-dep:(.+)$/);
    if (m) {
      const dep = m[1];
      fixes.push({
        finding: f,
        description: en ? `Remove \`${dep}\` from package.json` : `Retirer \`${dep}\` de package.json`,
        apply: async (abs) => {
          const p = join(abs, 'package.json');
          const pkg = JSON.parse(await readFile(p, 'utf8'));
          let changed = false;
          for (const k of ['dependencies', 'devDependencies', 'peerDependencies'])
            if (pkg[k] && dep in pkg[k]) { delete pkg[k][dep]; changed = true; }
          if (changed) await writeFile(p, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
          return changed;
        },
      });
      continue;
    }

    // unused-export:file:name → delete single-line decls, else drop `export`
    m = f.id.match(/^unused-export:(.+):([^:]+)$/);
    if (m && f.file) {
      const [, , name] = m;
      const file = f.file;
      fixes.push({
        finding: f,
        description: en ? `Remove unused export \`${name}\` in \`${file}\`` : `Retirer l'export inutilisé \`${name}\` dans \`${file}\``,
        apply: async (abs) => {
          const p = join(abs, file);
          const lines = (await readFile(p, 'utf8')).split('\n');
          const decl = new RegExp(`^\\s*export\\s+(?:declare\\s+)?(?:async\\s+)?(?:const|let|var|function|class|interface|type|enum)\\s+${escRe(name)}\\b`);
          // Fixes apply sequentially - earlier deletions shift later lines, so
          // pick the declaration closest to the recorded line, not the exact one.
          const hits = lines.map((l, j) => decl.test(l) ? j : -1).filter(j => j >= 0);
          if (!hits.length) return false;
          const i = f.line ? hits.reduce((a, b) => Math.abs(b + 1 - f.line!) < Math.abs(a + 1 - f.line!) ? b : a) : hits[0];
          if (/;\s*$/.test(lines[i])) {
            lines.splice(i, 1);
          } else {
            // Multi-line declaration: brace blocks delete until the braces
            // balance out; braceless statements (export const x =\n  a +\n  b;)
            // delete until the terminating `;`.
            let depth = 0, end = -1;
            const braced = lines[i].includes('{');
            for (let j = i; j < lines.length; j++) {
              depth += (lines[j].match(/\{/g) ?? []).length - (lines[j].match(/\}/g) ?? []).length;
              if (braced ? (j > i && depth <= 0) : /;\s*$/.test(lines[j])) { end = j; break; }
            }
            if (end < 0) return false;
            lines.splice(i, end - i + 1);
          }
          await writeFile(p, lines.join('\n'), 'utf8');
          return true;
        },
      });
      continue;
    }

    // smell:debugger / smell:console on a standalone line → delete the line
    m = f.id.match(/^smell:(debugger|console):/);
    if (m && f.file && f.line) {
      const kind = m[1];
      const file = f.file, line = f.line;
      // The finding message is `sample` - the exact flagged line. Only a
      // standalone line whose text equals the sample may be deleted: never a
      // lookalike that happened to be nearby (scanCode caps samples, so
      // unflagged console lines exist).
      const sample = (f.message ?? '').replace(/^`|`$/g, '');
      fixes.push({
        finding: f,
        description: en ? `Delete the ${kind === 'console' ? 'console.*' : 'debugger'} line in \`${file}:${line}\`` : `Supprimer la ligne ${kind === 'console' ? 'console.*' : 'debugger'} dans \`${file}:${line}\``,
        apply: async (abs) => {
          const p = join(abs, file);
          const lines = (await readFile(p, 'utf8')).split('\n');
          const standalone = kind === 'debugger' ? /^\s*debugger\s*;?\s*$/ : /^\s*console\.(log|warn|error|debug|info)\s*\(.*;?\s*$/;
          const hits = lines.map((l, j) => (standalone.test(l) && l.trim() === sample) ? j : -1).filter(j => j >= 0);
          if (!hits.length) return false;
          const i = hits.reduce((a, b) => Math.abs(b + 1 - line) < Math.abs(a + 1 - line) ? b : a);
          lines.splice(i, 1);
          await writeFile(p, lines.join('\n'), 'utf8');
          return true;
        },
      });
    }
  }
  return fixes;
}

export async function applyFixes(abs: string, fixes: Fix[]): Promise<{ applied: Fix[]; skipped: Fix[]; failed: { fix: Fix; error: string }[] }> {
  const applied: Fix[] = [];
  const skipped: Fix[] = [];
  const failed: { fix: Fix; error: string }[] = [];
  for (const fix of fixes) {
    try {
      if (await fix.apply(abs)) applied.push(fix);
      else skipped.push(fix);
    } catch (e) {
      failed.push({ fix, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { applied, skipped, failed };
}
