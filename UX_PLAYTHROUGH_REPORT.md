# UX Playthrough Report — dsh-codebase-chat

_Rapport généré via `codebase_player` (MCP) + analyse manuelle des points de contact. Le "user journey" d'un outil développeur = découverte → installation → premier appel → lecture des résultats._

---

## 1. User Journey pas à pas

### Étape 0 — Découverte (README / site)
Le point d'entrée est le README avec une commande unique en première position `[source: README.md:28]` :

```
npx dsh-codebase-chat-mcp setup
```

La promesse est claire dès le haut de page, et le transcript terminal réel montre le résultat avant même l'installation `[source: README.md:47-82]`. Le site `docs/index.html` présente les 13 outils en table + onglets démo `[source: docs/index.html:782-786]`.

### Étape 1 — Détection des clients (setup wizard)
Le wizard scanne 11 clients MCP par présence de dossiers `[source: mcp/setup.mjs:121-123]` et les liste numérotés `[source: mcp/setup.mjs:201-203]` :

```
Clients detectes :
  1. Claude Desktop
  2. Cursor
  3. Windsurf
  a. Tous
```

Si aucun client n'est détecté, l'utilisateur n'est pas abandonné : le JSON à copier manuellement s'affiche directement `[source: mcp/setup.mjs:194-198]` — bon empty state.

### Étape 2 — Choix du périmètre
Sélection par numéros ou `a` pour tous `[source: mcp/setup.mjs:205-208]`. La config est **fusionnée** sans écraser les serveurs existants `[source: mcp/setup.mjs:140-158]` et un backup `.bak` est créé avant chaque écriture `[source: mcp/setup.mjs:169-172]` — réversible, rassurant.

### Étape 3 — Mode de réponse
Trois options présentées avec recommandation explicite `[source: mcp/setup.mjs:216-219]` :

```
1. prompt-only — le modele hote repond (recommande, meilleure qualite)
2. cle API — le serveur appelle DeepSeek/OpenAI directement
3. local — modele embarque, 100 % hors-ligne (~1 Go au 1er lancement)
```

Le mode local affiche un avertissement de qualité honnête `[source: mcp/setup.mjs:228-229]` — bonne gestion des attentes.

### Étape 4 — Confirmation
Chaque client configuré affiche `[ok] nom → chemin` `[source: mcp/setup.mjs:237]`, puis le rappel de redémarrage + le mode actif `[source: mcp/setup.mjs:240-242]` + le snippet manuel pour les clients non détectés `[source: mcp/setup.mjs:243-244]`.

### Étape 5 — Premier appel (dans l'IDE)
L'utilisateur demande en langage naturel ("scanne ce repo"). Les tools déterministes (`codebase_health`, `codebase_impact`) répondent sans LLM `[source: mcp/index.mjs:206-227]`. En mode prompt-only, un header indique explicitement que le contexte est destiné au modèle hôte `[source: mcp/index.mjs:258-261]` — l'utilisateur comprend pourquoi il voit un pavé de contexte.

### Étape 6 — CLI direct (parcours alternatif)
`--help` liste tous les flags avec exemples concrets `[source: src/cli.ts:28-79]`. `--health` produit un rapport déterministe immédiat `[source: src/cli.ts:166-184]`, `--impact` gère les cibles ambiguës en listant des candidats `[source: src/cli.ts:186-200]`.

---

## 2. Points de friction UX

| # | Friction | Gravité | Source |
|---|---|---|---|
| F1 | **Wizard en français uniquement** — tout l'outil est bilingue (`--lang`), mais le setup affiche "Clients detectes", "Mode de reponse", "Clef API" sans option EN. Un utilisateur anglophone installe un produit bilingue via un wizard franco-only. | Haute | `mcp/setup.mjs:192-244` |
| F2 | **Choix invalide silencieux** — si l'utilisateur tape `9` ou `x` à la sélection des clients, `chosen` filtre tout et le wizard affiche juste "Rien a faire." sans re-prompt ni message d'erreur. | Moyenne | `mcp/setup.mjs:206-214` |
| F3 | **Idem pour le mode de réponse** — `mode === "2"` et `mode === "3"` sont testés, toute autre valeur (`"99"`, `"abc"`) tombe silencieusement en prompt-only. Pas de validation ni de re-prompt. | Moyenne | `mcp/setup.mjs:220-230` |
| F4 | **Clé API saisie en clair** — `ask("  Clef API DeepSeek/OpenAI : ")` affiche la clé tapée en clair dans le terminal. Pas de masquage, pas de validation de format (`sk-…`), pas de rappel qu'elle sera stockée en clair dans le JSON du client. | Moyenne | `mcp/setup.mjs:225` |
| F5 | **Pas de vérification post-install** — après "[ok]", le seul feedback est "Redemarre le client". Si le serveur ne démarre pas (node absent, npx introuvable), l'utilisateur le découvre dans l'IDE sans diagnostic. Aucun `--check`/`doctor` ne valide l'installation. | Haute | `mcp/setup.mjs:233-244` |
| F6 | **Aide en exit code 1** — `npx dsh-codebase-chat` sans arguments imprime l'aide mais sort avec `exit(1)`. Scripts/CI lisant `$?` voient un échec pour un usage normal. | Basse | `src/cli.ts:326-327` |
| F7 | **Latence de sortie perceptible** — `exit()` repose sur un timer unref'd de 2 s ; sur certaines configurations le process peut paraître "pendre" avant de se fermer. | Basse | `src/cli.ts:20-26` |

---

## 3. Angles morts & empty states

| # | État manquant | Source |
|---|---|---|
| B1 | **Aucun empty state "projet vide"** — `analyzeImpact` sur un projet sans fichier de code retourne "candidats : []" puis "No code file matches" — correct. Mais `codebase_health` sur un dossier vide produit un rapport 0/100 trompeur plutôt qu'un message "aucun fichier de code détecté". | `src/analysis.ts` (rapport sans garde `codeFiles.length === 0`) |
| B2 | **Pas d'état de chargement en MCP** — les appels `tools/call` bloquent sans progress. Sur un gros repo non indexé, le premier `codebase_chat` peut prendre des dizaines de secondes sans feedback visible dans l'IDE (le progress existe en CLI via `Reading …` mais pas en MCP). | `mcp/index.mjs` (pas de `notifications/progress`) |
| B3 | **Erreur réseau partielle** — `--call` gère le non-2xx `[source: src/cli.ts:294-298]` et le timeout 120 s `[source: src/cli.ts:282]`, mais une coupure réseau (`fetch` throw) remonte l'erreur brute sans suggestion ("vérifiez DEEPSEEK_BASE_URL / votre connexion"). | `src/cli.ts:280-301` |
| B4 | **`--diff` sur repo sans git** — le fallback existe et affiche un warning `[source: src/cli.ts:175-179]` — bien. Mais en MCP la note est discrète (`_diff … indisponible_` en italique), facile à rater. | `mcp/index.mjs:219-222` |
| B5 | **Premier usage local sans préparation** — `--local` prévient du téléchargement 1 Go `[source: src/cli.ts:263-265]`, mais si le download échoue à mi-chemin, pas de reprise ni de message de recovery. | `src/local-llm.ts` |

---

## 4. Score de fluidité & recommandations

**Score global : 7.5 / 10**

- Découverte → install : **9/10** — une commande, détection auto, backup `.bak`, sortie manuelle de secours.
- Premier résultat : **8/10** — `codebase_health` instantané sans clé = "time to value" excellent.
- Récupération d'erreur : **5/10** — choix invalides silencieux, pas de doctor, clé API en clair.
- Internationalisation : **5/10** — produit bilingue, wizard monolingue.

### Actions prioritaires

**P0 — rentabilité immédiate**
1. **Wizard bilingue** : lire `--lang`/`CODEBASE_LANG`/locale OS, dupliquer les ~15 strings de `setup.mjs` en EN/FR.
2. **Re-prompt sur saisie invalide** : boucler tant que `chosen.length === 0` et `mode ∉ {1,2,3}`, avec message d'erreur explicite.

**P1 — confiance**
3. **`setup --check` / `doctor`** : après écriture, spawn le serveur, faire un `initialize` + `tools/list`, afficher "✓ 13 tools OK" ou le diagnostic. Supprime le doute "est-ce que ça a marché ?".
4. **Masquer la clé API** : echo off pendant la saisie (ou accepter `--api-key` en flag + variable d'env), et avertir qu'elle est stockée en clair.
5. **`codebase_health` sur projet vide** : garde `codeFiles.length === 0` → message "aucun fichier de code" au lieu d'un score 0/100 alarmiste.

**P2 — polish**
6. **Progress MCP** : émettre `notifications/progress` pendant l'indexation initiale pour que l'IDE affiche un spinner.
7. **Exit 0 sur `--help` et usage nu**, réserver exit 1 aux vraies erreurs.
8. **Messages d'erreur actionnables** : chaque `Error:` réseau/API devrait suggérer la variable d'env ou le fix correspondant.

---

_Chacune des constats ci-dessus est rattaché à son fichier source. Les frictions F1–F5 sont vérifiables en relançant `node mcp/setup.mjs` et en saisissant des valeurs invalides._
