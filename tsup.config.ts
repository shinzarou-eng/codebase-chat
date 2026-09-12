import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node20',
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: true,
  outDir: 'dist',
  // Optional native dep — resolved at runtime only when the local LLM is used.
  external: ['node-llama-cpp'],
});
