#!/usr/bin/env node
import { basename } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { buildContext, resolveProjectPath, findProjectRoot, analyzeProject, formatHealthReport, formatHealthReportMd, getChangedFiles } from "dsh-codebase-chat";
import { callLocalLlm, isLocalLlmEnabled } from "./local-llm.mjs";

// `dsh-codebase-chat-mcp setup` runs the interactive client-config wizard
// instead of starting the MCP server.
if (process.argv[2] === "setup") {
  const { runSetup } = await import("./setup.mjs");
  await runSetup();
  process.exit(0);
}

const VERSION = "0.8.1";

const apiKey = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || "";
const baseUrl = process.env.DEEPSEEK_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.deepseek.com/v1";
const model = process.env.CODEBASE_MODEL || "deepseek-chat";

async function callLlm(prompt, lang = "fr") {
  if (!apiKey) {
    throw new Error("Aucune clef API : definissez DEEPSEEK_API_KEY ou OPENAI_API_KEY");
  }
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(120_000),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: lang === "en" ? "You are a senior codebase analyst. Be precise and cite files." : "Tu es un analyste codebase senior. Sois precis et cite les fichiers." },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 8192,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ${text}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

function getProjectPath(projectPath) {
  return projectPath ? String(projectPath).trim() : process.cwd();
}

function langHint(lang) {
  return lang === "en" ? "Respond strictly in English." : "Reponds obligatoirement en francais.";
}

const INSTRUCTIONS = {
  fr: {
    codebase_intelligence: "Tu es un CTO. Fais un audit technique complet : architecture, radar technologique, dette, securite, opportunites, concurrents, roadmap. SORS DES ACTIONS CONCRETES AVEC [source: chemin: ligne], [Confiance: X%] et [Severite: Critique/Elevee/Moyenne/Faible].",
    codebase_report: "Tu es un directeur strategique. Rends un comite-rendu de direction (SWOT, scorecards, 90 jours). SORS DES ACTIONS CONCRETES AVEC [source: chemin: ligne], [Confiance: X%] et [Severite: Critique/Elevee/Moyenne/Faible].",
    codebase_audit: "Tu es un auditeur tech. Liste les non-conformites, dette technique et correctifs. SORS DES ACTIONS CONCRETES AVEC [source: chemin: ligne], [Confiance: X%] et [Severite: Critique/Elevee/Moyenne/Faible].",
    codebase_ceo: "Tu es un CEO. Donne un one-pager executif : contexte, metriques, risques, opportunites, killer moves. SORS DES ACTIONS CONCRETES AVEC [source: chemin: ligne] et [Confiance: X%].",
    codebase_tasks: "Tu es un tech lead. Genere un TASKS.MD priorise avec sprints, Before/After et patch. SORS DES ACTIONS CONCRETES AVEC [source: chemin: ligne].",
    codebase_player: "Tu es un UX researcher. Fais une analyse playthrough du parcours utilisateur depuis le code. SORS DES ACTIONS CONCRETES AVEC [source: chemin: ligne].",
    codebase_search: "Liste les fichiers et symboles pertinents avec leurs sources. SORS DES SOURCES AVEC [source: chemin: ligne].",
    codebase_explain: "Explique clairement le fonctionnement du fichier ou symbole cible. Cite le code avec [source: chemin: ligne].",
    codebase_refactor: "Propose un refactor concret et executable. Donne un diff / Before-After avec [source: chemin: ligne].",
    codebase_chat: "Reponds a la question en t'appuyant sur le contexte. Cite chaque affirmation avec [source: chemin: ligne].",
    codebase_crea: "Genere des idees creatives, slogans, taglines ou concepts marketing inspires du code. Cite le contexte avec [source: chemin: ligne].",
  },
  en: {
    codebase_intelligence: "You are a CTO. Deliver a full technical audit: architecture, tech radar, debt, security, opportunities, competitors, roadmap. OUTPUT CONCRETE ACTIONS with [source: path:line], [Confidence: X%] and [Severity: Critical/High/Medium/Low].",
    codebase_report: "You are a strategy director. Deliver a board report (SWOT, scorecards, 90-day roadmap). OUTPUT CONCRETE ACTIONS with [source: path:line], [Confidence: X%] and [Severity: Critical/High/Medium/Low].",
    codebase_audit: "You are a tech auditor. List non-conformities, technical debt and fixes. OUTPUT CONCRETE ACTIONS with [source: path:line], [Confidence: X%] and [Severity: Critical/High/Medium/Low].",
    codebase_ceo: "You are a CEO. Give a one-page executive brief: context, metrics, risks, opportunities, killer moves. OUTPUT CONCRETE ACTIONS with [source: path:line] and [Confidence: X%].",
    codebase_tasks: "You are a tech lead. Generate a prioritized TASKS.md with sprints, Before/After and patches. OUTPUT CONCRETE ACTIONS with [source: path:line].",
    codebase_player: "You are a UX researcher. Provide a playthrough analysis of the user journey from the code. OUTPUT CONCRETE ACTIONS with [source: path:line].",
    codebase_search: "List relevant files and symbols with sources. OUTPUT SOURCES with [source: path:line].",
    codebase_explain: "Explain clearly how the target file or symbol works. Cite code with [source: path:line].",
    codebase_refactor: "Propose a concrete, executable refactor. Give a diff / Before-After with [source: path:line].",
    codebase_chat: "Answer the question using the provided context. Cite every claim with [source: path:line].",
    codebase_crea: "Generate creative ideas, slogans, taglines or marketing concepts inspired by the code. Cite context with [source: path:line].",
  },
};

function getOptions(name, args) {
  const project = getProjectPath(args.projectPath);
  const focus = (args.focus || args.query || "").trim();
  const filePath = (args.filePath || "").trim();
  const query = (args.query || "").trim();

  let opts;
  switch (name) {
    case "codebase_search":
      opts = { searchQuery: query || focus };
      break;
    case "codebase_explain":
      opts = { query, filePath: filePath || focus };
      break;
    case "codebase_refactor":
      opts = { query, filePath };
      break;
    case "codebase_crea":
      opts = { query: focus || "creative idea" };
      break;
    case "codebase_chat":
      opts = { query };
      break;
    default:
      opts = { query: focus || query };
  }
  return { project, embed: !!args.embed, diff: (args.diff || "").trim() || undefined, ...opts };
}

function getInstruction(name, lang) {
  return INSTRUCTIONS[lang === "en" ? "en" : "fr"][name] || "";
}

// Tools whose prompts benefit from the deterministic static analysis
// (cycles, dead code, duplication, hotspots) on top of the retrieved chunks.
const ANALYSIS_TOOLS = new Set([
  "codebase_intelligence",
  "codebase_audit",
  "codebase_report",
  "codebase_tasks",
  "codebase_ceo",
]);

async function buildPrompt(name, args) {
  const lang = (args.lang || "fr").toLowerCase();
  const base = getOptions(name, args);
  const instruction = getInstruction(name, lang);
  // The local model context is small — cap the assembled prompt accordingly.
  const useLocal = args.localLlm === true || isLocalLlmEnabled();
  const maxTokens = useLocal
    ? Math.min(Math.max(Number(args.maxTokens) || 6000, 1000), 6000)
    : Math.min(Math.max(Number(args.maxTokens) || 60000, 1000), 200000);

  const { context, absProject } = await buildContext({
    ...base,
    lang,
    maxTokens,
    instruction,
  });

  let staticSection = "";
  if (ANALYSIS_TOOLS.has(name)) {
    try {
      const report = await analyzeProject(absProject);
      staticSection = `\n\n== ${lang === "en" ? "STATIC ANALYSIS (deterministic)" : "ANALYSE STATIQUE (déterministe)"} ==\n${formatHealthReport(report, lang === "en" ? "en" : "fr")}`;
    } catch {
      // Static analysis is best-effort — never block the prompt on it.
    }
  }

  const projectName = basename(await findProjectRoot(resolveProjectPath(base.project)));
  const final = `${langHint(lang)}\n\n${context}${staticSection}`;

  return { prompt: final, projectName };
}

const server = new Server(
  { name: "dsh-codebase-chat-mcp", version: VERSION },
  { capabilities: { tools: {} } }
);

const COMMON_PROPS = {
  projectPath: { type: "string", description: "Absolute path to the project folder (default: current directory)." },
  lang: { type: "string", enum: ["fr", "en"], description: "Response language (default: fr)." },
  embed: { type: "boolean", description: "Enable local semantic embeddings for better retrieval." },
  maxTokens: { type: "number", description: "Context budget for the assembled prompt (default: 60000, max: 200000)." },
  diff: { type: "string", description: "Git ref (branch, tag or SHA) — scope retrieval/analysis to files changed vs this ref." },
  promptOnly: {
    type: "boolean",
    description: "Return the built context+prompt as text instead of calling an LLM — the host model (Cursor, Claude, Windsurf...) answers it directly. Default: true when no API key is configured."
  },
  localLlm: {
    type: "boolean",
    description: "Answer with a small embedded local model (node-llama-cpp) — fully offline, no API key, no host model. Downloads ~1GB GGUF on first use. Quality is lower than hosted models."
  }
};

const TOOLS = [
  { name: "codebase_intelligence", description: "Pro technical audit: architecture, tech debt, opportunities and creative ideas.", extra: { focus: { type: "string" }, style: { type: "string" } } },
  { name: "codebase_report", description: "Strategic board report with SWOT, scorecards and 90-day roadmap.", extra: { focus: { type: "string" }, style: { type: "string" } } },
  { name: "codebase_audit", description: "Non-conformities and technical-debt audit with concrete fixes.", extra: { focus: { type: "string" } } },
  { name: "codebase_tasks", description: "Generate a prioritized TASKS.md with sprints and Before/After.", extra: { focus: { type: "string" }, style: { type: "string" } } },
  { name: "codebase_ceo", description: "One-page executive brief with metrics, risks and killer moves.", extra: { focus: { type: "string" } } },
  { name: "codebase_player", description: "User journey and playthrough UX analysis.", extra: { focus: { type: "string" } } },
  { name: "codebase_search", description: "Search files and symbols by term or pattern.", extra: { query: { type: "string" } }, required: ["query"] },
  { name: "codebase_explain", description: "Explain how a file or symbol works.", extra: { filePath: { type: "string" }, query: { type: "string" } } },
  { name: "codebase_refactor", description: "Propose a refactor for a file or function.", extra: { filePath: { type: "string" }, query: { type: "string" } } },
  { name: "codebase_chat", description: "Open Q/A on the codebase.", extra: { query: { type: "string" } }, required: ["query"] },
  { name: "codebase_crea", description: "Generate creative ideas, slogans or marketing concepts from the code.", extra: { focus: { type: "string" } } },
  { name: "codebase_health", description: "Deterministic static analysis: circular deps, dead code, duplication, complexity hotspots, health score. Returns findings directly — no LLM call.", deterministic: true },
];

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: {
        type: "object",
        properties: { ...COMMON_PROPS, ...t.extra },
        ...(t.required ? { required: t.required } : {})
      }
    }))
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    if (!TOOLS.some((t) => t.name === name)) {
      return { content: [{ type: "text", text: `Error: unknown tool "${name}".` }], isError: true };
    }
    // Deterministic tools run entirely locally and return findings directly.
    if (name === "codebase_health") {
      const project = getProjectPath(args?.projectPath);
      const lang = args?.lang === "en" ? "en" : "fr";
      let scope;
      let scopeNote = "";
      if (args?.diff) {
        const s = await getChangedFiles(await findProjectRoot(resolveProjectPath(project)), String(args.diff));
        if (s.ok) {
          scope = { files: s.files };
          scopeNote = lang === "en"
            ? `> Diff scope: **${s.files.size}** file(s) changed vs \`${args.diff}\`\n\n`
            : `> Périmètre diff : **${s.files.size}** fichier(s) modifié(s) vs \`${args.diff}\`\n\n`;
        } else {
          scopeNote = lang === "en"
            ? `> _diff vs \`${args.diff}\` unavailable — full project analysed_\n\n`
            : `> _diff vs \`${args.diff}\` indisponible — projet complet analysé_\n\n`;
        }
      }
      const report = await analyzeProject(project, scope);
      const text = `${scopeNote}${formatHealthReportMd(report, lang)}\n\n<details><summary>JSON</summary>\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n</details>`;
      return { content: [{ type: "text", text }] };
    }
    const { prompt, projectName } = await buildPrompt(name, args);
    // Embedded local model: fully offline answers, no API key, no host model.
    const useLocal = args?.localLlm === true || isLocalLlmEnabled();
    if (useLocal) {
      const header = `> **dsh-codebase-chat** · \`${projectName}\` · local model (offline, small model — verify citations)\n\n---\n\n`;
      const content = await callLocalLlm(prompt, args.lang);
      return { content: [{ type: "text", text: `${header}${content}` }] };
    }
    // Prompt mode: hand the assembled context+prompt back to the host model.
    // Default when no API key is configured, or when promptOnly is requested.
    const wantsPrompt = args?.promptOnly === true || !apiKey;
    if (wantsPrompt) {
      const header = apiKey
        ? ""
        : `> **dsh-codebase-chat** · \`${projectName}\` · prompt-only mode (no API key) — the context below is for the host model to answer.\n\n---\n\n`;
      return { content: [{ type: "text", text: `${header}${prompt}` }] };
    }
    const content = await callLlm(prompt, args.lang);
    return { content: [{ type: "text", text: content }] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
