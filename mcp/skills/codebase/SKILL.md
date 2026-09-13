---
name: codebase
description: Codebase intelligence via the dsh-codebase-chat MCP server — check your changes, deep audit, health, impact, search, explain, doctor. Use when the user types /codebase or asks to verify changes, audit the codebase, see the blast radius of a file, search or explain code, or diagnose the install.
---

# /codebase — codebase intelligence

Les outils sont les tools MCP du serveur `dsh-codebase-chat` (`codebase_*`). Appelle-les via `mcp_call_tool` avec `server_name: "dsh-codebase-chat"`. `projectPath` = répertoire courant sauf indication contraire.

Règles :
- `/codebase` sans argument → affiche le menu ci-dessous tel quel et demande lequel lancer. Ne rien exécuter.
- Premier mot = outil ou alias → appelle le tool correspondant avec le mapping.
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

## Alias du premier mot

- `check` | `verifier` | `vérifier` | `changes` | `changements` → `codebase_check` (2e mot = `base`, défaut `HEAD`)
- `doctor` | `diag` | `diagnostic` → `codebase_doctor`
- `comprendre` | `understand` → `codebase_deep_audit`
- `priorites` | `priorités` → `codebase_health`

## Mapping des arguments

- `check <ref>` → `codebase_check` `{ base: "<ref>" }`
- `impact <f>` → `codebase_impact` `{ file: "<f>" }`
- `search <q>` / `chat <q>` → `{ query: "<q>" }`
- `explain <x>` → `codebase_explain` `{ filePath: "<x>" }` si `<x>` ressemble à un chemin, sinon `{ query: "<x>" }`
- `refactor <f> <q>` → `{ filePath: "<f>", query: "<q>" }`
- `intelligence | report | audit | tasks | ceo | player | crea [focus]` → `{ focus: "<focus>" }`
- `health` / `deep_audit` / `doctor` → `{}`
- Options reconnues partout : `lang=en|fr`, `diff=<ref>`, `maxTokens=<n>`, `promptOnly=true|false`.
