import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { defineConfig, type UserConfig } from 'tsdown';
import replace from '@rollup/plugin-replace';

// Satori imports `harfbuzzjs`, whose entry fetches `hb.wasm` next to the page the moment it loads; in the
// browser build and the phone's WebView page it resolves to the shim that waits for the bytes the host's
// loader brought instead.
const HARFBUZZ_SHAPER = fileURLToPath(new URL('src/platform/html/harfbuzz-shaper.ts', import.meta.url));

// Ahead of tsdown's own resolution, which would keep `harfbuzzjs` external as one of the engine's dependencies.
const harfbuzzShaper = {
  name: 'harfbuzz-shaper',
  resolveId: {
    order: 'pre' as const,
    handler(source: string): string | null {
      return source === 'harfbuzzjs' ? HARFBUZZ_SHAPER : null;
    },
  },
};

type Plugin = Extract<NonNullable<UserConfig['plugins']>, { name: string }>;

const requireModule = createRequire(import.meta.url);

function wasmBase64(specifier: string): string {
  return readFileSync(requireModule.resolve(specifier)).toString('base64');
}

// The phone's HTML layer page (src/html-raster-webview.ts) as one self-contained HTML file: the script and
// the WebAssembly it draws with inlined, so the app ships a single asset and the WebView loads nothing.
function htmlRasterPage(): Plugin {
  return {
    name: 'leclap-html-raster-page',
    generateBundle(_options, bundle) {
      const entry = Object.values(bundle).find((output) => output.type === 'chunk' && output.isEntry);

      if (entry?.type !== 'chunk') return;

      const wasm = {
        resvg: wasmBase64('@resvg/resvg-wasm/index_bg.wasm'),
        subset: wasmBase64('harfbuzzjs/hb-subset.wasm'),
        shape: wasmBase64('harfbuzzjs/hb.wasm'),
      };
      // `</script` would end the inline script early.
      const code = entry.code.replaceAll('</script', String.raw`<\/script`);

      delete bundle[entry.fileName];
      this.emitFile({
        type: 'asset',
        fileName: 'html-rasteriser.html',
        source:
          '<!doctype html><html><head><meta charset="utf-8"><title>LeClap HTML layers</title></head><body>' +
          `<script>window.__LECLAP_RASTER_WASM__=${JSON.stringify(wasm)}</script><script>${code}</script></body></html>`,
      });
    },
  };
}

export default defineConfig([
  // Sample discovery is a separate data-only entry, never imported by the renderer entries.
  {
    entry: { samples: 'src/samples.ts' },
    format: ['esm', 'cjs'],
    outExtensions: ({ format }) => ({ js: format === 'cjs' ? '.cjs' : '.js' }),
    dts: true,
    sourcemap: true,
    outDir: 'dist',
    target: 'es2024',
    platform: 'neutral',
    deps: { dts: { neverBundle: ['zod'] } },
  },
  // Node.js build
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    // tsdown >=0.20 emits .mjs/.cjs by default when both formats are present; keep the
    // ESM entry as index.js so the package's module/exports fields resolve.
    outExtensions: ({ format }) => ({ js: format === 'cjs' ? '.cjs' : '.js' }),
    dts: true,
    sourcemap: true,
    clean: true,
    outDir: 'dist',
    target: 'es2024',
    platform: 'node',
    deps: {
      onlyBundle: false,
      neverBundle: [
        'child_process',
        'fs',
        'path',
        'os',
        'util',
        'events',
        'node:events',
        'stream',
        'crypto',
        'readline',
        'tty',
        'pino',
        'ffmpeg-static',
      ],
    },
  },
  // Browser build - excludes Node.js-specific modules
  {
    entry: ['src/browser.ts'],
    format: ['esm'],
    outExtensions: () => ({ js: '.js' }),
    dts: true,
    sourcemap: true,
    outDir: 'dist',
    target: 'es2024',
    platform: 'browser',
    globalName: 'FFmpegVideoComposer',
    // The JSDoc of the sources ships in the .d.ts (and the sourcemaps point at the sources); repeated in the
    // JS it only adds to what a page downloads before its first compile (tests/build-output.test.ts budget).
    // Legal and annotation (`@__PURE__`) comments stay.
    outputOptions: { comments: { legal: true, annotation: true, jsdoc: false } },
    deps: {
      onlyBundle: false,
      neverBundle: [
        // Keep these as external for browser bundlers to handle
        '@ffmpeg/ffmpeg',
        '@ffmpeg/util',
        // Exclude all Node.js-specific modules from browser build
        'child_process',
        'fs',
        'fs/promises',
        'path',
        'os',
        'util',
        'events',
        'stream',
        'crypto',
        'readline',
        'tty',
        'pino',
        'ffmpeg-static',
        'zlib',
        'yauzl',
        'fd-slicer',
        'get-stream',
        // zod is a runtime dependency resolved by the host's bundler, like tslib: the app and the engine
        // share one copy (one schema registry, no second ~150 KB zod in the page) instead of the engine
        // inlining its own into the eager chunk.
        'zod',
      ],
      alwaysBundle: [
        // Only include browser-compatible dependencies
        'reflect-metadata',
        'tsyringe',
        'picocolors',
        // HTML layers: bundled (into the lazy rasteriser chunk) so its HarfBuzz import meets the shim.
        'satori',
      ],
      // zod's declarations stay external too: rolldown-plugin-dts can't bundle zod v4's CommonJS .d.cts
      // locale files (a wall of warnings), and consumers have zod installed as a runtime dependency.
      dts: { neverBundle: ['zod'] },
    },
    plugins: [
      harfbuzzShaper,
      replace({
        preventAssignment: true,
        // Leading boundary excludes a preceding word char, `$`, `.` or `/` so the bare `global`
        // identifier is rewritten but module specifiers / properties (e.g. `./global.schemas`,
        // `foo.global`) are left intact. A plain `\b` treats `.`/`/` as boundaries and would mangle
        // the path `./global.schemas` into `./globalThis.schemas`.
        delimiters: [String.raw`(?<![\w$./])`, String.raw`\b`],
        // Only rewrite `global` in the JS bundle. Without this exclude the same
        // substitution mangles reflect-metadata's inlined `declare global {` into the
        // invalid `declare globalThis {` in the generated .d.ts, breaking tsc consumers.
        exclude: ['**/*.d.ts'],
        values: {
          'process.env.NODE_ENV': JSON.stringify('production'),
          'process.env.PLATFORM': JSON.stringify('browser'),
          global: 'globalThis',
        },
      }),
    ],
  },
  // React-Native build — ships PRE-COMPILED JS so Hermes never sees the core's tsyringe decorators
  // (Metro/Babel won't transform a symlinked workspace package's decorators; pre-building avoids the
  // problem entirely). Decorators are compiled by tsdown (experimentalDecorators + emitDecoratorMetadata);
  // reflect-metadata stays external (the app imports it once at its entry).
  {
    entry: ['src/reactnative.ts'],
    format: ['esm'],
    outExtensions: () => ({ js: '.js' }),
    dts: true,
    sourcemap: true,
    outDir: 'dist',
    target: 'es2024',
    platform: 'neutral',
    inputOptions: {
      resolve: {
        // `neutral` ignores the `main` field, but tsyringe ships CJS (main only) and is in
        // `alwaysBundle` below — without this rolldown can't resolve it, so it externalizes
        // tsyringe (the RN output must inline it so Hermes never transforms its decorators).
        mainFields: ['module', 'browser', 'main'],
      },
    },
    deps: {
      onlyBundle: false,
      neverBundle: [
        'expo-file-system',
        'expo-file-system/legacy',
        'reflect-metadata',
        // tsyringe is bundled (Hermes must not transform its decorators), but its tslib helper
        // calls (__extends/__decorate/__metadata) must NOT be inlined: rolldown pulls tslib's CJS
        // UMD build, whose `exports`/`define.amd` interop yields `undefined` helpers under Hermes
        // ("Cannot read property '__extends' of undefined"). Kept external so Metro/Babel resolve
        // and transform tslib correctly. Metro finds it via the core package's own dependency.
        'tslib',
        'child_process',
        'fs',
        'fs/promises',
        'path',
        'os',
        'util',
        'events',
        'stream',
        'crypto',
        'pino',
        'ffmpeg-static',
        '@ffmpeg/ffmpeg',
        '@ffmpeg/util',
      ],
      alwaysBundle: ['tsyringe', 'zod'],
      // Bundle zod's JS but keep it external in the .d.ts (the browser build keeps it external instead) so
      // rolldown-plugin-dts doesn't try to bundle zod v4's CommonJS .d.cts locales.
      dts: { neverBundle: ['zod'] },
    },
  },
  // The phone's HTML layer page: a hidden WebView runs it (htmlRasterPage above writes the HTML file).
  {
    name: 'html-raster-page',
    clean: false,
    entry: { 'html-raster-webview': 'src/html-raster-webview.ts' },
    format: ['iife'],
    outExtensions: () => ({ js: '.js' }),
    dts: false,
    sourcemap: false,
    minify: true,
    outDir: 'dist',
    // The oldest WebViews the app supports (docs/on-device-compilation.md#html-layers): syntax is lowered for
    // them, and src/html-raster-webview/compat.ts adds the built-ins its dependencies call that they lack.
    target: ['chrome87', 'safari16.4'],
    platform: 'browser',
    inputOptions: {
      // Satori's harfbuzzjs resolves to the shared shim (harfbuzzShaper, as in the browser build), which the
      // page hands the inlined bytes. `fs` is only read on hb.js's Node branch, and Satori's `import.meta` only
      // by Yoga's script lookup (its WebAssembly is inline): neither exists in the page.
      resolve: { alias: { fs: false } },
      transform: { define: { 'import.meta': '{}' } },
    },
    deps: { alwaysBundle: [/.*/] },
    plugins: [harfbuzzShaper, htmlRasterPage()],
  },
]);
