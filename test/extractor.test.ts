import { describe, it, expect } from 'vitest';
import { extractChunks } from '../src/extractor';

const SAMPLE = `
import { foo } from './foo';

const TOKEN = "abc123"; // hardcoded

export function auth() {
  return foo();
}

class User {
  name: string;
  login() {
    return this.name;
  }
}

export default User;
`;

describe('extractChunks', () => {
  it('splits a TS file into meaningful chunks', () => {
    const chunks = extractChunks('src/auth.ts', SAMPLE);
    const kinds = new Set(chunks.map(c => c.kind));
    expect(chunks.length).toBeGreaterThan(0);
    expect(kinds.has('function')).toBe(true);
    expect(kinds.has('class')).toBe(true);
    expect(kinds.has('method')).toBe(true);
    expect(kinds.has('import')).toBe(true);
  });

  it('captures chunk names', () => {
    const chunks = extractChunks('src/auth.ts', SAMPLE);
    const names = chunks.map(c => c.name).filter(Boolean);
    expect(names).toContain('auth');
    expect(names).toContain('User');
    expect(names).toContain('login');
    expect(names).toContain('TOKEN');
  });

  it('never loses line coverage', () => {
    const chunks = extractChunks('src/auth.ts', SAMPLE);
    const lines = SAMPLE.split('\n');
    const covered = new Set<number>();
    for (const chunk of chunks) {
      for (let i = chunk.startLine; i <= chunk.endLine; i++) {
        covered.add(i);
      }
    }
    // Every non-empty line should belong to at least one chunk
    for (let i = 1; i <= lines.length; i++) {
      if (lines[i - 1].trim()) {
        expect(covered.has(i)).toBe(true);
      }
    }
  });
});
