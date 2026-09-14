// Deterministic full report - a complete structured audit built purely from
// static analysis: index stats, import graph, package manifest, health report.
// Zero LLM, zero network - same project in → same report out.
//
// Public facade - implementation lives in focused modules:
//   report-scan.ts    patterns + scanCode (grep-grade smell/security hits)
//   report-git.ts     git activity (churn, authors, commit quality)
//   report-collect.ts collectors + collectAudit orchestrator
//   report-render.ts  renderAuditMd (deterministic Markdown, FR/EN)

export { scanCode, SMELL_PATS, SEC_PATS, countHits } from './report-scan.js';
export { gitActivity, commitQuality, SENSITIVE_PATS } from './report-git.js';
export { collectAudit, hasDedicatedTest } from './report-collect.js';
export { renderAuditMd, buildDeterministicReport } from './report-render.js';
export type { Finding, SmellScan, GitStats, AuditData } from './report-types.js';
