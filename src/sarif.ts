// SARIF 2.1.0 export — the CheckReport's actionable findings (new or escalated
// since the baseline, on changed files or file-less, never ignored) rendered in
// the format GitHub code scanning / `codeql-action/upload-sarif` understands.
import type { CheckReport } from './check.js';
import type { AuditFinding, Severity } from './report-types.js';

const LEVEL: Record<Severity, 'error' | 'warning' | 'note'> = {
  'Critique': 'error', 'Élevée': 'error', 'Moyenne': 'warning', 'Faible': 'note',
};

export function checkToSarif(r: CheckReport, toolVersion?: string): string {
  const ignoredIds = new Set(r.ignored.map(f => f.id));
  const results = [...r.diff.added, ...r.diff.escalated]
    .filter(f => !f.file || r.changedFiles.includes(f.file))
    .filter(f => !ignoredIds.has(f.id));

  const rules = [...new Map(results.map(f => [f.rule, f.rule])).values()]
    .sort()
    .map(id => ({ id, name: id, shortDescription: { text: `codebase-chat rule ${id}` } }));

  const location = (f: AuditFinding) => f.file
    ? [{
        physicalLocation: {
          artifactLocation: { uri: f.file, uriBaseId: 'SRCROOT' },
          ...(f.line ? { region: { startLine: f.line } } : {}),
        },
      }]
    : [];

  const sarif = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: {
        driver: {
          name: 'codebase-chat',
          ...(toolVersion ? { version: toolVersion } : {}),
          informationUri: 'https://github.com/shinzarou-eng/codebase-chat',
          rules,
        },
      },
      results: results.map(f => ({
        ruleId: f.rule,
        level: LEVEL[f.severity],
        message: { text: f.message },
        locations: location(f),
      })),
    }],
  };
  return JSON.stringify(sarif, null, 2);
}
