---
description: "Codebase intelligence — audit, santé, impact, rapports (menu si aucun argument)"
argument-hint: "[outil] [args] — ex: /codebase impact src/store.ts"
allowed-tools: mcp__dsh-codebase-chat
---

Tu es la commande `/codebase` du serveur MCP **dsh-codebase-chat** (outils `mcp__dsh-codebase-chat__codebase_*`).

Arguments : `$ARGUMENTS`

Règles :
- `$ARGUMENTS` vide → affiche le menu ci-dessous tel quel et demande lequel lancer. Ne rien exécuter.
- Premier mot = outil → appelle `mcp__dsh-codebase-chat__codebase_<outil>` avec le mapping ci-dessous. `projectPath` = répertoire courant sauf indication contraire.
- Outil inconnu → affiche le menu.

## Menu

| Commande | Effet |
|---|---|
| `/codebase deep_audit` | Audit déterministe complet — ~30 analyses, aucun LLM |
| `/codebase health` | Santé : cycles, dead code, duplication, complexité |
| `/codebase impact <fichier>` | Rayon d'impact — qui casse si le fichier change |
| `/codebase intelligence [focus]` | Audit pro : architecture, dette, opportunités |
| `/codebase report` | Rapport board : SWOT, scorecards, roadmap 90 j |
| `/codebase audit [focus]` | Non-conformités + dette technique, fixes concrets |
| `/codebase tasks` | TASKS.md priorisé avec sprints |
| `/codebase ceo` | Brief exécutif 1 page |
| `/codebase player` | Analyse UX / parcours utilisateur |
| `/codebase search <requête>` | Recherche fichiers / symboles |
| `/codebase explain <fichier\|question>` | Explique un fichier ou un symbole |
| `/codebase refactor <fichier> [objectif]` | Proposition de refactor |
| `/codebase chat <question>` | Q/R libre sur le code |
| `/codebase crea [focus]` | Idées créatives / marketing depuis le code |

## Mapping des arguments

- `impact <f>` → `{ file: "<f>" }`
- `search <q>` / `chat <q>` → `{ query: "<q>" }`
- `explain <x>` → `{ filePath: "<x>" }` si `<x>` ressemble à un chemin, sinon `{ query: "<x>" }`
- `refactor <f> <q>` → `{ filePath: "<f>", query: "<q>" }`
- `intelligence | report | audit | tasks | ceo | player | crea [focus]` → `{ focus: "<focus>" }`
- `health` / `deep_audit` → `{}`
- Options reconnues partout : `lang=en|fr`, `diff=<ref>`, `maxTokens=<n>`, `promptOnly=true|false`.
