import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type Parser from 'web-tree-sitter';
import type { CodeChunk } from './types.js';
import { countTokens } from './tokenizer.js';
import { mergeGaps } from './merge-gaps.js';

const require = createRequire(import.meta.url);

/** File extension → tree-sitter-wasms grammar name. */
const GRAMMAR_BY_EXT: Record<string, string> = {
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.cs': 'c_sharp',
  '.php': 'php',
};

/** node type → chunk kind, per grammar. */
const DECL_TYPES: Record<string, Record<string, CodeChunk['kind']>> = {
  python: {
    function_definition: 'function',
    class_definition: 'class',
  },
  go: {
    function_declaration: 'function',
    method_declaration: 'method',
    type_declaration: 'type',
    import_declaration: 'import',
    const_declaration: 'unknown',
    var_declaration: 'unknown',
  },
  rust: {
    function_item: 'function',
    struct_item: 'type',
    enum_item: 'type',
    union_item: 'type',
    trait_item: 'type',
    type_item: 'type',
    impl_item: 'type',
    mod_item: 'unknown',
    use_declaration: 'import',
    macro_definition: 'unknown',
  },
  java: {
    class_declaration: 'class',
    interface_declaration: 'type',
    enum_declaration: 'type',
    record_declaration: 'type',
    annotation_type_declaration: 'type',
    method_declaration: 'method',
    constructor_declaration: 'method',
    field_declaration: 'unknown',
    import_declaration: 'import',
    package_declaration: 'import',
  },
  c_sharp: {
    class_declaration: 'class',
    interface_declaration: 'type',
    struct_declaration: 'type',
    enum_declaration: 'type',
    record_declaration: 'type',
    delegate_declaration: 'type',
    method_declaration: 'method',
    constructor_declaration: 'method',
    property_declaration: 'method',
    field_declaration: 'unknown',
    using_directive: 'import',
  },
  php: {
    function_definition: 'function',
    class_declaration: 'class',
    interface_declaration: 'type',
    trait_declaration: 'type',
    enum_declaration: 'type',
    method_declaration: 'method',
    namespace_use_declaration: 'import',
    namespace_definition: 'unknown',
  },
};

/** Node types whose named children may contain more declarations. */
const RECURSE_INTO = new Set([
  'program', 'module', 'translation_unit', 'compilation_unit', 'source_file',
  'namespace_declaration', 'file_scoped_namespace_declaration', 'namespace_definition',
  'declaration_list', 'decorated_definition', 'export_statement',
]);

/** Node types that act as member containers (methods/functions inside). */
const CONTAINER_TYPES = new Set([
  'class_definition', 'class_declaration', 'interface_declaration',
  'enum_declaration', 'record_declaration', 'struct_declaration',
  'impl_item', 'trait_item', 'trait_declaration',
]);

/** Member node types emitted as 'method' chunks inside containers. */
const MEMBER_TYPES = new Set([
  'function_definition', 'method_declaration', 'method_definition',
  'function_item', 'constructor_declaration', 'property_declaration',
]);

/** Identifier-ish node types used as a name fallback. */
const NAME_TYPES = new Set([
  'identifier', 'type_identifier', 'field_identifier', 'simple_type', 'name',
]);

type TreeSitterModule = typeof Parser & { default?: typeof Parser };

let parser: Parser | null = null;
let initPromise: Promise<boolean> | null = null;
const languages = new Map<string, Parser.Language | null>();
const langPromises = new Map<string, Promise<Parser.Language | null>>();

/** Initialize the WASM runtime once. Returns false when unavailable. */
export async function initTreeSitter(): Promise<boolean> {
  if (parser) return true;
  initPromise ??= (async () => {
    try {
      const mod = (await import('web-tree-sitter')) as unknown as TreeSitterModule;
      const ParserClass = mod.default ?? mod;
      // The .wasm lives next to the installed package, not next to dist/.
      const wasm = require.resolve('web-tree-sitter/tree-sitter.wasm');
      await ParserClass.init({ locateFile: () => wasm });
      parser = new ParserClass();
      return true;
    } catch {
      return false;
    }
  })();
  return initPromise;
}

function grammarPath(name: string): string {
  const pkg = require.resolve('tree-sitter-wasms/package.json');
  return join(dirname(pkg), 'out', `tree-sitter-${name}.wasm`);
}

async function ensureLanguage(name: string): Promise<Parser.Language | null> {
  if (languages.has(name)) return languages.get(name)!;
  let p = langPromises.get(name);
  if (!p) {
    p = (async () => {
      try {
        const mod = (await import('web-tree-sitter')) as unknown as TreeSitterModule;
        const ParserClass = mod.default ?? mod;
        const lang = await ParserClass.Language.load(grammarPath(name));
        languages.set(name, lang);
        return lang;
      } catch {
        languages.set(name, null);
        return null;
      }
    })();
    langPromises.set(name, p);
  }
  return p;
}

/**
 * Make sure the grammar for `ext` is loaded (if the extension is supported).
 * Safe to call per file - repeated calls are cached.
 */
export async function ensureTreeSitterForExt(ext: string): Promise<boolean> {
  const name = GRAMMAR_BY_EXT[ext.toLowerCase()];
  if (!name) return false;
  if (!(await initTreeSitter())) return false;
  return (await ensureLanguage(name)) != null;
}

/** Release the WASM parser - call before process exit to avoid libuv asserts. */
export function disposeTreeSitter(): void {
  try { parser?.delete(); } catch { /* best effort */ }
  parser = null;
  initPromise = null;
  languages.clear();
  langPromises.clear();
}

/** True when a grammar is loaded and ready for synchronous extraction. */
export function treeSitterReady(ext: string): boolean {
  const name = GRAMMAR_BY_EXT[ext.toLowerCase()];
  return !!name && !!parser && languages.get(name) != null;
}

function nodeName(node: Parser.SyntaxNode): string | undefined {
  const named = node.childForFieldName('name');
  if (named) return named.text;
  for (const child of node.namedChildren) {
    if (NAME_TYPES.has(child.type)) return child.text;
    // Go: type_declaration → type_spec (name field)
    const inner = child.childForFieldName('name');
    if (inner) return inner.text;
  }
  return undefined;
}

function toChunk(node: Parser.SyntaxNode, kind: CodeChunk['kind'], relPath: string, content: string, name?: string): CodeChunk {
  const startLine = node.startPosition.row + 1;
  const endLine = node.endPosition.row + 1;
  const text = content.split('\n').slice(startLine - 1, endLine).join('\n');
  return { relPath, startLine, endLine, content: text, tokens: countTokens(text), kind, name };
}

/**
 * Extract declaration chunks with tree-sitter. Only call when
 * `treeSitterReady(ext)` is true; returns undefined on parse failure.
 */
export function extractWithTreeSitter(ext: string, relPath: string, content: string): CodeChunk[] | undefined {
  if (!parser || !treeSitterReady(ext)) return undefined;
  const name = GRAMMAR_BY_EXT[ext.toLowerCase()]!;
  const lang = languages.get(name)!;
  const declTypes = DECL_TYPES[name] ?? {};

  let tree: Parser.Tree;
  try {
    parser.setLanguage(lang);
    tree = parser.parse(content);
  } catch {
    return undefined;
  }
  if (!tree) return undefined;

  try {
    const chunks: CodeChunk[] = [];
    const visitedRanges: [number, number][] = [];

    const handle = (child: Parser.SyntaxNode) => {
      const kind = declTypes[child.type];
      if (kind) {
        // Python decorators: widen the range to include decorator lines.
        const target = child.parent?.type === 'decorated_definition' ? child.parent : child;
        chunks.push(toChunk(target, kind, relPath, content, nodeName(child)));
        visitedRanges.push([target.startPosition.row + 1, target.endPosition.row + 1]);

        // Members of class-like containers become their own 'method' chunks.
        if (CONTAINER_TYPES.has(child.type)) {
          const body = child.childForFieldName('body') ?? child;
          for (const member of body.namedChildren) {
            if (MEMBER_TYPES.has(member.type)) {
              chunks.push(toChunk(member, 'method', relPath, content, nodeName(member)));
            } else if (declTypes[member.type]) {
              // Nested decls (e.g. enum inside class) - keep them too.
              handle(member);
            }
          }
        }
        return;
      }
      if (RECURSE_INTO.has(child.type) || child.namedChildren.some((c) => declTypes[c.type] || RECURSE_INTO.has(c.type))) {
        visit(child);
      }
    };

    const visit = (node: Parser.SyntaxNode) => {
      for (const child of node.namedChildren) handle(child);
    };
    visit(tree.rootNode);

    return mergeGaps(content, relPath, chunks, visitedRanges);
  } finally {
    tree.delete();
  }
}


