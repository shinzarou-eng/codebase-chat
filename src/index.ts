export { buildContext } from './context.js';
export { buildIndex, getIndex, loadIndex, saveIndex, embedIndex } from './indexer.js';
export { resolveProjectPath, findProjectRoot, getCacheDir } from './project.js';
export { countTokens, chunkByTokens, truncateToTokens } from './tokenizer.js';
export { extractChunks } from './extractor.js';
export { initTreeSitter, ensureTreeSitterForExt, treeSitterReady, disposeTreeSitter } from './treesitter.js';
export { scoreChunks, selectChunks } from './retriever.js';
export { getEmbedding, getEmbeddings, getExtractor, cosineSimilarity } from './embeddings.js';
export { analyzeProject, formatHealthReport, formatHealthReportMd } from './analysis.js';
export type { HealthReport, Cycle, UnusedExport, CloneGroup, Hotspot } from './analysis.js';
export { analyzeImpact, formatImpactReport, formatImpactReportMd } from './impact.js';
export type { ImpactReport, ImpactResult, ImpactDependent } from './impact.js';
export { loadProjectConfig, clearConfigCache, globToRegExp, matchesAnyGlob, CONFIG_FILE } from './config.js';
export type { ProjectConfig, ConfigLang } from './config.js';
export { getChangedFiles } from './diff.js';
export type { DiffScope } from './diff.js';
export {
  buildToolPrompt,
  buildAsciiBanner,
  buildChatPrompt,
  buildSearchPrompt,
  buildExplainPrompt,
  buildRefactorPrompt,
  buildCreaPrompt,
  buildIntelligencePrompt,
  buildAuditPrompt,
  buildReportPrompt,
  buildTasksPrompt,
  buildCeoPrompt,
  buildPlayerPrompt,
  buildBuildPrompt,
  buildGitPrompt,
  buildApplyPrompt,
  styleInstruction,
  langInstruction,
  normalizeLabels,
  brandSignature,
} from './prompts.js';
export type { ToolPromptOptions } from './prompts.js';
export { buildDeterministicReport, collectAudit, renderAuditMd, hasDedicatedTest, scanCode } from './report.js';
export { auditFindings } from './findings.js';
export { writeBaseline, readBaseline, diffFindings, BASELINE_REL } from './baseline.js';
export type { Baseline } from './baseline.js';
export { runCheck, formatCheckMd } from './check.js';
export { checkToSarif } from './sarif.js';
export type { CheckFile, CheckReport } from './check.js';
export { readIgnores, addIgnore, removeIgnore, splitIgnored, IGNORES_REL } from './ignores.js';
export type { Ignore } from './ignores.js';
export { appendHistory, readHistory, HISTORY_REL } from './history.js';

export { planFixes, applyFixes } from './fix.js';
export type { Fix } from './fix.js';
export type { CheckHistoryEntry } from './history.js';
export { runDoctor, formatDoctorMd } from './doctor.js';
export type { DoctorItem, DoctorReport } from './doctor.js';
export type { AuditData, AuditFinding, Severity, Finding, SmellScan, GitStats } from './report-types.js';
export { reportToHtml } from './ui.js';
export type * from './types.js';
