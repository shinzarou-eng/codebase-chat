---
name: codebase
description: Codebase intelligence via the dsh-codebase-chat MCP server — check your changes, deep audit, health, impact, search, explain, doctor. Use when the user types /codebase or asks to verify changes, audit the codebase, see the blast radius of a file, search or explain code, or diagnose the install.
---

# /codebase — codebase intelligence

Les outils sont les tools MCP du serveur `dsh-codebase-chat` (`codebase_*`). Appelle-les via `mcp_call_tool` avec `server_name: "dsh-codebase-chat"`. `projectPath` = répertoire courant sauf indication contraire.

Règles :
- `/codebase` sans argument → affiche le menu ci-dessous tel quel et demande lequel lancer. Ne rien exécuter.
- Premier mot = `help` | `aide` | `?` | `--help` → affiche l'aide complète en fin de fichier, telle quelle. Ne rien exécuter.
- Premier mot = outil ou alias → appelle le tool correspondant avec le mapping.
- Outil inconnu → affiche le menu.

Robustesse :
- Serveur `dsh-codebase-chat` absent de la session → bascule sur le CLI équivalent via exec : `node <repo>/dist/cli.js --check` | `--health` | `--impact <f>` | `--search <q>` | `--doctor` (build : `pnpm build`). Si aucun repo local → dis-le et propose `npx dsh-codebase-chat-mcp-setup`.
- Tool demandé absent de la liste (ex. `codebase_check` inconnu) → le serveur est une vieille version : dis-le, propose de recharger la session MCP ou de mettre à jour le package, puis `codebase_doctor`.
- Verdict `check` rouge → enchaîne proactivement : `codebase_impact` sur le fichier le plus risqué + `codebase_explain` sur le finding bloquant, pour aider à corriger.
- Résultat d'un tool déterministe → présente le verdict et les raisons tels quels, sans les réécrire ni les édulcorer.

## Que veux-tu faire ?

| Intention | Commande |
|---|---|
| 1. Vérifier mes changements | `/codebase check [ref]` *(déterministe)* |
| 2. Comprendre ce projet | `/codebase deep_audit` *(déterministe)* · `/codebase intelligence [focus]` *(LLM)* |
| 3. Voir mes priorités | `/codebase health` *(déterministe)* · `/codebase tasks` *(LLM)* |
| 4. Chercher / expliquer | `/codebase search <q>` · `explain <fichier\|symbole>` · `chat <question>` |
| 5. Rapports avancés | `report` · `ceo` · `player` · `crea` · `refactor <fichier> [objectif]` *(LLM)* |
| 6. Diagnostic de l'installation | `/codebase doctor` *(déterministe)* |

## Alias du premier mot

- `check` | `verifier` | `vérifier` | `changes` | `changements` → `codebase_check` (2e mot = `base`, défaut `HEAD`)
- `doctor` | `diag` | `diagnostic` → `codebase_doctor`
- `comprendre` | `understand` → `codebase_deep_audit`
- `priorites` | `priorités` → `codebase_health`

## Mapping des arguments

- `check <ref>` → `codebase_check` `{ base: "<ref>" }`
- `ignore <id> [raison]` → `codebase_ignore` `{ id: "<id>", reason: "<raison>" }` · `ignores` → `{ id: "", action: "list" }` · `unignore <id>` → `{ id: "<id>", action: "remove" }`
- `impact <f>` → `codebase_impact` `{ file: "<f>" }` (`<f>` = fichier, `fichier#symbole` ou symbole)
- `search <q>` / `chat <q>` → `{ query: "<q>" }`
- `explain <x>` → `codebase_explain` `{ filePath: "<x>" }` si `<x>` ressemble à un chemin, sinon `{ query: "<x>" }`
- `refactor <f> <q>` → `{ filePath: "<f>", query: "<q>" }`
- `intelligence | report | audit | tasks | ceo | player | crea [focus]` → `{ focus: "<focus>" }`
- `health` / `deep_audit` / `doctor` → `{}`
- Options reconnues partout : `lang=en|fr`, `diff=<ref>`, `maxTokens=<n>`, `promptOnly=true|false`.

## /codebase help — aide complète

`/codebase` est le point d'entrée des 16 outils du serveur MCP **dsh-codebase-chat** : analyse statique locale, indexation et rapports. Deux familles :

- **Déterministe** — analyse du code réel, aucune clé API, résultats reproductibles et audités.
- **LLM** — construit un prompt contextualisé sur ton projet (mode `promptOnly`) ou appelle un modèle si une clé est configurée.

### Vérifier & diagnostiquer (déterministe)

| Commande | Explication |
|---|---|
| `/codebase check [ref]` | Fichiers modifiés vs `ref` (défaut `HEAD`) : risque d'impact, complexité, test dédié, findings par fichier, **delta vs baseline** (nouveaux/résolus/inchangés). Verdict 🟢/🟡/🔴. |
| `/codebase doctor` | Diagnostic d'installation : version Node, état de l'index, clés LLM (jamais affichées), tree-sitter, baseline, intégrations détectées. À lancer en premier en cas de doute. |
| `/codebase deep_audit` | Audit complet — 9 sections, ~30 métriques (structure, sécurité, dette, duplication, git…) — 100 % local. |
| `/codebase health` | Santé : cycles, dead code, duplication, hotspots, priorités triées par sévérité. |
| `/codebase impact <fichier>` | Rayon d'impact : qui importe le fichier, qui casse s'il change. `fichier#symbole` ou un nom de symbole seul → limité aux fichiers qui utilisent vraiment ce symbole. |
| `/codebase ignore <id> [raison]` | Silence un finding avec justification (`.codebase-chat/ignores.json`, à commiter). `id` peut être un préfixe : `sec:innerHTML:src/x.ts` couvre tous les innerHTML du fichier. |

### Comprendre & décider (LLM)

| Commande | Explication |
|---|---|
| `intelligence [focus]` | Audit pro : architecture, dette, opportunités. `focus` ex. `securite`, `perf`. |
| `report` | Rapport board : SWOT, scorecards, roadmap 90 jours. |
| `audit [focus]` | Non-conformités + dette, avec fixes concrets. |
| `tasks` | TASKS.md priorisé, organisé en sprints. |
| `ceo` | Brief exécutif 1 page (non-technique). |
| `player` | Analyse UX / parcours utilisateur. |
| `crea [focus]` | Idées créatives / marketing dérivées du code. |
| `refactor <fichier> [objectif]` | Proposition de refactor contextualisée. |
| `chat <question>` | Q/R libre sur le code. |

### Chercher

| Commande | Explication |
|---|---|
| `search <requête>` | Recherche fichiers/symboles pertinents. Aucun résultat → message explicite, pas de contexte de remplissage. |
| `explain <fichier\|symbole>` | Explique un fichier (chemin) ou un symbole/concept (texte libre). |

### Workflow quotidien

```
node dist/cli.js --baseline        # une fois : fige la référence (à commiter)
/codebase check                    # après chaque modification
node dist/cli.js --check --strict  # en CI : exit 1 si verdict rouge
```

### Options (ajoutables à toute commande)

- `lang=en|fr` — langue de sortie
- `diff=<ref>` — analyse limitée à un diff git
- `maxTokens=<n>` — budget de contexte
- `promptOnly=true|false` — génère le prompt sans appeler d'API

### Alias du premier mot

`check` = `verifier` `vérifier` `changes` `changements` · `doctor` = `diag` `diagnostic` · `deep_audit` = `comprendre` `understand` · `health` = `priorites` `priorités` · `help` = `aide` `?`

### Exemples

```
/codebase check HEAD~3
/codebase impact src/report.ts
/codebase explain src/indexer.ts
/codebase search buildIndex
/codebase intelligence securite lang=fr
```
