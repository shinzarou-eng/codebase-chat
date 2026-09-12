import { describe, it, expect } from 'vitest';
import {
  buildAsciiBanner,
  buildToolPrompt,
  buildIntelligencePrompt,
  buildChatPrompt,
  normalizeLabels,
  brandSignature,
} from '../src/prompts.js';

describe('prompts', () => {
  it('buildAsciiBanner renders a bordered box with the project name', () => {
    const banner = buildAsciiBanner('demo-app', 'Intelligence Brief', 'TEST');
    expect(banner).toContain('╔');
    expect(banner).toContain('╚');
    expect(banner).toContain('║');
    expect(banner).toContain('INTELLIGENCE BRIEF — demo-app');
    expect(banner).toContain('TEST');
  });

  it('buildIntelligencePrompt embeds banner, sections spec and citation rules', () => {
    const p = buildIntelligencePrompt('== CONTEXT ==\nsrc/a.ts', 'demo', '', 'ouf', 'fr');
    expect(p).toContain('== CONTEXT ==');
    expect(p).toContain('╔'); // ASCII banner present
    expect(p).toContain('CHECKLIST FINALE');
    expect(p).toContain('[source:');
    expect(p).toContain('Brief d\'Intelligence Pro');
  });

  it('buildChatPrompt includes the question and a banner', () => {
    const p = buildChatPrompt('how does auth work?', '== CONTEXT ==', 'demo', false, '', 'en');
    expect(p).toContain('how does auth work?');
    expect(p).toContain('╔');
    expect(p).toContain('QUESTION / ANSWER');
  });

  it('buildToolPrompt dispatches every codebase_* tool', () => {
    const tools = [
      'codebase_intelligence', 'codebase_report', 'codebase_audit',
      'codebase_tasks', 'codebase_ceo', 'codebase_player',
      'codebase_search', 'codebase_explain', 'codebase_refactor',
      'codebase_chat', 'codebase_crea',
    ];
    for (const tool of tools) {
      const p = buildToolPrompt(tool, {
        context: '== CONTEXT ==\nsrc/a.ts',
        projectName: 'demo',
        lang: 'fr',
        query: 'test query',
        filePath: 'src/a.ts',
      });
      expect(p.length, tool).toBeGreaterThan(200);
      expect(p, tool).toContain('== CONTEXT ==');
    }
  });

  it('buildToolPrompt rejects unknown tools', () => {
    expect(() =>
      buildToolPrompt('codebase_nope', { context: 'x', projectName: 'demo' }),
    ).toThrow(/unknown prompt tool/);
  });

  it('normalizeLabels translates French labels for English output', () => {
    const p = normalizeLabels('Chaque action a une > Justification : x', 'en');
    expect(p).toContain('Rationale');
  });

  it('brandSignature carries the package version', () => {
    const s = brandSignature('fr');
    expect(s).toMatch(/dsh-codebase-chat\*?\*? v\d+\.\d+\.\d+/);
  });
});
