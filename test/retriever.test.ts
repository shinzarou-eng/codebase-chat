import { describe, it, expect } from 'vitest';
import { extractChunks } from '../src/extractor';
import { buildIndex } from '../src/indexer';
import { scoreChunks, selectChunks } from '../src/retriever';
import type { CodeIndex } from '../src/types';
import { countTokens } from '../src/tokenizer';

const PROJECT_ROOT = 'test-fixture';

function createMockIndex(): CodeIndex {
  const files: CodeIndex['files'] = {};

  const auth = extractChunks('src/auth.ts', `
export function login() {
  return verifyToken();
}
`);
  const utils = extractChunks('src/utils.ts', `
export function verifyToken() {
  return true;
}
`);
  const app = extractChunks('src/App.tsx', `
export default function App() {
  return <Login onLogin={login} />;
}
`);

  files['src/auth.ts'] = {
    relPath: 'src/auth.ts',
    size: 100,
    mtimeMs: 0,
    hash: 'a',
    chunks: auth,
  };
  files['src/utils.ts'] = {
    relPath: 'src/utils.ts',
    size: 100,
    mtimeMs: 0,
    hash: 'b',
    chunks: utils,
  };
  files['src/App.tsx'] = {
    relPath: 'src/App.tsx',
    size: 100,
    mtimeMs: 0,
    hash: 'c',
    chunks: app,
  };

  // Rebuild inverted index manually for the test
  const terms: CodeIndex['terms'] = {};
  for (const file of Object.values(files)) {
    for (const chunk of file.chunks) {
      const allTerms = new Set([
        ...chunk.content.toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean),
        ...chunk.relPath.toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean),
        ...(chunk.name?.toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean) || []),
      ]);
      for (const term of allTerms) {
        if (!terms[term]) terms[term] = {};
        if (!terms[term][file.relPath]) terms[term][file.relPath] = 0;
        terms[term][file.relPath] += 1;
      }
    }
  }

  return {
    projectPath: '/mock',
    projectHash: 'mock',
    version: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    tree: 'src/\n  auth.ts\n  utils.ts\n  App.tsx',
    constraints: [],
    files,
    terms,
  };
}

describe('retriever', () => {
  it('ranks relevant chunks first for a query', async () => {
    const index = createMockIndex();
    const scored = await scoreChunks(index, 'how does login work', false);
    expect(scored.length).toBeGreaterThan(0);
    const top = scored[0];
    expect(top.relPath).toBe('src/auth.ts');
    expect(top.name).toBe('login');
  });

  it('respects a token budget', async () => {
    const index = createMockIndex();
    const scored = await scoreChunks(index, 'login token', false);
    const { chunks, tokens } = selectChunks(scored, 500);
    expect(chunks.length).toBeGreaterThan(0);
    expect(tokens).toBeLessThanOrEqual(500);
    for (const chunk of chunks) {
      expect(countTokens(chunk.content)).toBeLessThanOrEqual(500);
    }
  });
});
