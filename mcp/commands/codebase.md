---
description: "Codebase intelligence — audit, santé, impact, rapports (menu si aucun argument)"
argument-hint: "[outil] [args] — ex: /codebase check HEAD~1"
allowed-tools: mcp__dsh-codebase-chat
---

Tu es la commande `/codebase` du serveur MCP **dsh-codebase-chat** (outils `mcp__dsh-codebase-chat__codebase_*`).

Arguments : `$ARGUMENTS`

Règles :
- `$ARGUMENTS` vide → affiche le menu ci-dessous tel quel et demande lequel lancer. Ne rien exécuter.
- Premier mot = `help` | `aide` | `?` | `--help` → affiche l'aide complète en fin de fichier, telle quelle. Ne rien exécuter.
- Premier mot = outil ou alias → appelle `mcp__dsh-codebase-chat__codebase_<outil>` avec le mapping ci-dessous. `projectPath` = répertoire courant sauf indication contraire.
- Outil inconnu → affiche le menu.

Robustesse :
- Tool MCP absent ou serveur non connecté → bascule sur le CLI équivalent : `npx dsh-codebase-chat --check` | `--health` | `--impact <f>` | `--search <q>` | `--doctor`. Si rien n'est installé → propose `npx dsh-codebase-chat-mcp-setup`.
- Tool demandé inconnu du serveur (ex. `codebase_check`) → version trop vieille : le dire et suggérer de mettre à jour / recharger.
- Verdict `check` rouge → enchaîne proactivement : `impact` sur le fichier le plus risqué + `explain` sur le finding bloquant.
- Résultat déterministe → présente le verdict et les raisons tels quels, sans les réécrire.

## Que veux-tu faire ?

| Intention | Commande |
|---|---|
| 1. Vérifier mes changements | `/codebase check [ref]` *(déterministe)* |
| 2. Comprendre ce projet | `/codebase deep_audit` *(déterministe)* · `/codebase intelligence [focus]` *(LLM)* |
| 3. Voir mes priorités | `/codebase health` *(déterministe)* · `/codebase tasks` *(LLM)* |
| 4. Chercher / expliquer | `/codebase search <q>` · `explain <fichier\|symbole>` · `chat <question>` |
| 5. Rapports avancés | `report` · `ceo` · `player` · `crea` · `refactor <fichier> [objectif]` *(LLM)* |
| 6. Diagnostic de l'installation | `/codebase doctor` *(déterministe)* |

## Tous les outils

| Commande | Effet |
|---|---|
| `/codebase check [ref]` | Changements vs ref : impact, findings, delta vs baseline — déterministe |
| `/codebase doctor` | Diagnostic : node, index, clés, tree-sitter, baseline, intégrations — déterministe |
| `/codebase deep_audit` | Audit déterministe complet — ~30 analyses, aucun LLM |
| `/codebase health` | Santé : cycles, dead code, duplication, complexité — déterministe |
| `/codebase impact <fichier>` | Rayon d'impact — qui casse si le fichier change — déterministe |
| `/codebase intelligence [focus]` | Audit pro : architecture, dette, opportunités — LLM |
| `/codebase report` | Rapport board : SWOT, scorecards, roadmap 90 j — LLM |
| `/codebase audit [focus]` | Non-conformités + dette technique, fixes concrets — LLM |
| `/codebase tasks` | TASKS.md priorisé avec sprints — LLM |
| `/codebase ceo` | Brief exécutif 1 page — LLM |
| `/codebase player` | Analyse UX / parcours utilisateur — LLM |
| `/codebase search <requête>` | Recherche fichiers / symboles |
| `/codebase explain <fichier\|question>` | Explique un fichier ou un symbole |
| `/codebase refactor <fichier> [objectif]` | Proposition de refactor — LLM |
| `/codebase chat <question>` | Q/R libre sur le code — LLM |
| `/codebase crea [focus]` | Idées créatives / marketing depuis le code — LLM |

## Alias du premier mot

- `check` | `verifier` | `vérifier` | `changes` | `changements` → `codebase_check` (2e mot = `base`, défaut `HEAD`)
- `doctor` | `diag` | `diagnostic` → `codebase_doctor`
- `comprendre` | `understand` → `codebase_deep_audit`
- `priorites` | `priorités` → `codebase_health`

## Mapping des arguments

- `check <ref>` → `{ base: "<ref>" }`
- `impact <f>` → `{ file: "<f>" }`
- `search <q>` / `chat <q>` → `{ query: "<q>" }`
- `explain <x>` → `{ filePath: "<x>" }` si `<x>` ressemble à un chemin, sinon `{ query: "<x>" }`
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
| `/codebase deep_audit` | Audit complet ~30 analyses (structure, sécurité, dette, duplication, git…) — 100 % local. |
| `/codebase health` | Santé : cycles, dead code, duplication, hotspots, priorités triées par sévérité. |
| `/codebase impact <fichier>` | Rayon d'impact : qui importe le fichier, qui casse s'il change. |

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
