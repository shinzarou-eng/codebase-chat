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
- Détection des fichiers test : `isTestPath` / `isSkippablePath` (analysis.ts) — jamais un regex substring (`src/latest.ts` n'est PAS un test).
- Le retriever ne remplit le budget avec des chunks non pertinents (`fallback`) que pour les requêtes génériques (audit/intelligence) — jamais pour `--search`.

## Conventions
- Commits : `<prefix>: <une phrase>` sans trailer ni co-auteur.
- Thème du dashboard : **dense type IDE (VS Code)** — validé par l'utilisateur. Palette `#1e1e1e/#252526/#3c3c3c`, accent `#007fd4`, base 13px, radius 4px, status bar en bas. JAMAIS de dégradés criards, glow, ombres portées ou palette violette — rejetés comme "amateur". Bannière `docs/assets/social-preview.png` (générée depuis le SVG) à conserver.
