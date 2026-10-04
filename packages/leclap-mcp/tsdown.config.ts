import { defineConfig } from 'tsdown';

// External: real runtime deps + node builtins — never bundled. The worker imports the
// already-compiled core dist; the SDK and reflect-metadata stay node_modules deps.
const external = [
  'ffmpeg-video-composer',
  'ffmpeg-video-composer/samples',
  '@modelcontextprotocol/server',
  '@modelcontextprotocol/server/stdio',
  '@modelcontextprotocol/core',
  'reflect-metadata',
  // Optional peer deps for render_remotion_clip — dynamically imported, never bundled.
  '@remotion/bundler',
  '@remotion/renderer',
  // Probed (not depended on) by remotion-webpack-override to detect TypeScript 7's dropped config
  // API. Kept external so the compiler never lands inside dist; a failed import means "no TypeScript
  // here", which is exactly the answer the probe wants.
  'typescript',
  'child_process',
  'node:child_process',
  'fs',
  'node:fs',
  'fs/promises',
  'node:fs/promises',
  'path',
  'node:path',
  'os',
  'node:os',
  'util',
  'node:util',
  'events',
  'node:events',
  'stream',
  'node:stream',
];

export default defineConfig([
  // CLI entry — stdio MCP server. Shebang so `leclap-mcp` runs directly.
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    outExtensions: () => ({ js: '.js' }),
    dts: false,
    sourcemap: true,
    clean: true,
    outDir: 'dist',
    target: 'es2024',
    platform: 'node',
    banner: { js: '#!/usr/bin/env node' },
    deps: { onlyBundle: false, neverBundle: external },
  },
  // Forked render worker — emitted as dist/render-worker.js (owns fd1/fd2; runs compile()).
  {
    entry: { 'render-worker': 'src/worker/renderWorker.ts', 'effect-worker': 'src/worker/effectWorker.ts' },
    format: ['esm'],
    outExtensions: () => ({ js: '.js' }),
    dts: false,
    sourcemap: true,
    outDir: 'dist',
    target: 'es2024',
    platform: 'node',
    deps: { onlyBundle: false, neverBundle: external },
  },
]);
