import { readFileSync } from 'node:fs';
import figlet from 'figlet';

let cachedVersion: string | undefined;
function promptVersion(): string {
  if (!cachedVersion) {
    try {
      const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: string };
      cachedVersion = pkg.version ?? '0.0.0';
    } catch {
      cachedVersion = '0.0.0';
    }
  }
  return cachedVersion;
}

export interface ToolPromptOptions {
  context: string;
  projectName: string;
  lang?: string;
  style?: string;
  query?: string;
  focus?: string;
  filePath?: string;
  description?: string;
  crea?: boolean;
  creaTheme?: string;
}

export function citationInstruction(lang = "fr"): string {
  const isEn = lang === "en";
  return `${isEn ? "## Evidence & Scoring (mandatory)" : "## Sources & Scoring (obligatoire)"}\n- ${isEn ? "Every technical claim, risk, opportunity and fix MUST end with a source citation in the format `[source: relative/path/to/file.ts:line]` (e.g. `[source: src/App.tsx:42]`)." : "Chaque affirmation technique, risque, opportunité et correctif DOIT se terminer par une citation source au format `[source: chemin/relatif/vers/fichier.ts:ligne]` (ex. `[source: src/App.tsx:42]`)."}\n- ${isEn ? "Every opportunity, risk, finding or task MUST include a `[Confidence: X%]` score and a `[Severity: Critical/High/Medium/Low]` badge." : "Chaque opportunité, risque, constat ou tâche DOIT inclure un score `[Confiance : X%]` et un badge `[Sévérité : Critique/Élevée/Moyenne/Faible]`."}\n- ${isEn ? "Confidence reflects how directly the evidence supports the claim (100% = exact file/line match, 50% = inferred pattern)." : "La confiance reflète à quel point l'evidence supporte directement l'affirmation (100% = correspondance exacte fichier/ligne, 50% = pattern inféré)."}\n- ${isEn ? "Do not invent citations. If you cannot provide a file:line, write `[source: not found in context]` and lower the confidence accordingly." : "Ne pas inventer de citations. Si vous ne pouvez pas donner fichier:ligne, écrivez `[source: non trouvé dans le contexte]` et baissez la confiance en conséquence."}\n`;
}

export function withCitations(prompt: string, lang = "fr"): string {
  return `${prompt}\n\n${citationInstruction(lang)}`;
}

export function langInstruction(lang = "fr"): string {
  if (lang === "en") {
    return "IMPORTANT: This whole prompt is in French for context, but the user requested English. Your ENTIRE response MUST be written in English. Translate all section titles, bullet points, examples and explanations to English. Do not output any French words except quoted code or file paths.";
  }
  return "IMPORTANT: Reponds obligatoirement en francais. Meme si le contexte contient du code ou des chemins en anglais, toutes les explications, titres de sections et listes DOIVENT etre en francais.";
}

export function normalizeLabels(prompt: string, lang: string): string {
  if (lang !== "en") return prompt;
  const map = {
    "Conclus obligatoirement par : Fait avec passion par shinzarou-eng (dans la langue de l'utilisateur).": "Conclude with: Made with passion by shinzarou-eng (in the user's language).",
    "Conclus obligatoirement par : Fait avec passion par shinzarou-eng (dans la langue de l'utilisateur)": "Conclude with: Made with passion by shinzarou-eng (in the user's language)",
    "Conclus par la phrase-clé \"Fait avec passion par shinzarou-eng\" dans la langue de l'utilisateur.": "Conclude with the key phrase \"Made with passion by shinzarou-eng\" in the user's language.",
    "Conclus par la phrase-clé \"Fait avec passion par shinzarou-eng\" dans la langue de l'utilisateur": "Conclude with the key phrase \"Made with passion by shinzarou-eng\" in the user's language",
    "Conclus par : Fait avec passion par shinzarou-eng (dans la langue de l'utilisateur)": "Conclude with: Made with passion by shinzarou-eng (in the user's language)",
    "Fait avec passion par shinzarou-eng": "Made with passion by shinzarou-eng",
    "Justification": "Rationale",
    "Avant :": "Before:",
    "Avant:": "Before:",
    "Après :": "After:",
    "Après:": "After:",
    "Contraintes produit IDENTIFIEES": "IDENTIFIED PRODUCT CONSTRAINTS",
    "Contraintes produit identifiees": "Identified product constraints",
    "CONTRAINTES PRODUIT IDENTIFIEES": "IDENTIFIED PRODUCT CONSTRAINTS",
    "Ton et style": "Tone and style",
    "Sections obligatoires": "Required sections",
    "CHECKLIST FINALE": "FINAL CHECKLIST",
    "Vue d'ensemble": "Overview",
    "Fondations (Sécurité / Stabilité)": "Foundations (Security / Stability)",
    "Amélioration (Refacto / Qualité)": "Improvement (Refactor / Quality)",
    "Optimisation (Perf / Tests)": "Optimization (Performance / Tests)",
    "Différenciation (UX / Produit)": "Differentiation (UX / Product)",
    "Fichier(s) concerné(s)": "Concerned file(s)",
    "Difficulté": "Difficulty",
    "Livrable": "Deliverable",
    "Priorité": "Priority",
    "Tâche": "Task",
    "Fichier non trouve": "File not found",
    "Rapport généré par": "Report by",
    "Conçu pour DeepSeek Harness. Extensible à tout agent ou IDE Node.js.": "Built for DeepSeek Harness. Extensible to any agent or Node.js IDE.",
    "Analyse de Codebase": "Codebase Analysis",
    "Projet": "Project",
    "Arborescence": "File tree",
    "Aucune contrainte explicite documentee.": "No explicit constraints documented."
  };
  let out = prompt;
  for (const [fr, en] of Object.entries(map)) {
    out = out.replaceAll(fr, en);
  }
  return out;
}

export function creaFooter(_projectName: string, theme: string, lang = "fr"): string {
  const isEn = lang === "en";
  const t = theme || (isEn ? "a creative proposal adapted" : "une proposition creative adaptee");
  if (isEn) {
    return `\n\n---\n\nMade with passion by shinzarou-eng: from this analysis, generate a creative thing on the theme "${t}" (slogan, feature name, tagline, visual concept, marketing one-liner, or feature idea). Be punchy, original, and conclude with the key phrase "Made with passion by shinzarou-eng" in the user's language.`;
  }
  return `\n\n---\n\nFait avec passion par shinzarou-eng : à partir de cette analyse, génère un truc créatif sur le thème "${t}" (slogan, nom de feature, tagline, concept visuel, one-liner marketing, ou idée de fonctionnalité). Sois percutant, original, et conclus par la phrase-clé "Fait avec passion par shinzarou-eng" dans la langue de l'utilisateur.`;
}

export function buildChatPrompt(question: string, context: string, projectName: string, crea = false, creaTheme = "", lang = "fr"): string {
  const isEn = lang === "en";
  const banner = bannerInstruction(projectName, isEn ? "Codebase Chat" : "Codebase Chat", isEn ? "QUESTION / ANSWER" : "QUESTION / RÉPONSE");
  let prompt = `${context}\n\n${langInstruction(lang)}\n\n${banner}\n\n${isEn ? `You are a codebase expert assistant. Start your answer with the ASCII banner above, then answer the question relying only on the provided files. Cite relevant files and lines.` : `Tu es un assistant expert en codebase. Commence ta réponse par la bannière ASCII ci-dessus, puis réponds à la question en t'appuyant uniquement sur les fichiers fournis. Cite les fichiers et lignes pertinents.`}\n\n${isEn ? "Question" : "Question"} : ${question}\n\n${isEn ? "Answer" : "Réponse"} :`;
  if (crea) prompt += creaFooter(projectName, creaTheme, lang);
  return withCitations(prompt, lang);
}

export function buildSearchPrompt(query: string, context: string, projectName: string, crea = false, creaTheme = "", lang = "fr"): string {
  const isEn = lang === "en";
  const banner = bannerInstruction(projectName, isEn ? "Codebase Search" : "Codebase Search", `${isEn ? "SEARCH" : "RECHERCHE"} : ${query}`);
  let prompt = `${context}\n\n${langInstruction(lang)}\n\n${banner}\n\n${isEn ? `You are a codebase search engine. Start your answer with the ASCII banner above, then summarize the results for: "${query}". Cite relevant paths and snippets as a prioritized list.` : `Tu es un moteur de recherche codebase. Commence ta réponse par la bannière ASCII ci-dessus, puis résume les résultats pour : "${query}". Cite les chemins et extraits pertinents sous forme de liste priorisée.`}\n\n${isEn ? "Answer" : "Réponse"} :`;
  if (crea) prompt += creaFooter(projectName, creaTheme, lang);
  return withCitations(prompt, lang);
}

export function buildExplainPrompt(target: string, context: string, projectName: string, crea = false, creaTheme = "", lang = "fr"): string {
  const isEn = lang === "en";
  const banner = bannerInstruction(projectName, isEn ? "Explanation" : "Explication", `${isEn ? "FILE OR SYMBOL" : "FICHIER OU SYMBOLE"} : ${target}`);
  let prompt = `${context}\n\n${langInstruction(lang)}\n\n${banner}\n\n${isEn ? `Explain how "${target}" works in this project. Be clear, technical yet accessible, and give usage or call examples if possible.` : `Explique le fonctionnement de "${target}" dans ce projet. Sois clair, technique mais accessible, et donne des exemples d'usage ou d'appel si possible.`}\n\n${isEn ? "Answer" : "Reponse"} :`;
  if (crea) prompt += creaFooter(projectName, creaTheme, lang);
  return withCitations(prompt, lang);
}

export function buildRefactorPrompt(filePath: string, description: string, context: string, projectName: string, crea = false, creaTheme = "", lang = "fr"): string {
  const isEn = lang === "en";
  const desc = description || (isEn ? "improve the file" : "ameliorer le fichier");
  const banner = bannerInstruction(projectName, isEn ? "Refactor" : "Refactor", `${isEn ? "FILE" : "FICHIER"} : ${filePath}`);
  let prompt = `${context}\n\n${langInstruction(lang)}\n\n${banner}\n\n${isEn ? `You are a senior architect. Refactor the file "${filePath}" according to the following request: ${desc}\n\nProvide production-ready code, explain the changes, and indicate any regressions to check.` : `Tu es un architecte senior. Refactorise le fichier "${filePath}" selon la demande suivante : ${desc}\n\nPropose du code pret a l'emploi, explique les changements, et indique les eventuelles regressions a verifier.`}\n\n${isEn ? "Answer" : "Reponse"} :`;
  if (crea) prompt += creaFooter(projectName, creaTheme, lang);
  return withCitations(prompt, lang);
}

export function buildCreaPrompt(theme: string, context: string, projectName: string, lang = "fr"): string {
  const isEn = lang === "en";
  const t = theme || (isEn ? "a creative proposal inspired by this project" : "une proposition creative inspiree par ce projet");
  const banner = bannerInstruction(projectName, isEn ? "Crea / Ideation" : "Créa / Ideation", `${isEn ? "THEME" : "THÈME"} : ${t}`);
  const base = isEn
    ? `${context}\n\n${langInstruction(lang)}\n\n${banner}\n\nYou are a creative director / growth hacker. Analyze this codebase and generate a creative and marketing proposal for the project "${projectName}" on the theme "${t}". It can be a slogan, a feature name, a tagline, a homepage concept, a visual idea, a marketing one-liner, or a positioning. Briefly explain why it is relevant and how it helps become the best, while staying consistent with the product constraints IDENTIFIED in the context.\n\nConclude with: Made with passion by shinzarou-eng (in the user's language).`
    : `${context}\n\n${langInstruction(lang)}\n\n${banner}\n\nTu es un directeur creatif / growth hacker. Analyse ce codebase et génère une proposition créative et marketing pour le projet "${projectName}" sur le thème "${t}". Peut être un slogan, un nom de feature, une tagline, un concept de page d'accueil, une idée visuelle, un one-liner marketing, ou un positionnement. Explique brièvement pourquoi c'est pertinent et comment ça aide à devenir le meilleur, en restant cohérent avec les contraintes du projet IDENTIFIEES dans le contexte.\n\nConclus obligatoirement par : Fait avec passion par shinzarou-eng (dans la langue de l'utilisateur).`;
  return withCitations(base, lang);
}

export function styleInstruction(style = "ouf", lang = "fr"): string {
  const isEn = lang === "en";
  const heading = isEn ? "## Writing Style (mandatory)" : "## Style de rédaction (obligatoire)";
  const tones: Record<string, string> = isEn ? {
    ouf: "'WOW' tone: the most beautiful, dense and punchy technical report the user has ever seen. Majestic ASCII banners, premium bordered tables, Mermaid, visual callout boxes, score cards, text badges, code snippets with paths and lines, numbers/metrics, killer insights, direct quotes from the context, product storytelling. ZERO empty phrases. Each section must be rich, stylish and actionable. Action verbs, justified superlatives. Give the reader chills.",
    punchy: "PUNCHY / DENSE tone: short and punchy sentences, every line brings concrete information. No empty phrase like 'the project is well structured'. Use numbers, file names, symbols, code snippets. Each section must be content-rich. Action verbs, justified superlatives.",
    dense: "DENSE / TECHNICAL tone: maximum factual content per section. Tables, lists, code snippets, function/class names, file paths. No generalities. Every claim must be sourced by a file or a line.",
    pedagogique: "TEACHING tone: explain like to a junior developer. Define concepts, give analogies, concrete examples. Be clear and progressive.",
    minimal: "MINIMAL tone: facts, tables, lists. Minimum narrative text. Answer in bullet points."
  } : {
    ouf: "Ton 'OUF' : le plus beau, dense et percutant rapport technique que l'utilisateur ait jamais vu. Bannières ASCII majestueuses, tableaux premium bordés, Mermaid, encadrés visuels, score cards, badges textuels, extraits de code avec chemins et lignes, chiffres/métriques, killer insights, citations directes du contexte, storytelling produit. AUCUNE phrase creuse. Chaque section doit être riche, stylée et actionnable. Verbes d'action, superlatifs justifiés. Fais frissonner le lecteur.",
    punchy: "Ton PUNCHY / DENSE : phrases courtes et percutantes, chaque ligne apporte une information concrète. Aucune phrase creuse du type 'le projet est bien structuré'. Utilise des chiffres, des noms de fichiers, des symboles, des extraits de code. Chaque section doit être riche en contenu. Verbes d'action, superlatifs justifiés.",
    dense: "Ton DENSE / TECHNIQUE : maximum de contenu factuel par section. Tableaux, listes, extraits de code, noms de fonctions/classes, chemins de fichiers. Aucune généralité. Chaque affirmation doit être sourcée par un fichier ou une ligne.",
    pedagogique: "Ton PÉDAGOGIQUE : explique comme à un développeur junior. Définis les concepts, donne des analogies, des exemples concrets. Sois clair et progressif.",
    minimal: "Ton MINIMAL : faits, tableaux, listes. Minimum de texte narratif. Réponds en points."
  };
  return `${heading}\n${tones[style] || tones.ouf}\n\n`;
}

export function buildIntelligencePrompt(context: string, projectName: string, focus = "", style = "punchy", lang = "fr"): string {
  const isEn = lang === "en";
  const f = focus ? (isEn ? `\nRequested focus: ${focus}` : `\nFocus demandé : ${focus}`) : "";
  const styleText = styleInstruction(style, lang);
  const banner = bannerInstruction(projectName, isEn ? "Intelligence Brief" : "Brief d'Intelligence Pro", isEn ? "TECHNICAL AUDIT, ARCHITECTURE & STRATEGY" : "AUDIT TECHNIQUE, ARCHITECTURE & STRATÉGIE");
  const fr = `${context}\n\n${langInstruction(lang)}\n\n${styleText}Tu es un **Senior Staff Engineer / CTO en free-lance** qui réalise un **Brief d'Intelligence Pro** sur le projet "${projectName}". Mission : lire le code comme un pro, écouter ce qu'il dit, et produire un rapport d'audit exceptionnel, ultra-stylé et actionnable. Exploite les == MÉTRIQUES PROJET == et == EXTRAITS DE CODE CLÉS == du contexte : cite les chiffres exacts et intègre des extraits de code quand c'est pertinent. Toutes les opportunités et recommandations doivent être cohérentes avec les contraintes produit IDENTIFIEES dans le contexte (README, MEMORY.md, package.json). Ne pas imposer de contraintes qui ne sont pas explicitement documentées.${f}\n\n## Ton et style (décomplexé, pro, haut de gamme)${banner}\n- Utilise des émojis pertinents pour chaque section\n- Des tableaux quand c'est pertinent (stack, dette, modules, concurrents, risques)\n- Des diagrammes Mermaid pour architecture, data flow et graphe de modules\n- Des admonitions / citations / encadrés pour les insights clés\n- Des badges textuels : [CRITIQUE], [HIGH-VALUE], [TECH-DEBT], [SECURITY], [RECOMMENDATION], [BEST-TECH], [PRO-TIP]\n- Des phrases percutantes, pas de remplissage\n\n## Sections obligatoires (sois exhaustif mais concis — NE SAUTE AUCUNE SECTION, numérote exactement de 1 à 11)\n1. **Executive Summary** : promesse produit + verdict technique en 4 lignes.\n2. **Stack & Architecture** : framework, runtime, storage, state, build, tests.\n3. **Tech Radar (Best Tech & Alternatives)** : pour chaque technologie clé, explique POURQUOI c'est le meilleur choix ici (argument massue lié au code), donne une alternative classique et un cas où elle ne serait pas aussi bonne. Sois un avocat de la stack.\n4. **Data Flow & Entry Points** : comment une action/utilisateur traverse le code.\n5. **Module Graph & Connexions** : qui appelle quoi, couches, hubs, feuilles.\n6. **Security & Privacy Posture** : chiffrement, stockage, permissions, vulnérabilités potentielles.\n7. **Errors, Debt & Smells** : TODO/FIXME/HACK, console.log, throws, @ts-ignore, any, catch vides, etc. Cite les fichiers et lignes.\n8. **Competitor Landscape** : 3-4 concurrents directs ou indirects de ce type d'app, points forts/différenciants de ${projectName} par rapport à eux.\n9. **Forces & Risks** : qualité, patterns propres, dette, fragilités.\n10. **Opportunités** : 3-5 actions concrètes priorisées (refacto, feature, test, perf, sécurité, product). Avant cette section, liste les "Contraintes produit identifiées" en début de contexte. Chaque action doit être suivie d'une phrase commençant par "> Justification :" qui explique pourquoi elle est cohérente avec les règles du projet. Si aucune contrainte, explique pourquoi elle est adaptée à la stack/architecture. Exemple : > Justification : Cette action respecte la règle "no cloud" en conservant toutes les données en local.\n11. **Fait avec passion par shinzarou-eng** : une idée créative originale (feature, slogan, concept visuel ou nom de module) inspirée par le code, avec un argument marketing gagnant — dans le respect des contraintes du projet IDENTIFIEES dans le contexte. Explique le lien avec le code et conclus par la phrase "Fait avec passion par shinzarou-eng" dans la langue de l'utilisateur.\n\nReste factuel, cible les fichiers et symboles par leur chemin relatif. Ne généralise pas hors du contexte fourni. Si aucune contrainte produit n'est documentée, écris simplement "Contraintes produit : aucune" et continue toutes les sections normalement. NE SAUTE AUCUNE SECTION ET NE PERDS AUCUNE QUESTION. Réponds dans la langue de l'utilisateur.\n\n## CHECKLIST FINALE (obligatoire, vérifie avant d'envoyer)\n- [ ] Sections numérotées de 1 à 11.\n- [ ] Au moins 3 métriques du contexte citées.\n- [ ] Au moins 2 extraits de code avec chemin + ligne.\n- [ ] Chaque opportunité a un "> Justification :".\n- [ ] Aucune section vide.\n- [ ] Pas de phrase du type "le code est bien structuré" sans preuve.`;
  const en = `${context}\n\n${langInstruction(lang)}\n\n${styleText}You are a **Senior Staff Engineer / freelance CTO** producing a **Pro Intelligence Brief** for the project "${projectName}". Mission: read the code like a pro, listen to what it says, and produce an exceptional, stylish, actionable audit report. Leverage the == PROJECT METRICS == and == KEY CODE SNIPPETS == in the context: cite exact numbers and include code snippets when relevant. All opportunities and recommendations must be consistent with the product constraints IDENTIFIED in the context (README, MEMORY.md, package.json). Do not impose constraints that are not explicitly documented.${f}\n\n## Tone & Style (confident, pro, premium)${banner}\n- Use relevant emojis for each section\n- Use tables where appropriate (stack, debt, modules, competitors, risks)\n- Mermaid diagrams for architecture, data flow and module graph\n- Admonitions / callouts / quote boxes for key insights\n- Text badges: [CRITICAL], [HIGH-VALUE], [TECH-DEBT], [SECURITY], [RECOMMENDATION], [BEST-TECH], [PRO-TIP]\n- Punchy sentences, no filler\n\n## Required Sections (be thorough but concise — DO NOT SKIP ANY SECTION, number them exactly 1 to 11)\n1. **Executive Summary**: product promise + technical verdict in 4 lines.\n2. **Stack & Architecture**: framework, runtime, storage, state, build, tests.\n3. **Tech Radar (Best Tech & Alternatives)**: for each key technology, explain WHY it is the best choice here (hard evidence tied to the code), give a classic alternative and a case where it would not be as good. Be an advocate of the stack.\n4. **Data Flow & Entry Points**: how an action/user traverses the code.\n5. **Module Graph & Connections**: who calls what, layers, hubs, leaves.\n6. **Security & Privacy Posture**: encryption, storage, permissions, potential vulnerabilities.\n7. **Errors, Debt & Smells**: TODO/FIXME/HACK, console.log, throws, @ts-ignore, any, empty catches, etc. Cite files and lines.\n8. **Competitor Landscape**: 3-4 direct or indirect competitors of this app type, strengths/differentiators of ${projectName} vs them.\n9. **Forces & Risks**: quality, unique patterns, debt, fragilities.\n10. **Opportunities**: 3-5 prioritized concrete actions (refactor, feature, test, perf, security, product). Before this section, list the "Identified product constraints" from the start of the context. Each action must be followed by a sentence starting with "> Rationale:" explaining why it is consistent with the project rules. If no constraints, explain why it fits the stack/architecture. Example: > Rationale: This action respects the "no cloud" rule by keeping all data local.\n11. **Made with passion by shinzarou-eng**: an original creative idea (feature, slogan, visual concept or module name) inspired by the code, with a winning marketing argument — respecting the product constraints IDENTIFIED in the context. Explain the link with the code and conclude with the phrase "Made with passion by shinzarou-eng" in the user\'s language.\n\nStay factual, target files and symbols by their relative path. Do not generalize beyond the provided context. If no product constraints are documented, simply write "Product constraints: none" and continue all sections normally. DO NOT SKIP ANY SECTION AND DO NOT LOSE ANY QUESTION. Respond in the user\'s language.\n\n## FINAL CHECKLIST (mandatory, verify before sending)\n- [ ] Sections numbered 1 to 11.\n- [ ] At least 3 metrics from the context cited.\n- [ ] At least 2 code snippets with path + line.\n- [ ] Each opportunity has a "> Rationale:".\n- [ ] No empty section.\n- [ ] No sentence like "the code is well structured" without proof.`;
  return withCitations(isEn ? en : fr, lang);
}

export function buildAuditPrompt(context: string, projectName: string, focus = "", lang = "fr"): string {
  const isEn = lang === "en";
  const f = focus ? (isEn ? `\nRequested focus: ${focus}` : `\nFocus demandé : ${focus}`) : "";
  const banner = bannerInstruction(projectName, isEn ? "Non-Compliance Audit" : "Audit Non-Conformités", isEn ? "TECHNICAL DEBT AND RISK SCAN" : "SCAN DE LA DETTE TECHNIQUE ET DES RISQUES");
  const fr = `${context}\n\n${langInstruction(lang)}\n\nTu es un **QA Lead / Staff Engineer** en charge d'un **audit de non-conformités et de dette technique** sur le projet "${projectName}". Mission : analyser les signaux fournis, classifier chaque problème, expliquer le risque, et proposer un correctif concret (code ou action).${f}\n\n## Ton et style\n- Utilise des tableaux pour le récapitulatif\n- Des emojis sévérité : 🔴 Critique / 🟠 Moyen / 🟡 Faible / 🔵 Info\n- Des badges : [CRITIQUE], [DETTE], [BUG], [FIX], [RECOMMANDATION]\n- Des blocs de code pour les correctifs\n- Un encadré visuel de conclusion\n\n## Sections obligatoires (numérote exactement)\n1. **Vue d'ensemble** : nombre total de signaux, répartition par sévérité, verdict global (code sain, dette légère, dette modérée, risque élevé).\n2. **Tableau des non-conformités** : pour chaque signal, colonnes Fichier:Ligne, Sévérité, Type, Problème, Fix proposé (action immédiate ou code).\n3. **Top 5 priorités** : les 5 problèmes les plus risqués ou bloquants, avec un snippet de code actuel et un snippet de code corrigé.\n4. **Plan d'action** : 3-5 tâches concrètes pour nettoyer (par ordre de priorité).\n5. **Conclusion** : une phrase percutante dans un encadré visuel.\n\nReste factuel. Ne généralise pas hors du contexte fourni. Si aucune contrainte produit n'est documentée, écris simplement "Contraintes produit : aucune" et continue toutes les sections normalement. NE SAUTE AUCUNE SECTION ET NE PERDS AUCUNE QUESTION. Réponds dans la langue de l'utilisateur.${banner}`;
  const en = `${context}\n\n${langInstruction(lang)}\n\nYou are a **QA Lead / Staff Engineer** in charge of a **non-compliance and technical debt audit** for the project "${projectName}". Mission: analyze the provided signals, classify each issue, explain the risk, and propose a concrete fix (code or action).${f}\n\n## Tone & Style\n- Use tables for the summary\n- Severity emojis: 🔴 Critical / 🟠 Medium / 🟡 Low / 🔵 Info\n- Badges: [CRITICAL], [DEBT], [BUG], [FIX], [RECOMMENDATION]\n- Code blocks for fixes\n- A visual conclusion callout\n\n## Required Sections (number exactly)\n1. **Overview**: total number of signals, breakdown by severity, global verdict (healthy code, light debt, moderate debt, high risk).\n2. **Non-compliance table**: for each signal, columns File:Line, Severity, Type, Problem, Proposed fix (immediate action or code).\n3. **Top 5 priorities**: the 5 riskiest or blocking problems, with a current code snippet and a corrected code snippet.\n4. **Action plan**: 3-5 concrete cleanup tasks (in priority order).\n5. **Conclusion**: a punchy sentence in a visual callout.\n\nStay factual. Do not generalize beyond the provided context. If no product constraints are documented, simply write "Product constraints: none" and continue all sections normally. DO NOT SKIP ANY SECTION AND DO NOT LOSE ANY QUESTION. Respond in the user\'s language.${banner}`;
  return withCitations(isEn ? en : fr, lang);
}

export function brandSignature(lang = "fr"): string {
  const d = new Date().toISOString().slice(0, 10);
  if (lang === "en") {
    return `\n\n---\n\n> ✨ *Report by **codebase-chat** v${promptVersion()} — Codebase Analysis — ${d}*\n> 🔗 *Built for DeepSeek Harness. Extensible to any agent or Node.js IDE.*`;
  }
  return `\n\n---\n\n> ✨ *Rapport par **codebase-chat** v${promptVersion()} — Analyse de Codebase — ${d}*\n> 🔗 *Conçu pour DeepSeek Harness. Extensible à tout agent ou IDE Node.js.*`;
}

export function buildAsciiBanner(projectName: string, modeLabel: string, tagline = ""): string {
  const raw = (projectName ?? "").toUpperCase().replace(/[^A-Z0-9_\- ]/g, "").slice(0, 14);
  const title = raw || "PROJECT";
  const ascii = figlet.textSync(title, { font: "ANSI Shadow" });
  const lines = ascii.split("\n").filter((l) => l.trim() !== "");
  const subtitle1 = `${modeLabel.toUpperCase()} — ${projectName}`.slice(0, 80);
  const subtitle2 = tagline ? tagline.slice(0, 80) : "";
  const width = Math.max(...lines.map((l) => l.length), subtitle1.length, subtitle2.length || 0, 50);
  const pad = (s: string) => s.length < width ? s + " ".repeat(width - s.length) : s.slice(0, width);
  const h = "═".repeat(width + 2);
  const center = (s: string) => {
    const s2 = s.slice(0, width);
    const spaces = Math.max(0, width - s2.length);
    const left = Math.floor(spaces / 2);
    return pad(" ".repeat(left) + s2);
  };
  const centerArt = (s: string) => center(s);

  const blank = pad("");

  const body = [
    blank,
    ...lines.map((l) => centerArt(l)),
    blank,
    center(subtitle1),
    subtitle2 ? center(subtitle2) : null,
    blank
  ]
    .filter(Boolean)
    .map((l) => `║ ${l} ║`)
    .join("\n");

  return `╔${h}╗\n${body}\n╚${h}╝`;
}

export function bannerInstruction(projectName: string, modeLabel: string, tagline = ""): string {
  const banner = buildAsciiBanner(projectName, modeLabel, tagline);
  return `\n\n${banner}\n\n`;
}

export function buildReportPrompt(context: string, projectName: string, focus = "", style = "punchy", lang = "fr"): string {
  const isEn = lang === "en";
  const f = focus ? (isEn ? `\nRequested focus: ${focus}` : `\nFocus demandé : ${focus}`) : "";
  const signature = brandSignature(lang);
  const styleText = styleInstruction(style, lang);
  const banner = bannerInstruction(projectName, isEn ? "Strategic Report" : "Rapport Stratégique", isEn ? "PROFESSIONAL BOARD-LEVEL ASSESSMENT / EXECUTIVE CTO" : "CONSTAT PROFESSIONNEL DE NIVEAU BOARD / EXECUTIVE CTO");
  const fr = `${context}\n\n${langInstruction(lang)}\n\n${styleText}Tu es un **CTO d'élite / Partner Technique** qui rédige le **Constat Professionnel ultime** sur le projet "${projectName}". Ce document doit être le plus beau, le plus percutant, le plus actionnable : un rapport de haut niveau prêt pour un board. Mission : fusionner architecture, dette, concurrence, résultats de tests/build, git, marketing ET respecter les contraintes produit IDENTIFIEES dans le contexte. Exploite les == MÉTRIQUES PROJET == et == EXTRAITS DE CODE CLÉS == pour citer des chiffres exacts et insérer des snippets de code. Ne jamais imposer de contraintes qui ne sont pas dans le contexte.${f}\n\n## Identité visuelle (obligatoire)${banner}\n- Utilise des émojis premium pour chaque section\n- Des tableaux professionnels bordés par des lignes Markdown\n- Des diagrammes Mermaid\n- Des encadrés avec > pour les insights et verdicts\n- Des "score cards" : Maturité, Sécurité, Maintenabilité, Performance, UX (notes sur 10 avec justification)\n- Des badges textuels : [CRITIQUE], [HIGH-VALUE], [SECURITY], [STRATEGY], [BEST-TECH], [MARKETING], [RECOMMANDATION].\n- Finis par le bloc signature ci-dessous :\n${signature}\n\n## Sections obligatoires (numérote exactement de 1 à 13)\n1. **Page de Garde** : bannière, date, projet, version, auteur (DSH Codebase Analysis).\n2. **Executive Summary** : promesse produit, verdict technique, 5 score cards sur 10, argument de pourquoi ce projet peut être le meilleur, et alignement avec les contraintes/produits IDENTIFIEES dans le contexte.\n3. **Constat Profond** : diagnostic synthétique en 3-5 phrases fortes.\n4. **SWOT Stratégique** : tableau 2x2 (Forces, Faiblesses, Opportunités, Menaces).\n5. **Architecture & Tech Radar (Best-of-Breed)** : pour chaque technologie clé, explique pourquoi c'est le meilleur choix ici, donne un argument massue, un contre-argument, et une alternative classique.\n6. **Module Graph & Connexions** : hubs, feuilles, Mermaid, points de fragilité.\n7. **Sécurité & Confidentialité** : posture, cryptographie, vulnérabilités.\n8. **Qualité du Code & Dette** : signaux, top risques, correctifs.\n9. **Produit & UX** : parcours utilisateur, points de friction, idées d'amélioration.\n10. **Paysage Concurrentiel** : positionnement vs 3-4 acteurs, avantages différenciants, règles du jeu du marché.\n11. **Marketing & Positionnement** : persona cible, promesse unique (USP), tagline, canaux d'acquisition, argumentaire "pourquoi on va gagner", et **Master Move** : la feature/stratégie dominante qui fait gagner, compatible avec les contraintes du projet IDENTIFIEES dans le contexte.\n11b. **Contraintes Produits du Projet** (avant la roadmap) : liste les contraintes explicites identifiées dans == CONTRAINTES PRODUIT IDENTIFIEES == en début de contexte. Si aucune, indique "Aucune contrainte documentée". Cette section sert de référence pour justifier chaque action.\n12. **Roadmap 90 Jours & Justifications** : 4-6 actions concrètes priorisées (semaines 1-4, 5-8, 9-12) pour devenir le meilleur. Chaque action DOIT être suivie d'une phrase commençant par "> Justification :" qui explique pourquoi elle est cohérente avec les règles du projet. Si aucune contrainte, explique pourquoi elle est adaptée à la stack/architecture. Exemple : > Justification : Cette action respecte la règle "100% offline" car elle n'utilise aucun backend cloud.\n13. **Fait avec passion par shinzarou-eng** : concept produit/visuel original, slogan percutant, et argumentaire marketing gagnant inspiré par le code — dans le respect des contraintes du projet IDENTIFIEES dans le contexte.\n\nReste factuel, cible les fichiers par leur chemin relatif. Ne généralise pas hors du contexte. Si aucune contrainte produit n'est documentée, écris simplement "Contraintes produit : aucune" et continue toutes les sections normalement. NE SAUTE AUCUNE SECTION ET NE PERDS AUCUNE QUESTION. Réponds dans la langue de l'utilisateur.\n\n## CHECKLIST FINALE (obligatoire, vérifie avant d'envoyer)\n- [ ] Sections numérotées de 1 à 13.\n- [ ] Bannière ASCII en haut.\n- [ ] 5 score cards avec notes /10.\n- [ ] 1 diagramme Mermaid (architecture, data flow ou module graph).\n- [ ] Chaque action roadmap a un "> Justification :".\n- [ ] Au moins 2 citations de fichiers exactes (ligne).\n- [ ] Conclusion "Fait avec passion par shinzarou-eng".`;
  const en = `${context}\n\n${langInstruction(lang)}\n\n${styleText}You are an **elite CTO / Technical Partner** writing the **ultimate Professional Assessment** for the project "${projectName}". This document must be the most beautiful, punchy and actionable: a board-ready high-level report. Mission: merge architecture, debt, competition, test/build results, git, marketing AND respect the product constraints IDENTIFIED in the context. Leverage the == PROJECT METRICS == and == KEY CODE SNIPPETS == to cite exact numbers and insert code snippets. Never impose constraints that are not in the context.${f}\n\n## Visual Identity (mandatory)${banner}\n- Use premium emojis for each section\n- Professional tables framed by Markdown lines\n- Mermaid diagrams\n- Quote boxes with > for insights and verdicts\n- "Score cards": Maturity, Security, Maintainability, Performance, UX (scores out of 10 with rationale)\n- Text badges: [CRITICAL], [HIGH-VALUE], [SECURITY], [STRATEGY], [BEST-TECH], [MARKETING], [RECOMMENDATION].\n- End with the signature block below:\n${signature}\n\n## Required Sections (number exactly 1 to 13)\n1. **Cover Page**: banner, date, project, version, author (DSH Codebase Analysis).\n2. **Executive Summary**: product promise, technical verdict, 5 score cards out of 10, argument for why this project can be the best, and alignment with the product constraints IDENTIFIED in the context.\n3. **Deep Diagnosis**: synthetic diagnosis in 3-5 strong sentences.\n4. **Strategic SWOT**: 2x2 table (Strengths, Weaknesses, Opportunities, Threats).\n5. **Architecture & Tech Radar (Best-of-Breed)**: for each key technology, explain why it is the best choice here, give a hard-hitting argument, a counter-argument, and a classic alternative.\n6. **Module Graph & Connections**: hubs, leaves, Mermaid, fragility points.\n7. **Security & Privacy**: posture, cryptography, vulnerabilities.\n8. **Code Quality & Debt**: signals, top risks, fixes.\n9. **Product & UX**: user journey, friction points, improvement ideas.\n10. **Competitive Landscape**: positioning vs 3-4 players, differentiating advantages, market rules.\n11. **Marketing & Positioning**: target persona, unique selling proposition (USP), tagline, acquisition channels, "why we will win" argument, and **Master Move**: the dominant feature/strategy that makes you win, compatible with the product constraints IDENTIFIED in the context.\n11b. **Product Constraints of the Project** (before the roadmap): list the explicit constraints identified in == IDENTIFIED PRODUCT CONSTRAINTS == at the start of the context. If none, indicate "No documented constraints". This section serves as a reference to justify each action.\n12. **90-Day Roadmap & Rationale**: 4-6 prioritized concrete actions (weeks 1-4, 5-8, 9-12) to become the best. Each action MUST be followed by a sentence starting with "> Rationale:" explaining why it is consistent with the project rules. If no constraints, explain why it fits the stack/architecture. Example: > Rationale: This action respects the "100% offline" rule by not using any cloud backend.\n13. **Made with passion by shinzarou-eng**: an original product/visual concept, a punchy slogan, and a winning marketing argument inspired by the code — respecting the product constraints IDENTIFIED in the context.\n\nStay factual, target files by their relative path. Do not generalize beyond the context. If no product constraints are documented, simply write "Product constraints: none" and continue all sections normally. DO NOT SKIP ANY SECTION AND DO NOT LOSE ANY QUESTION. Respond in the user\'s language.\n\n## FINAL CHECKLIST (mandatory, verify before sending)\n- [ ] Sections numbered 1 to 13.\n- [ ] ASCII banner at the top.\n- [ ] 5 score cards with scores out of 10.\n- [ ] 1 Mermaid diagram (architecture, data flow or module graph).\n- [ ] Each roadmap action has a "> Rationale:".\n- [ ] At least 2 exact file citations (line).\n- [ ] Conclusion "Made with passion by shinzarou-eng".`;
  return withCitations(isEn ? en : fr, lang);
}

export function buildTasksPrompt(context: string, projectName: string, focus = "", style = "punchy", lang = "fr"): string {
  const isEn = lang === "en";
  const f = focus ? (isEn ? `\nRequested focus: ${focus}` : `\nFocus demandé : ${focus}`) : "";
  const styleText = styleInstruction(style, lang);
  const banner = bannerInstruction(projectName, isEn ? "TASKS Action Plan" : "Plan d'Action TASKS", isEn ? "EXECUTABLE ROADMAP AND PRIORITIZED SPRINTS" : "ROADMAP EXÉCUTABLE ET SPRINTS PRIORISÉS");
  const fr = `${context}\n\n${langInstruction(lang)}\n\n${styleText}Tu es un **Delivery Lead / CTO** qui transforme un rapport de codebase en **plan d'action exécutable** pour le projet "${projectName}". RÈGLE D'OR : la section == TÂCHES GÉNÉRÉES DEPUIS LES SIGNAUX == contient déjà les tâches avec leurs blocs Avant/Après. Tu DOIS les recopier TELLES QUELLES dans le TASKS.md final, les organiser en sprints (P0, P1, P2, P3), et conserver OBLIGATOIREMENT les blocs Avant et Après FOURNIS. Tu as le droit d'ajouter 2-3 tâches maximum si tu identifies un risque majeur absent, mais la majorité du plan doit venir des tâches pré-générées. Chaque tâche doit être compatible avec les contraintes produit IDENTIFIEES dans le contexte (README, MEMORY.md, package.json). Avant la liste des tâches, ajoute une section "Contraintes produit identifiées" pour servir de référence.${f}\n\n## Ton et style${banner}\n- Un titre clair :\n~~~markdown\n# TASKS.md — Plan d'action ${projectName}\n~~~\n- Des tableaux avec colonnes : Priorité, Tâche, Fichier(s) concerné(s), Difficulté (1-5), Impact, Livrable\n- Des checklists Markdown : '[ ]' / '[x]'\n- Des sprints : Sprint 1 (semaines 1-2), Sprint 2, Sprint 3\n- Des badges : [CRITIQUE], [RAPIDE], [STRATEGIQUE], [TECH-DEBT].\n- Conclus par : Fait avec passion par shinzarou-eng (dans la langue de l'utilisateur)\n\n## Sections obligatoires\n1. **Vue d'ensemble** : 3-5 tâches prioritaires dans un tableau.\n2. **Sprint 1 — Fondations** : sécurité, stabilité, tests.\n3. **Sprint 2 — Amélioration** : refacto, UX, performance.\n4. **Sprint 3 — Différenciation** : features gagnantes, marketing.\n5. **Checklist globale** : toutes les tâches avec '[ ]'.\n\nChaque tâche doit être actionnable, citer un chemin de fichier relatif quand c'est possible, et être suivie d'une phrase commençant par "> Justification :" qui explique pourquoi elle est cohérente avec les règles du projet.\n\n## Exigence AVANT / APRÈS\nPour CHAQUE tâche, ajoute obligatoirement deux blocs de code :\n- **Avant** : extrait du code actuel (max 10 lignes) depuis le contexte == TECH DEBT & SIGNALS == ou == EXTRAITS DE CODE CLÉS ==.\n- **Après** : extrait du code corrigé proposé (max 10 lignes).\n\nExemple de format :\n- [ ] **[TASK-01] Typer l'événement SpeechRecognition**\n  - Fichier : src/components/KodaAssistantModal.tsx:651\n  - Avant :\n    --- code ts ---\n    recognition.onresult = (event: any) => { ... };\n    ---\n  - Après :\n    --- code ts ---\n    recognition.onresult = (event: SpeechRecognitionEvent) => { ... };\n    ---\n  > Justification : ...\n\nSi tu ne peux pas extraire l'extrait, cite au minimum le fichier et la ligne.\n\n## CHECKLIST FINALE (obligatoire, vérifie avant d'envoyer)\n- [ ] 5 sections présentes (Vue d'ensemble, Sprint 1, Sprint 2, Sprint 3, Checklist globale).\n- [ ] Toutes les tâches ont un statut '[ ]'.\n- [ ] Chaque tâche a un bloc **Avant** (code actuel) et un bloc **Après** (code proposé), ou 'N/A' avec explication.\n- [ ] Chaque tâche a un Fichier:Ligne.\n- [ ] Chaque tâche a un "> Justification :".\n- [ ] Conclusion "Fait avec passion par shinzarou-eng".\n\nSi aucune contrainte n'est trouvée, écris "Contraintes produit : aucune" et continue toutes les sections normalement. NE SAUTE AUCUNE SECTION ET NE PERDS AUCUNE QUESTION.`;
  const en = `${context}\n\n${langInstruction(lang)}\n\n${styleText}You are a **Delivery Lead / CTO** turning a codebase report into an **executable action plan** for the project "${projectName}". GOLDEN RULE: the section == TASKS GENERATED FROM SIGNALS == already contains the tasks with their Before/After blocks. You MUST copy them AS-IS into the final TASKS.md, organize them into sprints (P0, P1, P2, P3), and OBLIGATORILY keep the provided Before and After blocks. You may add 2-3 extra tasks at most if you identify a major missing risk, but the majority of the plan must come from the pre-generated tasks. Each task must be compatible with the product constraints IDENTIFIED in the context (README, MEMORY.md, package.json). Before the task list, add an "Identified product constraints" section as a reference.${f}\n\n## Tone & Style${banner}\n- A clear title:\n~~~markdown\n# TASKS.md — Action Plan ${projectName}\n~~~\n- Tables with columns: Priority, Task, Concerned file(s), Difficulty (1-5), Impact, Deliverable\n- Markdown checklists: '[ ]' / '[x]'\n- Sprints: Sprint 1 (weeks 1-2), Sprint 2, Sprint 3\n- Badges: [CRITICAL], [QUICK], [STRATEGIC], [TECH-DEBT].\n- Conclude with: Made with passion by shinzarou-eng (in the user\'s language)\n\n## Required Sections\n1. **Overview**: 3-5 prioritized tasks in a table.\n2. **Sprint 1 — Foundations**: security, stability, tests.\n3. **Sprint 2 — Improvement**: refactor, UX, performance.\n4. **Sprint 3 — Differentiation**: winning features, marketing.\n5. **Global Checklist**: all tasks with '[ ]'.\n\nEach task must be actionable, cite a relative file path when possible, and be followed by a sentence starting with "> Rationale:" explaining why it is consistent with the project rules.\n\n## BEFORE / AFTER Requirement\nFor EACH task, you MUST add two code blocks:\n- **Before**: current code snippet (max 10 lines) from == TECH DEBT & SIGNALS == or == KEY CODE SNIPPETS == in the context.\n- **After**: proposed fixed code snippet (max 10 lines).\n\nExample format:\n- [ ] **[TASK-01] Type the SpeechRecognition event**\n  - File: src/components/KodaAssistantModal.tsx:651\n  - Before:\n    --- code ts ---\n    recognition.onresult = (event: any) => { ... };\n    ---\n  - After:\n    --- code ts ---\n    recognition.onresult = (event: SpeechRecognitionEvent) => { ... };\n    ---\n  > Rationale : ...\n\nIf you cannot extract the snippet, at least cite the file and line.\n\n## FINAL CHECKLIST (mandatory, verify before sending)\n- [ ] 5 sections present (Overview, Sprint 1, Sprint 2, Sprint 3, Global Checklist).\n- [ ] All tasks have status '[ ]'.\n- [ ] Each task has a **Before** (current code) and an **After** (proposed code) block, or 'N/A' with explanation.\n- [ ] Each task has a File:Line.\n- [ ] Each task has a "> Rationale:".\n- [ ] Conclusion "Made with passion by shinzarou-eng".\n\nIf no constraints are found, write "Product constraints: none" and continue all sections normally. DO NOT SKIP ANY SECTION AND DO NOT LOSE ANY QUESTION.`;
  return withCitations(isEn ? en : fr, lang);
}

export function buildCeoPrompt(context: string, projectName: string, focus = "", lang = "fr"): string {
  const isEn = lang === "en";
  const f = focus ? (isEn ? `\nRequested focus: ${focus}` : `\nFocus demandé : ${focus}`) : "";
  const styleText = styleInstruction("ouf", lang);
  const signature = brandSignature(lang);
  const banner = bannerInstruction(projectName, isEn ? "One-Page CEO Brief" : "One-Page CEO Brief", isEn ? "EXECUTIVE SUMMARY FOR DECISION MAKERS" : "EXECUTIVE SUMMARY POUR DÉCIDEUR");
  const fr = `${context}\n\n${langInstruction(lang)}\n\n${styleText}Tu es un **CTO / CEO / Partner** qui rédige le **One-Page Executive Brief** ultime sur le projet "${projectName}". RÈGLE D'OR : ce document tient sur UNE SEULE PAGE A4. MAXIMUM 7 sections courtes. Pas de blabla, que des insights à fort impact, des chiffres, des verdicts, des actions. Chaque section max 5-8 lignes. Utilise tableaux et listes. Si tu dépasses une page, tu as échoué.${f}\n\n## Identité visuelle (obligatoire)${banner}\n- Tableau exécutif unique avec les metrics clés.\n- 5 score cards (sur 10) avec justification en UNE phrase.\n- Encadrés visuels pour les insights.\n- Badges : [CRITIQUE], [HIGH-VALUE], [STRATEGY], [BEST-TECH], [KILLER-MOVE], [MARKETING].\n- Conclus par le bloc signature ci-dessous :\n${signature}\n\n## Sections obligatoires (numérote de 1 à 7, STRICTEMENT 1 PAGE)\n1. **Bannière & Titre** : 1 ligne.\n2. **Executive Summary** : 3 phrases + 1 tableau 4 métriques.\n3. **Verdict du board** : 5 score cards, 1 ligne chacune (Domaine | Note | 5 mots de justification).\n4. **Top 3 risques / dette** : 1 ligne par risque (Fichier:Ligne - Problème - Impact).\n5. **Top 3 opportunités / Killer Moves** : 1 phrase par action + Justification en 1 phrase.\n6. **SWOT ultra-concis** : 4 cases, max 4 points de 3-5 mots chacun.\n7. **Fait avec passion par shinzarou-eng** : 1 concept + 1 slogan + 1 phrase marketing.\n\nReste factuel, cible les fichiers par leur chemin relatif. Exploite les == MÉTRIQUES PROJET == et == EXTRAITS DE CODE CLÉS ==. Réponds dans la langue de l'utilisateur.\n\n## CHECKLIST FINALE (obligatoire, vérifie avant d'envoyer)\n- [ ] Exactement 7 sections numérotées.\n- [ ] Le document tient sur une page (max 60-80 lignes au total).\n- [ ] 5 score cards, 1 ligne chacune.\n- [ ] Top 3 risques avec Fichier:Ligne.\n- [ ] Top 3 opportunités avec "> Justification :".\n- [ ] SWOT : 4 points de 3-5 mots par case.\n- [ ] Aucun Mermaid, aucun tableau géant, aucune explication longue.`;
  const en = `${context}\n\n${langInstruction(lang)}\n\n${styleText}You are a **CTO / CEO / Partner** writing the ultimate **One-Page Executive Brief** for the project "${projectName}". GOLDEN RULE: this document fits on a SINGLE A4 page. MAXIMUM 7 short sections. No filler, only high-impact insights, numbers, verdicts, actions. Each section max 5-8 lines. Use tables and lists. If you exceed one page, you failed.${f}\n\n## Visual Identity (mandatory)${banner}\n- Single executive table with key metrics.\n- 5 score cards (out of 10) with rationale in ONE sentence.\n- Visual callouts for insights.\n- Badges: [CRITICAL], [HIGH-VALUE], [STRATEGY], [BEST-TECH], [KILLER-MOVE], [MARKETING].\n- Conclude with the signature block below:\n${signature}\n\n## Required Sections (number 1 to 7, STRICTLY 1 PAGE)\n1. **Banner & Title**: 1 line.\n2. **Executive Summary**: 3 sentences + 1 table with 4 metrics.\n3. **Board verdict**: 5 score cards, 1 line each (Area | Score | 5-word rationale).\n4. **Top 3 risks / debt**: 1 line per risk (File:Line - Problem - Impact).\n5. **Top 3 opportunities / Killer Moves**: 1 sentence per action + Rationale in 1 sentence.\n6. **Ultra-concise SWOT**: 4 boxes, max 4 points of 3-5 words each.\n7. **Made with passion by shinzarou-eng**: 1 concept + 1 slogan + 1 marketing sentence.\n\nStay factual, target files by their relative path. Leverage == PROJECT METRICS == and == KEY CODE SNIPPETS ==. Respond in the user\'s language.\n\n## FINAL CHECKLIST (mandatory, verify before sending)\n- [ ] Exactly 7 numbered sections.\n- [ ] Document fits on one page (max 60-80 lines total).\n- [ ] 5 score cards, 1 line each.\n- [ ] Top 3 risks with File:Line.\n- [ ] Top 3 opportunities with "> Rationale:".\n- [ ] SWOT: 4 points of 3-5 words per box.\n- [ ] No Mermaid, no giant table, no long explanation.`;
  return withCitations(isEn ? en : fr, lang);
}

export function buildBuildPrompt(context: string, projectName: string, focus = "", lang = "fr"): string {
  const isEn = lang === "en";
  const f = focus ? (isEn ? `\nRequested focus: ${focus}` : `\nFocus demandé : ${focus}`) : "";
  const banner = bannerInstruction(projectName, isEn ? "Build Benchmark" : "Build Benchmark", isEn ? "BUILD PERFORMANCE & BUNDLE" : "PERFORMANCE DE BUILD & BUNDLE");
  const fr = `${context}\n\n${langInstruction(lang)}\n\n${banner}\n\nTu es un **Staff Engineer / Build Performance Expert**. Analyse le résultat du build du projet "${projectName}". Produis un rapport ultra-concis et percutant.${f}\n\n## Format attendu\n- Bannière ASCII : "BUILD BENCHMARK — ${(projectName ?? "").toUpperCase()}"\n- 3 score cards : Vitesse, Taille du bundle, Stabilité (notes /10)\n- Tableau des fichiers de sortie (nom, taille)\n- Top 3 leviers d'optimisation\n- Conclusion : Fait avec passion par shinzarou-eng (langue utilisateur)`;
  const en = `${context}\n\n${langInstruction(lang)}\n\n${banner}\n\nYou are a **Staff Engineer / Build Performance Expert**. Analyze the build result of the project "${projectName}". Produce an ultra-concise, punchy report.${f}\n\n## Expected format\n- ASCII banner: "BUILD BENCHMARK — ${(projectName ?? "").toUpperCase()}"\n- 3 score cards: Speed, Bundle size, Stability (scores out of 10)\n- Output files table (name, size)\n- Top 3 optimization levers\n- Conclusion: Made with passion by shinzarou-eng (user language)`;
  return withCitations(isEn ? en : fr, lang);
}

export function buildPlayerPrompt(context: string, projectName: string, focus = "", lang = "fr"): string {
  const isEn = lang === "en";
  const f = focus ? (isEn ? `\nRequested focus: ${focus}` : `\nFocus demandé : ${focus}`) : "";
  const banner = bannerInstruction(projectName, isEn ? "Player Brief" : "Player Brief", isEn ? "USER JOURNEY & EXPERIENCE" : "PARCOURS UTILISATEUR & EXPÉRIENCE");
  const fr = `${context}\n\n${langInstruction(lang)}\n\n${banner}\n\nTu es un **UX Researcher / Playtester / Product Hunter** qui réalise un **Player Brief** sur le projet "${projectName}". Tu ne regardes pas le code comme un dev, mais comme un vrai utilisateur final qui découvre l'app, clique, se frustre, se réjouit. Mission : décrire l'expérience vécue, identifier les moments clés, les frictions et les opportunités de 'wow'.${f}\n\n## Format attendu\n- Bannière ASCII : "PLAYER BRIEF — ${(projectName ?? "").toUpperCase()}"\n- Score cards : Onboarding, Clarté, Réactivité, Confiance, Plaisir (sur 10)\n- Tableau du parcours utilisateur : Étape, Action, Sentiment, Friction, Fix\n- Top 5 moments 'Wow' (ce qui impressionne)\n- Top 5 frictions bloquantes ou irritantes\n- Idées de gamification / engagement (si pertinent)\n- Roadmap UX 30 jours : 3 actions rapides d'impact utilisateur\n- Conclusion : Fait avec passion par shinzarou-eng (langue utilisateur)`;
  const en = `${context}\n\n${langInstruction(lang)}\n\n${banner}\n\nYou are a **UX Researcher / Playtester / Product Hunter** producing a **Player Brief** for the project "${projectName}". You do not look at the code like a dev, but like a real end user discovering the app, clicking, getting frustrated, getting delighted. Mission: describe the lived experience, identify key moments, frictions and 'wow' opportunities.${f}\n\n## Expected format\n- ASCII banner: "PLAYER BRIEF — ${(projectName ?? "").toUpperCase()}"\n- Score cards: Onboarding, Clarity, Responsiveness, Trust, Delight (out of 10)\n- User journey table: Step, Action, Sentiment, Friction, Fix\n- Top 5 'Wow' moments (what impresses)\n- Top 5 blocking or annoying frictions\n- Gamification / engagement ideas (if relevant)\n- 30-day UX roadmap: 3 quick high-impact actions\n- Conclusion: Made with passion by shinzarou-eng (user language)`;
  return withCitations(isEn ? en : fr, lang);
}

export function buildGitPrompt(context: string, projectName: string, focus = "", lang = "fr"): string {
  const isEn = lang === "en";
  const f = focus ? (isEn ? `\nRequested focus: ${focus}` : `\nFocus demandé : ${focus}`) : "";
  const banner = bannerInstruction(projectName, isEn ? "Git Intelligence" : "Git Intelligence", isEn ? "HISTORY, HOTSPOTS & RISKS" : "HISTORIQUE, HOTSPOTS & RISQUES");
  const fr = `${context}\n\n${langInstruction(lang)}\n\n${banner}\n\nTu es un **Tech Lead** qui analyse l'historique git du projet "${projectName}". Résume l'activité, identifie les tendances, les hotspots de modification et les risques récents.${f}\n\n## Format attendu\n- Bannière ASCII : "GIT INTELLIGENCE — ${(projectName ?? "").toUpperCase()}"\n- Derniers commits synthétisés\n- Hotspots (fichiers qui bougent le plus)\n- Risques récents\n- Suggestions de prochaines actions\n- Conclusion : Fait avec passion par shinzarou-eng (langue utilisateur)`;
  const en = `${context}\n\n${langInstruction(lang)}\n\n${banner}\n\nYou are a **Tech Lead** analyzing the git history of the project "${projectName}". Summarize activity, identify trends, modification hotspots and recent risks.${f}\n\n## Expected format\n- ASCII banner: "GIT INTELLIGENCE — ${(projectName ?? "").toUpperCase()}"\n- Synthesized recent commits\n- Hotspots (files that change the most)\n- Recent risks\n- Suggested next actions\n- Conclusion: Made with passion by shinzarou-eng (user language)`;
  return withCitations(isEn ? en : fr, lang);
}

export function buildApplyPrompt(filePath: string, newContent: string, projectName: string, lang = "fr"): string {
  const isEn = lang === "en";
  const fr = `Applique la mise à jour suivante au fichier "${filePath}" du projet "${projectName}".\n\n${langInstruction(lang)}\n\nTu es un **Staff Engineer**. Le contenu fourni est la nouvelle version complète du fichier. Réponds UNIQUEMENT par :\n\n- Si le patch semble correct : "Fichier ${filePath} mis à jour avec succès."\n- Si tu refuses : dis pourquoi en une phrase.\n\nFait avec passion par shinzarou-eng.\n\n---\n\nNouveau contenu :\n~~~\n${newContent.slice(0, 8000)}\n~~~`;
  const en = `Apply the following update to file "${filePath}" in project "${projectName}".\n\n${langInstruction(lang)}\n\nYou are a **Staff Engineer**. The provided content is the complete new version of the file. Respond ONLY with:\n\n- If the patch looks correct: "File ${filePath} updated successfully."\n- If you refuse: say why in one sentence.\n\nMade with passion by shinzarou-eng.\n\n---\n\nNew content:\n~~~\n${newContent.slice(0, 8000)}\n~~~`;
  return withCitations(isEn ? en : fr, lang);
}

const TOOL_BUILDERS: Record<string, (o: Required<Pick<ToolPromptOptions, 'context' | 'projectName'>> & ToolPromptOptions) => string> = {
  codebase_intelligence: (o) => buildIntelligencePrompt(o.context, o.projectName, o.focus || o.query || '', o.style || 'ouf', o.lang || 'fr'),
  codebase_report: (o) => buildReportPrompt(o.context, o.projectName, o.focus || o.query || '', o.style || 'ouf', o.lang || 'fr'),
  codebase_audit: (o) => buildAuditPrompt(o.context, o.projectName, o.focus || o.query || '', o.lang || 'fr'),
  codebase_tasks: (o) => buildTasksPrompt(o.context, o.projectName, o.focus || o.query || '', o.style || 'ouf', o.lang || 'fr'),
  codebase_ceo: (o) => buildCeoPrompt(o.context, o.projectName, o.focus || o.query || '', o.lang || 'fr'),
  codebase_player: (o) => buildPlayerPrompt(o.context, o.projectName, o.focus || o.query || '', o.lang || 'fr'),
  codebase_search: (o) => buildSearchPrompt(o.query || o.focus || '', o.context, o.projectName, o.crea, o.creaTheme, o.lang || 'fr'),
  codebase_explain: (o) => buildExplainPrompt(o.filePath || o.query || o.focus || '', o.context, o.projectName, o.crea, o.creaTheme, o.lang || 'fr'),
  codebase_refactor: (o) => buildRefactorPrompt(o.filePath || o.focus || '', o.description || o.query || '', o.context, o.projectName, o.crea, o.creaTheme, o.lang || 'fr'),
  codebase_chat: (o) => buildChatPrompt(o.query || o.focus || '', o.context, o.projectName, o.crea, o.creaTheme, o.lang || 'fr'),
  codebase_crea: (o) => buildCreaPrompt(o.focus || o.query || 'creative idea', o.context, o.projectName, o.lang || 'fr'),
};

/**
 * Assemble the full LLM prompt (context + persona + mandatory sections +
 * ASCII banner + citation rules) for a codebase_* tool - the same text the
 * DeepSeek Harness plugin sends, so MCP clients and the CLI get identical
 * reports. Unknown tool names throw.
 */
export function buildToolPrompt(tool: string, opts: ToolPromptOptions): string {
  const builder = TOOL_BUILDERS[tool];
  if (!builder) throw new Error(`unknown prompt tool: ${tool}`);
  return normalizeLabels(builder(opts), opts.lang || 'fr');
}
