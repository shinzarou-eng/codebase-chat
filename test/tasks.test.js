import { describe, it, expect } from 'vitest';
import {
  formatRawTasksMarkdown,
  parseRawTasksMarkdown,
  computePatch,
  parseCodebaseInput,
} from '../lib/index.js';

const metrics = {
  files: 10,
  sourceFiles: 8,
  totalLines: 1000,
  codeLines: 800,
  testFiles: 2,
  testLines: 100,
  componentFiles: 3,
  utilFiles: 2,
};

const task = {
  id: 'TASK-001',
  title: 'Nettoyer les logs de debug',
  file: 'src/app.ts',
  line: 12,
  priority: '🟡 P2',
  before: '12: console.log("debug");',
  after: '12: logger.debug("debug");',
  justification: 'Supprime un log de debug.',
};

describe('TASKS.md round-trip', () => {
  it('generates markdown that the apply parser can read back', () => {
    const md = formatRawTasksMarkdown('demo', metrics, ['offline'], [task], 'fr');
    const tasks = parseRawTasksMarkdown(md);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe('TASK-001');
    expect(tasks[0].relPath).toBe('src/app.ts');
    expect(tasks[0].lineNum).toBe(12);
    expect(tasks[0].before).toContain('console.log');
    expect(tasks[0].after).toContain('logger.debug');
  });

  it('parses English output too', () => {
    const md = formatRawTasksMarkdown('demo', metrics, [], [task], 'en');
    const tasks = parseRawTasksMarkdown(md);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].relPath).toBe('src/app.ts');
  });

  it('accepts ``` fences as well as ~~~ fences', () => {
    const md = formatRawTasksMarkdown('demo', metrics, [], [task], 'fr').replaceAll('~~~ts', '```ts').replaceAll('~~~\n', '```\n').replaceAll('~~~', '```');
    const tasks = parseRawTasksMarkdown(md);
    expect(tasks).toHaveLength(1);
  });
});

describe('computePatch', () => {
  it('extracts changed lines from before/after blocks', () => {
    const patches = computePatch(task.before, task.after);
    expect(patches).toEqual([
      { line: 12, oldCode: 'console.log("debug");', newCode: 'logger.debug("debug");' },
    ]);
  });
});

describe('parseCodebaseInput', () => {
  it('parses --content without leaking it into the query', () => {
    const r = parseCodebaseInput('--file src/app.ts --content "const a = 1;" --project .');
    expect(r.filePath).toBe('src/app.ts');
    expect(r.content).toBe('const a = 1;');
    expect(r.query).toBe('');
  });

  it('parses --lang', () => {
    const r = parseCodebaseInput('hello --lang en');
    expect(r.lang).toBe('en');
    expect(r.query).toBe('hello');
  });
});
