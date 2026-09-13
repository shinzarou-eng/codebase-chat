# AGENTS.md — repères pour les agents

## Commandes
- Typecheck : `npx tsc --noEmit` · Build : `pnpm build` (tsup → `dist/`) · Tests : `npx vitest run`
- Audit déterministe : `node dist/cli.js --health --no-llm` ou `node dist/cli.js --prompt audit --no-llm` (pas de flag `--audit`)
- Dashboard : `node dist/cli.js --ui` · MCP : `node mcp/index.mjs`
- `--check` (fichiers modifiés vs `--diff <ref>`, verdict red/yellow/green vs `.codebase-chat/baseline.json` écrite par `--baseline`, `--strict` pour la CI) · `--doctor` (diagnostic d'installation)
- Gate du refactor report.ts : `git worktree add` un build pré-refactor, comparer les audits sur le MÊME arbre (`git diff --no-index` vide)
- Captures Playwright → `.playwright-mcp/` (ignoré par git), jamais à la racine

## Pièges connus
- `lib/index.js` (plugin DSH) n'est PAS généré par tsup : il s'édite à la main et se teste via `test/plugin.test.ts`.
- Dans le `<script>` de `src/dashboard.ts` (template literal), une regex `/[\\/]/` est servie comme `/[\/]/` — doubler les antislashs (`/[\\\\/]/`).
- Les scanners (`scanCode`, `codeShape`, exports) doivent ignorer le texte des strings/templates (`insideString`, `lineStartsInString`) : help CLI, HTML généré, fixtures de démo produisent des faux positifs.
- `scanCode` plafonne les échantillons par fichier : pour un compte réel, passer `opts.totals`.
- Le retriever ne remplit le budget avec des chunks non pertinents (`fallback`) que pour les requêtes génériques (audit/intelligence) — jamais pour `--search`.

## Conventions
- Commits : `<prefix>: <une phrase>` sans trailer ni co-auteur.
- Thème Fluent du dashboard/site et bannière brandée `docs/assets/social-preview.png` (générée depuis le SVG) à conserver.
