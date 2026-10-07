# ffmpeg-video-composer

**One JSON spec renders on Node, in the browser via WebAssembly, and fully on-device on React Native — no upload, no server required.**

Template-driven video composition over FFmpeg. A single JSON _template_ describes a video's structure — sections, filters, music, text overlays — and the library renders it into a finished video. The same engine runs in Node.js, in the browser (WebAssembly), and in React Native.

> Upgrading from v2 or v1? See the [migration guide](https://github.com/heristop/leclap/blob/HEAD/packages/ffmpeg-video-composer/MIGRATION.md): v3 validates templates more strictly and renders different bytes.

## Install

```bash
pnpm add ffmpeg-video-composer                            # uses your system FFmpeg
pnpm add ffmpeg-video-composer ffmpeg-static              # static binary fallback
pnpm add ffmpeg-video-composer @ffmpeg/ffmpeg @ffmpeg/util  # browser (WASM)
```

## Quick start

```javascript
import { compile, loadConfig } from 'ffmpeg-video-composer';

const projectConfig = {
  buildDir: './build',
  assetsDir: './assets',
  currentLocale: 'en',
  fields: { form_1_firstname: 'Firstname', form_1_lastname: 'Lastname' },
};

const template = await loadConfig('./my-template.json');
const result = await compile(projectConfig, template);
```

`compile()` resolves `null` when a render fails. To learn why, pass a reporter as the third argument: its
`onError(error)` receives the error that stopped the render, once, before `compile()` resolves.

## Host configuration

`ProjectConfig` supplies paths, `fields`, `userVideoPaths`, `currentLocale`, `qualityTier`, and
codec/hardware/audio/video blocks. These blocks merge per field with defaults. Set output orientation
in `template.global.orientation`; `global.fps` overrides host `videoConfig.fps`. Default landscape
output is 1280×720 at 30 fps; portrait swaps the base dimensions and square forces 1080×1080.

Use `hardwareConfig.preset` explicitly when selecting an encoder preset: the default remains
`ultrafast` even when quality tier changes. `hardwareConfig.maxRenderConcurrency` defaults to three
segments on Node/static and is forced to one on WASM/native. The [engine configuration reference](https://github.com/heristop/leclap/blob/main/docs/engine-configuration.md)
lists all fields, defaults, environment variables and platform exceptions.

Registered JSON effects require resolution before any core compile entry. Use `resolveTemplateEffects`
with a trusted renderer/preflight callback, then compile its returned descriptor with its
`userVideoPaths` merged into your project bindings. The core does not launch Remotion. The optional
[MCP registered-effect backend](../leclap-mcp/README.md#configuration) configures its entry, browser,
catalog, deadlines and cache separately, and currently renders fixed ten-second landscape effects.

Prefer the command line? Use [`@leclap/cli`](https://github.com/heristop/leclap/tree/main/packages/leclap-cli):

```bash
npx @leclap/cli init my-video             # scaffold a starter project
npx @leclap/cli render my-template.json   # compile a template
npx @leclap/cli diagnose                  # check your FFmpeg setup
```

## Entry points

| Import                              | Target       | Notes                                           |
| ----------------------------------- | ------------ | ----------------------------------------------- |
| `ffmpeg-video-composer`             | Node.js      | ESM + CJS, system/static FFmpeg                 |
| `ffmpeg-video-composer/browser`     | Browser      | WASM via `@ffmpeg/ffmpeg` (install it yourself) |
| `ffmpeg-video-composer/reactnative` | React Native | Pre-compiled JS; expects `expo-file-system`     |

## FFmpeg detection order

The Node entry detects FFmpeg in this order:

1. **System FFmpeg** — your installed binary (fastest, recommended for production).
2. **Static FFmpeg** — bundled binary via the optional `ffmpeg-static` package. It ships `ffmpeg` only.
   Templates that probe media (transitions, music, whole-video overlays, `project_video` clips) also
   need an `ffprobe`, either from the optional `ffprobe-static` package or next to the `ffmpeg-static`
   binary. Without one they stop before rendering, with an error that names the missing binary.
3. **None** — a clear error message with installation guidance. WASM is not a pure-Node fallback.

Browser hosts import `/browser` and register WASM directly; inputs and intermediate copies consume
WASM memory, so the approximate 2 GB input ceiling is not a supported project-size guarantee.
React Native hosts import `/reactnative` and inject their on-device engine. Registered React effects
run on the configured Node backend; browser/native composition can consume the resulting clips.

Run `npx @leclap/cli diagnose` to see what your environment provides.

## Templates

Templates are Zod-validated JSON descriptors: global options (size, music, locale) plus an ordered list of sections, each with `inputs → maps → filters`. See the [template configuration reference](https://github.com/heristop/leclap/blob/main/docs/template-configuration.md) and the ready-made catalog — templates, partials, and bundled fonts — in [`@leclap/creative-kit`](https://github.com/heristop/leclap/tree/main/packages/leclap-creative-kit).

## License

MIT.

This package does **not** bundle FFmpeg. It drives an FFmpeg you provide: your system binary, the optional `ffmpeg-static` package, or `@ffmpeg/ffmpeg` (WASM) in the browser — each under its own license.

The optional on-device mobile engine (Android/iOS) lives in the monorepo, not in this package, and statically links an LGPLv3 FFmpeg built from source — see the [on-device compilation docs](https://github.com/heristop/leclap/blob/main/docs/on-device-compilation.md).

## Packaged showcase samples

Import the separate lightweight catalog entry point to discover the 32 showcase descriptors without
loading the renderer, reading repository files or downloading media:

```ts
import { listSamples, getSample } from 'ffmpeg-video-composer/samples';

const matches = listSamples({ category: 'app-demos', backend: 'native', query: 'screen' });
const sample = getSample('web-app-promo');
// Inspect sample.requirements, supply your clips/copy/assets, then validate sample.template and compile.
```

`listSamples` returns metadata without templates; `getSample` adds self-contained `template` JSON with
referenced partials embedded. Results are independent copies. Invalid filters and unknown IDs throw
clear errors. Preview media is not shipped; authored asset references must be supplied or replaced.
Requirements include effective text-preset fonts (`source: 'preset'`), clips, fields, defaults and setup.
Registered Remotion effects require the configured MCP Node backend and trusted catalogs where indicated.
The registry stays separate from main browser/native bundles. CommonJS can use
`require('ffmpeg-video-composer/samples')`. See the [CLI](../leclap-cli/README.md) and
[MCP](../leclap-mcp/README.md) discovery workflows.
