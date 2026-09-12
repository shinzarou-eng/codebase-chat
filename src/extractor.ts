import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import * as t from '@babel/types';
import type { CodeChunk } from './types.js';
import { countTokens } from './tokenizer.js';
import { mergeGaps } from './merge-gaps.js';
import { extractWithTreeSitter, treeSitterReady } from './treesitter.js';

const JS_LIKE = new Set([
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx'
]);

interface BabelNode {
  loc?: { start: { line: number }; end: { line: number } } | null;
}

function getName(node: BabelNode & t.Node): string | undefined {
  if (t.isFunctionDeclaration(node) || t.isClassDeclaration(node) || t.isTSInterfaceDeclaration(node) || t.isTSTypeAliasDeclaration(node)) {
    return node.id?.name;
  }
  if (t.isVariableDeclaration(node)) {
    const first = node.declarations[0];
    if (first && t.isIdentifier(first.id)) return first.id.name;
  }
  if (t.isObjectMethod(node) || t.isClassMethod(node) || t.isClassPrivateMethod(node)) {
    const key = node.key as any;
    if (t.isIdentifier(node.key) || t.isStringLiteral(node.key) || t.isNumericLiteral(node.key)) {
      return String(key.name ?? key.value ?? 'anonymous');
    }
    if (t.isPrivateName(node.key)) {
      return (node.key.id as any)?.name;
    }
  }
  if (t.isExportNamedDeclaration(node) && node.declaration) {
    return getName(node.declaration as t.Node);
  }
  if (t.isExportDefaultDeclaration(node) && node.declaration) {
    if (t.isFunctionDeclaration(node.declaration) || t.isClassDeclaration(node.declaration)) {
      return getName(node.declaration) ?? 'default';
    }
    if (t.isVariableDeclaration(node.declaration)) {
      return getName(node.declaration) ?? 'default';
    }
    return 'default';
  }
  return undefined;
}

function getKind(node: t.Node): CodeChunk['kind'] {
  if (t.isClassMethod(node) || t.isClassPrivateMethod(node) || t.isObjectMethod(node)) return 'method';
  if (t.isFunctionDeclaration(node) || t.isFunctionExpression(node) || t.isArrowFunctionExpression(node)) return 'function';
  if (t.isClassDeclaration(node) || t.isClassExpression(node)) return 'class';
  if (t.isTSInterfaceDeclaration(node) || t.isTSTypeAliasDeclaration(node)) return 'type';
  if (t.isImportDeclaration(node) || t.isExportAllDeclaration(node) || t.isExportNamespaceSpecifier(node)) return 'import';
  if (t.isVariableDeclaration(node)) return 'unknown';
  if (t.isExportNamedDeclaration(node) && node.declaration) return getKind(node.declaration);
  if (t.isExportDefaultDeclaration(node) && node.declaration) return getKind(node.declaration);
  if (t.isExportNamedDeclaration(node) || t.isExportDefaultDeclaration(node)) return 'import';
  return 'unknown';
}

function sliceLines(content: string, start: number, end: number): string {
  const lines = content.split('\n');
  return lines.slice(start - 1, end).join('\n');
}

function extractTopLevelWithBabel(relPath: string, content: string): CodeChunk[] {
  const ast = parse(content, {
    sourceType: 'module',
    allowImportExportEverywhere: true,
    allowReturnOutsideFunction: true,
    plugins: [
      'typescript',
      'jsx',
      'decorators-legacy',
      'classProperties',
      'asyncGenerators',
      'bigInt',
      'dynamicImport',
      'exportDefaultFrom',
      'nullishCoalescingOperator',
      'numericSeparator',
      'objectRestSpread',
      'optionalCatchBinding',
      'optionalChaining',
      'topLevelAwait',
    ] as any,
  });

  const chunks: CodeChunk[] = [];
  const visitedRanges: [number, number][] = [];

  traverse(ast, {
    enter(path) {
      const node = path.node;
      if (
        t.isFunctionDeclaration(node) ||
        t.isClassDeclaration(node) ||
        t.isTSInterfaceDeclaration(node) ||
        t.isTSTypeAliasDeclaration(node) ||
        t.isVariableDeclaration(node) ||
        t.isImportDeclaration(node) ||
        t.isExportNamedDeclaration(node) ||
        t.isExportDefaultDeclaration(node) ||
        t.isExportAllDeclaration(node)
      ) {
        const loc = node.loc;
        if (!loc) return;
        // Avoid duplicate nested traversal: only consider top-level declarations
        if (path.parentPath && !t.isProgram(path.parentPath.node)) return;

        // Class methods
        if (t.isClassDeclaration(node) && node.body?.body) {
          for (const member of node.body.body) {
            if (!member.loc) continue;
            if (t.isClassMethod(member) || t.isClassPrivateMethod(member) || t.isClassProperty(member)) {
              const methodChunk: CodeChunk = {
                relPath,
                startLine: member.loc.start.line,
                endLine: member.loc.end.line,
                content: sliceLines(content, member.loc.start.line, member.loc.end.line),
                tokens: 0,
                kind: getKind(member),
                name: getName(member as t.Node),
              };
              methodChunk.tokens = countTokens(methodChunk.content);
              chunks.push(methodChunk);
            }
          }
        }

        const chunk: CodeChunk = {
          relPath,
          startLine: loc.start.line,
          endLine: loc.end.line,
          content: sliceLines(content, loc.start.line, loc.end.line),
          tokens: 0,
          kind: getKind(node),
          name: getName(node),
        };
        chunk.tokens = countTokens(chunk.content);
        chunks.push(chunk);
        visitedRanges.push([loc.start.line, loc.end.line]);
      }
    },
  });

  return mergeGaps(content, relPath, chunks, visitedRanges);
}

/**
 * Gap-filling between named chunks lives in merge-gaps.ts — it is shared
 * by the Babel and tree-sitter extraction paths.
 */

function extractWithRegex(relPath: string, content: string): CodeChunk[] {
  const lines = content.split('\n');
  const chunks: CodeChunk[] = [];
  let currentStart = 1;
  let currentLines: string[] = [];

  // Simple heuristic: split on blank lines or lines starting with `function`, `class`, `const`, etc.
  const re = /^(export\s+)?(?:async\s+)?(?:function\s+\w+|class\s+\w+|const\s+\w+|let\s+\w+|var\s+\w+|interface\s+\w+|type\s+\w+|def\s+\w+|struct\s+\w+|fn\s+\w+)/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.match(re) && currentLines.length > 0) {
      const chunk: CodeChunk = {
        relPath,
        startLine: currentStart,
        endLine: i,
        content: currentLines.join('\n'),
        tokens: 0,
        kind: 'unknown',
      };
      chunk.tokens = countTokens(chunk.content);
      chunks.push(chunk);
      currentStart = i + 1;
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.length) {
    const chunk: CodeChunk = {
      relPath,
      startLine: currentStart,
      endLine: lines.length,
      content: currentLines.join('\n'),
      tokens: 0,
      kind: 'unknown',
    };
    chunk.tokens = countTokens(chunk.content);
    chunks.push(chunk);
  }

  return chunks.filter(c => c.content.trim());
}

/**
 * Extract semantically meaningful chunks from a source file.
 * Uses Babel for JS/TS, tree-sitter for Python/Go/Rust/Java/C#/PHP
 * (when grammars are loaded via `ensureTreeSitterForExt`), and a
 * regex fallback for everything else.
 */
export function extractChunks(relPath: string, content: string): CodeChunk[] {
  const ext = relPath.slice(relPath.lastIndexOf('.')).toLowerCase();
  if (JS_LIKE.has(ext)) {
    try {
      return extractTopLevelWithBabel(relPath, content);
    } catch {
      // Fall back to regex if Babel fails (e.g. malformed code)
      return extractWithRegex(relPath, content);
    }
  }
  if (treeSitterReady(ext)) {
    try {
      const chunks = extractWithTreeSitter(ext, relPath, content);
      if (chunks && chunks.length) return chunks;
    } catch {
      // fall through to regex
    }
  }
  return extractWithRegex(relPath, content);
}
