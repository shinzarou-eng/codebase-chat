import { describe, it, expect } from 'vitest';

// Smoke test: the DSH plugin entry (lib/index.js) must load and expose the
// DeepSeek Harness contract — apply(ctx), inject, prompt builders.
describe('dsh plugin entry (lib/index.js)', () => {
  it('exports apply + inject + prompt builders', async () => {
    const mod: any = await import('../lib/index.js');
    expect(typeof mod.apply).toBe('function');
    expect(Array.isArray(mod.inject)).toBe(true);
    expect(typeof mod.buildIntelligencePrompt).toBe('function');
    expect(typeof mod.collectCodebaseContext).toBe('function');
  });
});
