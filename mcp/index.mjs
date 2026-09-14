#!/usr/bin/env node
import { basename } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { buildContext, resolveProjectPath, findProjectRoot, analyzeProject, formatHealthReport, formatHealthReportMd, getChangedFiles, analyzeImpact, formatImpactReportMd, buildToolPrompt, buildDeterministicReport, reportToHtml, runCheck, formatCheckMd, runDoctor, formatDoctorMd, addIgnore, removeIgnore, readIgnores, appendHistory, collectAudit, auditFindings, splitIgnored, planFixes, applyFixes } from "codebase-chat";

// `codebase-chat-mcp setup` runs the interactive client-config wizard
// instead of starting the MCP server.
if (process.argv[2] === "setup") {
  const { runSetup } = await import("./setup.mjs");
  await runSetup();
  process.exit(0);
}

const VERSION = "0.10.0";

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
  const maxTokens = Math.min(Math.max(Number(args.maxTokens) || 60000, 1000), 200000);

  const { context, absProject, noMatch } = await buildContext({
    ...base,
    lang,
    maxTokens,
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
  const query = base.query || base.searchQuery || "";
  // Same rich prompt the DeepSeek Harness plugin sends — ASCII banner,
  // persona, mandatory sections, citation rules — for identical reports.
  const final = buildToolPrompt(name, {
    context: `${context}${staticSection}`,
    projectName,
    lang,
    style: args.style,
    query,
    focus: base.query || "",
    filePath: base.filePath || "",
    description: base.query || "",
  });

  return { prompt: final, projectName, noMatch };
}

const server = new Server(
  { name: "codebase-chat-mcp", version: VERSION },
  { capabilities: { tools: {}, prompts: {} } }
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
  { name: "codebase_impact", description: "Blast-radius analysis: which files transitively depend on a target file — what breaks if it changes. Deterministic, no LLM call.", extra: { file: { type: "string", description: "File to analyze (relative path or name, e.g. src/store.ts)" } }, required: ["file"], deterministic: true },
  { name: "codebase_check", description: "Verify your changes vs a git ref: blast radius, complexity, findings and delta vs the committed baseline (.codebase-chat/baseline.json). Deterministic, no LLM call.", extra: { base: { type: "string", description: "Git ref to diff against (default: HEAD)" } }, deterministic: true },
  { name: "codebase_doctor", description: "Installation & environment diagnostic: node version, index cache, LLM keys presence, tree-sitter, baseline staleness, MCP client integrations. Deterministic, no LLM call.", deterministic: true },
  { name: "codebase_ignore", description: "Silence a finding with a justification (written to .codebase-chat/ignores.json — commit it). `id` may be a full finding id or a prefix like `sec:innerHTML:src/x.ts` covering every such finding in that file. Use action=list/remove to manage entries.", extra: { id: { type: "string", description: "Finding id or prefix (see codebase_check JSON output)" }, reason: { type: "string" }, action: { type: "string", enum: ["add", "remove", "list"] } }, required: ["id"], deterministic: true },
  { name: "codebase_fix", description: "Apply mechanical repairs for the rules where the fix is unambiguous — env-undoc (append to .env.example), dead-dep (remove from package.json), unused-export (delete or un-export), console/debugger lines (delete). Each fix re-checks: the finding disappears. Pass dry=true to preview without writing. Deterministic, no LLM call.", extra: { dry: { type: "boolean", description: "Preview the plan without writing (default: false — applies)" } }, deterministic: true },
  { name: "codebase_deep_audit", description: "Full deterministic audit (~30 analyses): git churn & bus factor, churn × complexity risk, dependency integrity (undeclared imports, dead deps, lockfile drift, broken package entries), per-function complexity, secrets & sensitive files, env-var coverage, config & README hygiene — all cited file:line. Returns findings directly — no LLM call. Set ui=true to also receive an interactive HTML dashboard (MCP-UI).", extra: { ui: { type: "boolean", description: "Also return a ui:// resource with an interactive HTML dashboard" } }, deterministic: true },
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

// Shared ignore logic — used by both tools/call and prompts/get.
// A missing id means "list" (a prompt cannot reasonably require one).
async function handleIgnore(project, args) {
  const abs = await findProjectRoot(project).catch(() => project);
  const id = String(args?.id ?? "").trim();
  const action = String(args?.action ?? "").trim() || (id ? "add" : "list");
  if (action === "list" || !id) {
    const list = await readIgnores(abs);
    return list.length
      ? list.map((i) => `- \`${i.id}\` — ${i.reason} (${i.createdAt.slice(0, 10)})`).join("\n")
      : "No ignores.";
  }
  if (action === "remove") {
    const ok = await removeIgnore(abs, id);
    return ok ? `Removed ignore \`${id}\`.` : `No ignore entry \`${id}\`.`;
  }
  const reason = String(args?.reason ?? "").trim() || "no reason given";
  const entry = await addIgnore(abs, id, reason);
  return entry ? `Ignored \`${id}\` — ${reason} (.codebase-chat/ignores.json, commit it).` : `\`${id}\` is already ignored.`;
}

// Mechanical fixes — plan, optionally apply, then re-check so the caller sees
// the findings actually disappear. Ignored findings are never "repaired".
async function handleFix(project, args) {
  const abs = await findProjectRoot(project).catch(() => project);
  const lang = args?.lang === "en" ? "en" : "fr";
  const en = lang === "en";
  const data = await collectAudit(abs);
  const ignores = await readIgnores(abs);
  const { active } = splitIgnored(auditFindings(data, lang), ignores);
  const fixes = planFixes(active, lang);
  if (!fixes.length)
    return en ? "No mechanically fixable findings." : "Aucun finding réparable mécaniquement.";
  const plan = (en ? `${fixes.length} mechanical fix(es):\n` : `${fixes.length} réparation(s) mécanique(s) :\n`)
    + fixes.map((f) => `- ${f.description}  (\`${f.finding.id}\`)`).join("\n");
  if (args?.dry)
    return plan + (en ? "\n\nDry run — nothing written. Call again without `dry` to apply." : "\n\nDry run — rien d'écrit. Relancer sans `dry` pour appliquer.");
  const { applied, skipped, failed } = await applyFixes(abs, fixes);
  let text = plan + (en
    ? `\n\n${applied.length} applied${skipped.length ? `, ${skipped.length} skipped` : ""}${failed.length ? `, ${failed.length} failed` : ""}.`
    : `\n\n${applied.length} appliquée(s)${skipped.length ? `, ${skipped.length} ignorée(s)` : ""}${failed.length ? `, ${failed.length} en échec` : ""}.`);
  for (const f of skipped) text += `\n- – ${f.description} (${en ? "no standalone match" : "pas de ligne autonome"})`;
  for (const f of failed) text += `\n- ✗ ${f.fix.description} — ${f.error}`;
  // Proof: re-audit and count how many planned findings are gone.
  const after = new Set(auditFindings(await collectAudit(abs), lang).map((f) => f.id));
  const gone = applied.filter((f) => !after.has(f.finding.id)).length;
  text += en
    ? `\n\nRe-audit: ${gone}/${applied.length} finding(s) resolved.`
    : `\n\nRe-audit : ${gone}/${applied.length} finding(s) résolu(s).`;
  return text;
}

// MCP prompts — surface each tool as a user-invocable slash command
// (Claude Code: /mcp__codebase-chat-mcp__<name>).
const ARG_DESC = {
  file: "File to analyze (relative path or name)",
  id: "Finding id or prefix (e.g. sec:innerHTML:src/x.ts)",
  query: "Query / question",
};
const PROMPTS = TOOLS.map((t) => ({
  name: t.name.replace(/^codebase_/, ""),
  description: t.description,
  arguments: [
    ...(t.required ?? []).map((k) => ({
      name: k,
      description: ARG_DESC[k] ?? "Query / question",
      required: true,
    })),
    ...(t.name === "codebase_check"
      ? [{ name: "base", description: "Git ref to diff against (default HEAD)", required: false }]
      : []),
    ...(t.name === "codebase_ignore"
      ? [{ name: "action", description: "add | remove | list (default: add, or list when id omitted)", required: false },
         { name: "reason", description: "Why this finding is silenced", required: false }]
      : []),
    { name: "query", description: "Question or focus (optional)", required: false },
    { name: "projectPath", description: "Absolute project path (default: cwd)", required: false },
    { name: "lang", description: "fr | en (default: fr)", required: false },
    { name: "diff", description: "Git ref — scope to files changed vs it", required: false },
  ].filter((a, i, arr) => arr.findIndex((b) => b.name === a.name) === i),
}));

server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: PROMPTS }));

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  const tool = TOOLS.find((t) => t.name === name || t.name === `codebase_${name}`);
  if (!tool) throw new Error(`unknown prompt "${name}"`);

  const project = getProjectPath(args.projectPath);
  const lang = args.lang === "en" ? "en" : "fr";

  // Deterministic analyses: run locally, return the finished report.
  if (tool.deterministic) {
    let text;
    if (tool.name === "codebase_health") {
      let scope;
      let scopeNote = "";
      if (args.diff) {
        const s = await getChangedFiles(await findProjectRoot(resolveProjectPath(project)), String(args.diff));
        if (s.ok) {
          scope = { files: s.files };
          scopeNote = lang === "en"
            ? `> Diff scope: **${s.files.size}** file(s) changed vs \`${args.diff}\`\n\n`
            : `> Périmètre diff : **${s.files.size}** fichier(s) modifié(s) vs \`${args.diff}\`\n\n`;
        }
      }
      const report = await analyzeProject(project, scope);
      text = `${scopeNote}${formatHealthReportMd(report, lang)}`;
    } else if (tool.name === "codebase_deep_audit") {
      text = await buildDeterministicReport(project, lang);
    } else if (tool.name === "codebase_impact") {
      const file = String(args.file ?? args.query ?? "").trim();
      const r = file ? await analyzeImpact(project, file) : { ok: false, candidates: [] };
      text = r.ok
        ? formatImpactReportMd(r.report, lang)
        : (lang === "en" ? "Pass a file name, e.g. `src/store.ts`." : "Passe un nom de fichier, ex. `src/store.ts`.");
    } else if (tool.name === "codebase_check") {
      const report = await runCheck(project, { base: String(args.base || "HEAD"), lang });
      text = formatCheckMd(report, lang);
    } else if (tool.name === "codebase_doctor") {
      text = formatDoctorMd(await runDoctor(project, lang), lang);
    } else if (tool.name === "codebase_ignore") {
      text = await handleIgnore(project, args);
    } else if (tool.name === "codebase_fix") {
      text = await handleFix(project, args);
    }
    return { messages: [{ role: "user", content: { type: "text", text } }] };
  }

  const { prompt } = await buildPrompt(tool.name, {
    ...args,
    file: args.file,
    lang,
  });
  return { messages: [{ role: "user", content: { type: "text", text: prompt } }] };
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
    if (name === "codebase_deep_audit") {
      const project = getProjectPath(args?.projectPath);
      const lang = args?.lang === "en" ? "en" : "fr";
      const text = await buildDeterministicReport(project, lang);
      const content = [{ type: "text", text }];
      if (args?.ui === true && reportToHtml) {
        const html = reportToHtml(text, { project: project.split(/[\\/]/).pop() || "project", generated: new Date().toISOString().slice(0, 10) });
        content.push({ type: "resource", resource: { uri: `ui://codebase-chat/deep-audit`, mimeType: "text/html", text: html } });
      }
      return { content };
    }
    if (name === "codebase_impact") {
      const project = getProjectPath(args?.projectPath);
      const lang = args?.lang === "en" ? "en" : "fr";
      const file = String(args?.file ?? args?.query ?? "").trim();
      if (!file) {
        return { content: [{ type: "text", text: `Error: \`file\` is required (e.g. "src/store.ts").` }], isError: true };
      }
      const r = await analyzeImpact(project, file);
      if (!r.ok) {
        const msg = r.candidates.length
          ? (lang === "en" ? `Ambiguous target \`${file}\` — candidates:` : `Cible ambiguë \`${file}\` — candidats :`)
            + "\n" + r.candidates.map((c) => `- \`${c}\``).join("\n")
          : (lang === "en" ? `No code file matches \`${file}\`.` : `Aucun fichier de code ne correspond à \`${file}\`.`);
        return { content: [{ type: "text", text: msg }] };
      }
      const text = `${formatImpactReportMd(r.report, lang)}\n\n<details><summary>JSON</summary>\n\n\`\`\`json\n${JSON.stringify(r.report, null, 2)}\n\`\`\`\n</details>`;
      return { content: [{ type: "text", text }] };
    }
    if (name === "codebase_check") {
      const project = getProjectPath(args?.projectPath);
      const lang = args?.lang === "en" ? "en" : "fr";
      const report = await runCheck(project, { base: String(args?.base || "HEAD"), lang });
      const abs = await findProjectRoot(project).catch(() => project);
      await appendHistory(abs, { ts: new Date().toISOString(), base: report.base, head: report.head, verdict: report.verdict, score: report.score, changed: report.changedFiles.length, added: report.diff.added.length, resolved: report.diff.resolved.length });
      const text = `${formatCheckMd(report, lang)}\n\n<details><summary>JSON</summary>\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n</details>`;
      return { content: [{ type: "text", text }] };
    }
    if (name === "codebase_doctor") {
      const project = getProjectPath(args?.projectPath);
      const lang = args?.lang === "en" ? "en" : "fr";
      return { content: [{ type: "text", text: formatDoctorMd(await runDoctor(project, lang), lang) }] };
    }
    if (name === "codebase_ignore") {
      const project = getProjectPath(args?.projectPath);
      const id = String(args?.id ?? "").trim();
      const action = String(args?.action ?? "").trim() || (id ? "add" : "list");
      if (!id && action !== "list") return { content: [{ type: "text", text: "Error: `id` is required." }], isError: true };
      const text = await handleIgnore(project, { ...args, action });
      return { content: [{ type: "text", text }] };
    }
    if (name === "codebase_fix") {
      const project = getProjectPath(args?.projectPath);
      return { content: [{ type: "text", text: await handleFix(project, args) }] };
    }
    const { prompt, projectName, noMatch } = await buildPrompt(name, args);
    // Prompt mode: hand the assembled context+prompt back to the host model.
    // Default when no API key is configured, or when promptOnly is requested.
    const wantsPrompt = args?.promptOnly === true || !apiKey;
    if (wantsPrompt) {
      const header = apiKey
        ? ""
        : `> **codebase-chat** · \`${projectName}\` · prompt-only mode (no API key) — the context below is for the host model to answer.\n\n---\n\n`;
      const note = noMatch
        ? (args?.lang === "en"
          ? `> No code chunk matches "${args?.query ?? ""}" — the context below holds the file tree only.\n\n`
          : `> Aucun fragment ne correspond à « ${args?.query ?? ""} » — le contexte ci-dessous ne contient que l'arborescence.\n\n`)
        : "";
      return { content: [{ type: "text", text: `${header}${note}${prompt}` }] };
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
