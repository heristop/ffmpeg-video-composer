import { defineConfig } from 'tsdown';

// External: the core lib (imported from its built dist) + CLI runtime deps + node builtins — never
// bundled, so npm's installer brings them in.
const external = [
  'ffmpeg-video-composer',
  'ffmpeg-video-composer/samples',
  'citty',
  'picocolors',
  'reflect-metadata',
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
  'url',
  'node:url',
  'util',
  'node:util',
];

export default defineConfig([
  // CLI entry — shebang so the `leclap` bin runs directly.
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
]);
