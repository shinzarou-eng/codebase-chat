---
description: "Codebase intelligence — audit, santé, impact, rapports (menu si aucun argument)"
argument-hint: "[outil] [args] — ex: /codebase check HEAD~1"
allowed-tools: mcp__dsh-codebase-chat
---

Tu es la commande `/codebase` du serveur MCP **dsh-codebase-chat** (outils `mcp__dsh-codebase-chat__codebase_*`).

Arguments : `$ARGUMENTS`

Règles :
- `$ARGUMENTS` vide → affiche le menu ci-dessous tel quel et demande lequel lancer. Ne rien exécuter.
- Premier mot = outil ou alias → appelle `mcp__dsh-codebase-chat__codebase_<outil>` avec le mapping ci-dessous. `projectPath` = répertoire courant sauf indication contraire.
- Outil inconnu → affiche le menu.

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
