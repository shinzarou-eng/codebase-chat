import { describe, it, expect, beforeAll } from 'vitest';
import { initTreeSitter, ensureTreeSitterForExt, treeSitterReady } from '../src/treesitter.js';
import { extractChunks } from '../src/extractor.js';

beforeAll(async () => {
  await initTreeSitter();
}, 30_000);

describe('tree-sitter runtime', () => {
  it('initializes and loads grammars lazily', async () => {
    expect(await ensureTreeSitterForExt('.py')).toBe(true);
    expect(treeSitterReady('.py')).toBe(true);
    expect(await ensureTreeSitterForExt('.txt')).toBe(false);
    expect(treeSitterReady('.txt')).toBe(false);
  });
});

describe('extractChunks with tree-sitter', () => {
  it('parses Python functions, classes and decorated defs', async () => {
    await ensureTreeSitterForExt('.py');
    const chunks = extractChunks('app/main.py', `import os

CONSTANT = 42

@decorator
def helper(a, b):
    return a + b

class Service:
    def run(self):
        return helper(1, 2)

    def stop(self):
        pass
`);
    const byKind = (k: string) => chunks.filter(c => c.kind === k);
    expect(byKind('function').map(c => c.name)).toContain('helper');
    expect(byKind('class').map(c => c.name)).toContain('Service');
    expect(byKind('method').map(c => c.name)).toEqual(expect.arrayContaining(['run', 'stop']));
    // Decorator line included in the function chunk
    const helper = chunks.find(c => c.name === 'helper');
    expect(helper!.content).toContain('@decorator');
    // Header lines kept via gap chunks
    expect(chunks.some(c => c.kind === 'file' && c.content.includes('CONSTANT'))).toBe(true);
  });

  it('parses Go functions, methods and types', async () => {
    await ensureTreeSitterForExt('.go');
    const chunks = extractChunks('pkg/svc.go', `package svc

import "fmt"

type Server struct{ port int }

func NewServer() *Server {
    return &Server{}
}

func (s *Server) Start() {
    fmt.Println("up")
}
`);
    const names = chunks.map(c => `${c.kind}:${c.name}`);
    expect(names).toContain('function:NewServer');
    expect(names).toContain('method:Start');
    expect(names).toContain('type:Server');
  });

  it('parses Rust fns, impls and structs', async () => {
    await ensureTreeSitterForExt('.rs');
    const chunks = extractChunks('src/lib.rs', `use std::fmt;

pub struct Point { x: i32, y: i32 }

impl Point {
    pub fn new(x: i32, y: i32) -> Self { Self { x, y } }
    pub fn norm(&self) -> f64 { 0.0 }
}

pub fn origin() -> Point { Point::new(0, 0) }
`);
    const names = chunks.map(c => `${c.kind}:${c.name}`);
    expect(names).toContain('type:Point');
    expect(names).toContain('function:origin');
    expect(chunks.filter(c => c.kind === 'method').map(c => c.name)).toEqual(
      expect.arrayContaining(['new', 'norm'])
    );
  });

  it('parses Java classes, methods and fields', async () => {
    await ensureTreeSitterForExt('.java');
    const chunks = extractChunks('src/App.java', `package demo;

import java.util.List;

public class App {
    private int count;

    public static void main(String[] args) {
        System.out.println("hi");
    }
}
`);
    const names = chunks.map(c => `${c.kind}:${c.name}`);
    expect(names).toContain('class:App');
    expect(names).toContain('method:main');
    expect(chunks.some(c => c.kind === 'import')).toBe(true);
  });

  it('parses C# classes and methods', async () => {
    await ensureTreeSitterForExt('.cs');
    const chunks = extractChunks('Program.cs', `using System;

namespace Demo {
    public class Greeter {
        public string Name { get; set; }

        public void Hello() {
            Console.WriteLine(Name);
        }
    }
}
`);
    const names = chunks.map(c => `${c.kind}:${c.name}`);
    expect(names).toContain('class:Greeter');
    expect(names).toContain('method:Hello');
    expect(chunks.some(c => c.kind === 'import')).toBe(true);
  });

  it('parses PHP functions and classes', async () => {
    await ensureTreeSitterForExt('.php');
    const chunks = extractChunks('src/Util.php', `<?php
namespace App;

function greet($name) {
    return "hi " . $name;
}

class Helper {
    public function work() {
        return greet("x");
    }
}
`);
    const names = chunks.map(c => `${c.kind}:${c.name}`);
    expect(names).toContain('function:greet');
    expect(names).toContain('class:Helper');
    expect(chunks.filter(c => c.kind === 'method').map(c => c.name)).toContain('work');
  });

  it('keeps regex fallback for unsupported extensions', () => {
    const chunks = extractChunks('notes.md', `# Title\n\nSome text\n\n## Section\n\nMore\n`);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every(c => c.kind === 'unknown' || c.kind === 'file')).toBe(true);
  });
});
