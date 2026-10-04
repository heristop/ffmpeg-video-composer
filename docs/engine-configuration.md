# ⚙️ Engine Configuration

Rendering has three configuration layers: the template descriptor, the host's `ProjectConfig`, and, for agent workflows, the MCP server's runtime settings. This reference documents their boundaries and defaults; see [`template-configuration.md`](./template-configuration.md) for the full descriptor vocabulary.

- **Source of truth:** [`packages/ffmpeg-video-composer/src/core/types.d.ts`](../packages/ffmpeg-video-composer/src/core/types.d.ts) (`ProjectConfig`) and [`core/default.config.ts`](../packages/ffmpeg-video-composer/src/core/default.config.ts) (fallback values).
- **Tier tables & encoder args:** [`core/encoding.ts`](../packages/ffmpeg-video-composer/src/core/encoding.ts).
- **MCP flags, environment and defaults:** [`packages/leclap-mcp/src/config.ts`](../packages/leclap-mcp/src/config.ts).

## Choose the configuration layer

| Layer           | Controls                                                                                                                              | Where to set it                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Template JSON   | Scene order, duration, transitions, text, effects, `global.orientation`, `global.fps`, reusable partials and `meta.creativeDirection` | The descriptor passed to `compile`, CLI `render`, or MCP `compose_video` |
| `ProjectConfig` | Media bindings, form values, locale, asset/build directories, codec, quality and native segment concurrency                           | The library API; CLI exposes the media/path/locale bindings listed below |
| MCP runtime     | Media containment, output root, worker deadlines, trusted Remotion entry, browser, operator catalog and effect-cache budget           | Server startup flags or `LECLAP_MCP_*` environment variables             |

MCP flags are not `ProjectConfig` fields. `compose_video` accepts `template`, `fields`, `userVideoPaths`, `locale`, `outputBaseName` and `expectedRevision`; it does not accept arbitrary codec, quality or server configuration. The server maps `mediaDir` to `assetsDir` and allocates a fresh `buildDir` per render.

## `ProjectConfig` surface

All fields are optional in the type. `Project.applyDefault()` merges defaults for codec, hardware, audio, video, and locale. Supply paths appropriate to the platform and bind every required project clip before rendering.

| Field            | Type                                                                           | Default / behavior                                                                                           |
| ---------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `buildDir`       | `string`                                                                       | Host/filesystem output and scratch directory; CLI uses `<cwd>/build`, MCP uses `<outputDir>/<renderId>`      |
| `assetsDir`      | `string`                                                                       | Asset library/staging root; CLI uses `<cwd>/assets`, MCP uses `mediaDir`                                     |
| `music`          | `{ name: string; url?: string }`                                               | Optional host music selection                                                                                |
| `fields`         | `Record<string, string>`                                                       | Form values and template variable bindings                                                                   |
| `userVideoPaths` | `Record<string, string>`                                                       | File paths keyed by effective `project_video` section name, including any partial prefix                     |
| `currentLocale`  | `string`                                                                       | `en`; selects localized copy                                                                                 |
| `qualityTier`    | `'draft' \| 'standard' \| 'high'`                                              | `standard`; encoder-family-specific quality settings                                                         |
| `skipValidation` | `boolean`                                                                      | `false`; trusted Node callers only                                                                           |
| `codecConfig`    | `{ videoCodec?: string; audioCodec?: string }`                                 | Empty codec strings use the engine's encoder fallbacks                                                       |
| `hardwareConfig` | `{ hwaccel?: string \| null; preset?: string; maxRenderConcurrency?: number }` | `hwaccel: null`, `preset: 'ultrafast'`; concurrency depends on the adapter                                   |
| `audioConfig`    | `{ sampleRate?: number; channelLayout?: string }`                              | `44100`, `stereo`                                                                                            |
| `videoConfig`    | `{ orientation?: string; scale?: string; setsar?: string; fps?: number }`      | Landscape base scale `1280:720`, square pixels `1/1`, effective frame rate `30`; descriptor precedence below |

The four config blocks merge per field, so `{ audioConfig: { sampleRate: 48000 } }` keeps the default stereo layout. `videoConfig.orientation` alone does not choose output dimensions: use descriptor `global.orientation`, or CLI `--orientation`.

```ts
import { compile, loadConfig, type ProjectConfig } from 'ffmpeg-video-composer';

const projectConfig: ProjectConfig = {
  buildDir: './build/promo',
  assetsDir: './assets',
  fields: { form_1_title: 'Your next release' },
  userVideoPaths: { demo: './assets/recording.mp4' },
  currentLocale: 'en',
  qualityTier: 'high',
  hardwareConfig: { preset: 'slow', maxRenderConcurrency: 2 },
  audioConfig: { sampleRate: 48000 },
};
const template = await loadConfig('./promo.json');
const outputPath = await compile(projectConfig, template);
```

Replace the example field and section names with those declared by your descriptor or sample requirements. A quality tier does not automatically select its fallback preset after project defaults merge; set `hardwareConfig.preset` explicitly when that matters.

### `qualityTier`

`'draft' | 'standard' | 'high'` — a named render-quality tier resolved by `resolveTier` in `core/encoding.ts`. An unrecognised or unset value (including a bad JSON-sourced string) falls back to `'standard'` via an `isQualityTier` guard, rather than key-missing into the tier tables and producing `-crf undefined`. `'standard'` reproduces the historical hardcoded encoder args byte-for-byte, so existing callers see unchanged output.

Templates never carry crf/preset/bitrate directly — encoder numbers stay an app/host concern, resolved per tier (see [Encoder selection & tiers](#encoder-selection--tiers)).

### `skipValidation`

`boolean` — skips schema validation of the `TemplateDescriptor` before compiling. Trusted-caller opt-out only (e.g. a descriptor already validated upstream); validation is **on by default**. Applies to the **Node `compile()` path only** — the browser (`compileBrowser`) and React Native (`compileReactNative`) paths always validate, regardless of this flag.

### `codecConfig` / `hardwareConfig` / `audioConfig` / `videoConfig`

- `codecConfig: { videoCodec?, audioCodec? }` — explicit encoder override; see [Encoder selection & tiers](#encoder-selection--tiers).
- `hardwareConfig: { hwaccel?, preset?, maxRenderConcurrency? }` — `preset` overrides the resolved tier's libx264 preset; `Project.applyDefault()` supplies `ultrafast` when omitted; `maxRenderConcurrency` controls parallel segment rendering (below).
- `audioConfig: { sampleRate?, channelLayout? }`.
- `videoConfig: { orientation?, scale?, setsar?, fps? }` — `orientation`, `scale`, and `fps` are normally resolved from the descriptor's `global.orientation`/`global.fps` (see [Descriptor-side knobs](#descriptor-side-knobs)) rather than set directly on the host config.

### Orientation → scale, and `fps` precedence

`TemplateDirector.init()` resolves both, once, right after `project.applyDefault()` — before any segment builds — so every segment and the final assembly see the same resolved `videoConfig`:

- **Orientation → scale** (`resolveOrientationScale`): `global.orientation === 'square'` forces the fixed `1080:1080` square preset; `'portrait'` swaps the configured `width:height` scale to `height:width`; `'landscape'` (default, `1280:720`) leaves the scale untouched.
- **`fps` precedence** (`resolveFps`): the descriptor's `global.fps` wins over any host-supplied `videoConfig.fps` whenever the descriptor sets one; every consumer reads `videoConfig.fps ?? 30` (the default).

### `maxRenderConcurrency`

Max segments rendered in parallel, read from `hardwareConfig.maxRenderConcurrency`. Only takes effect on adapters whose FFmpeg backend supports concurrent execute (Node/static child-process backends) — `resolveRenderConcurrency` forces `1` (serial) on every other adapter (WASM, on-device). Default width is `3`, capped by the segment count; set to `1` to force the serial path everywhere.

This is FFmpeg segment concurrency, not Remotion worker concurrency. The MCP registered-effect queue has its own fixed limits, described below.

## CLI configuration

The published [`leclap render`](../packages/leclap-cli/README.md#render-configuration) command maps these flags onto the host configuration:

| Flag                                        | Mapping                                                                    |
| ------------------------------------------- | -------------------------------------------------------------------------- |
| `--assets <dir>`                            | `assetsDir`; relative paths resolve from the working directory             |
| `--build <dir>`                             | `buildDir`; relative paths resolve from the working directory              |
| `--field key=value`                         | `fields`; repeatable, later values replace earlier values for the same key |
| `--video section=path`                      | `userVideoPaths`; repeatable, paths resolve from the working directory     |
| `--locale <code>`                           | `currentLocale`                                                            |
| `--orientation landscape\|portrait\|square` | Overrides descriptor `global.orientation` before compilation               |
| `--output <path>` / `-o`                    | Copies the finished file to this path after a successful render            |

Codec, quality-tier and segment-concurrency overrides use the library API; the CLI has no flags for those fields. `FVC_RENDER_CONCURRENCY` belongs to the monorepo dev compile script, not the published CLI.

## Registered effects and MCP runtime

Effect-specific props, assets and cross-field rules are documented in [effects configuration](./effects-configuration.md).

Native JSON scenes use the selected FFmpeg backend. A `type: "effect"` scene must first be resolved by a trusted renderer. Direct core compilation rejects unresolved effects with `effect_backend_unavailable`, including when `skipValidation` is set. The core's `resolveTemplateEffects` API accepts your renderer and optional preflight callback; it does not import Remotion or configure Chromium.

The MCP registered-effect backend requires Node, optional Remotion peers, and a trusted entry registering every selected composition. Its current output contract is opaque H.264, landscape 1280×720, 30 fps, 300 frames / ten seconds. Other orientation or frame-rate settings are rejected for registered-effect templates; they do not adapt the composition. `render_remotion_clip` is a separate bring-your-own-composition route and does not use this fixed registered-effect contract.

| Setting                      | Startup flag               | Environment variable                | Default                             |
| ---------------------------- | -------------------------- | ----------------------------------- | ----------------------------------- |
| Output root                  | `--output-dir`             | `LECLAP_MCP_OUTPUT_DIR`             | `~/.leclap/renders`                 |
| Media/asset root             | `--media-dir`              | `LECLAP_MCP_MEDIA_DIR`              | `~/.leclap/media`                   |
| Worker/stage timeout         | `--render-timeout-ms`      | `LECLAP_MCP_RENDER_TIMEOUT_MS`      | `600000` ms                         |
| Remotion opt-in              | `--allow-remotion`         | `LECLAP_MCP_ALLOW_REMOTION`         | Off                                 |
| Trusted entry                | `--remotion-entry`         | `LECLAP_MCP_REMOTION_ENTRY`         | Unset                               |
| Chrome executable            | `--remotion-browser`       | `LECLAP_MCP_REMOTION_BROWSER`       | Unset; Remotion manages its browser |
| Operator effect catalog      | `--effect-catalog`         | `LECLAP_MCP_EFFECT_CATALOG`         | Unset; builtin contracts only       |
| Effect artifact cache budget | `--effect-cache-max-bytes` | `LECLAP_MCP_EFFECT_CACHE_MAX_BYTES` | `536870912` bytes (512 MiB)         |

Precedence is flag → environment → default. Paths resolve from the server's working directory; supplied `~` values are not expanded, so use absolute paths. Boolean opt-in accepts a bare flag, `--allow-remotion=true` / `=1`, or environment `true` / `1`; an explicit `=false` / `=0` overrides the environment. Catalogs load once at startup; restart after edits.

Sample discovery (`list_samples`, `get_sample`) and JSON patching remain available with Remotion disabled. `get_effect_schema`, `render_preview` and `render_remotion_clip` are registered only with opt-in. Validating, patching or composing an effect template still requires the configured backend and valid local assets.

### Deadlines, cancellation and cache

An MCP process admits one registered-effect preflight or render job at a time, with at most eight waiters. Queue wait, asset preflight and worker setup/render each have a separate `renderTimeoutMs` deadline; the final FFmpeg worker has its own render deadline. This setting is not an end-to-end request budget. Use a positive timeout within `1..2147483647` ms for the effect queue.

Preflight probes videos sequentially and deduplicates identical real paths within one request. Cancellation or deadline expiry kills an active probe, including binary discovery, and waits for cleanup before releasing the permit. The standalone `probe_media` process also has a fixed 30-second limit. `hardwareConfig.maxRenderConcurrency` does not widen this effect queue.

The persistent cache is `<mediaDir>/.leclap-effects/cache-v1`, limited to the byte budget and 256 entries. Zero disables lookup/publication; invalid cache-budget values fall back to 512 MiB. Cache lookup follows fresh asset staging, source bundling and browser identification; it saves effect rendering, not all preparation or final FFmpeg work. Changing source/dependencies, props, assets, contract or browser identity invalidates reuse. The output root needs write access, and caching needs write access under the media root; cache I/O failures fall back to rendering.

Use the [MCP setup](../packages/leclap-mcp/README.md#configuration) and [registered-effect example](../examples/llm-remotion-title/README.md#custom-product-reveal) for executable startup commands.

## Browser and on-device hosts

Browser and native callers use the same `ProjectConfig`, with platform filesystem paths. Browser compilation accepts `BrowserCompileOptions.loadFFmpegCore` as its fourth argument, read during initial platform setup, for hosts serving their own WASM core. This option is separate from project/video configuration.

The Expo host injects a `NativeEngine` into `compileReactNative`, stages media locally, and selects AAC plus `libopenh264` on Android or `h264_videotoolbox` on iOS. Both WASM and the native engine render segments serially. Their compile paths always validate descriptors; neither executes registered React effects locally. See [on-device configuration](./on-device-compilation.md#host-configuration) and [runtime filter capabilities](./runtime-capabilities.md) for codec/filter limits.

Reproducibility requires preserving the descriptor, media, fonts, bindings, resolved host configuration, trusted effect source/contracts, dependencies and runtime versions. A JSON revision guards edits; provenance and cache identity help track inputs, but do not provide a strict replay lock or guarantee identical bytes across platforms.

## Descriptor-side knobs

Two `global` fields on the template descriptor resolve onto `ProjectConfig.videoConfig` at construct time (see above):

| Field                | Type                                    | Effect                                                                                                               |
| -------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `global.orientation` | `'landscape' \| 'portrait' \| 'square'` | Resolves the output scale (landscape `1280:720` / portrait `720:1280` / square `1080:1080`).                         |
| `global.fps`         | `number`                                | Output frame rate for every re-encode pass (segments + final assembly); wins over a host-supplied `videoConfig.fps`. |

## Environment variables

Read via `process.env`; these are optional host, asset, and bench/debug controls. Boolean escape hatches (`FVC_HWENCODE`, `FVC_DISABLE_FUSION`, `FVC_DISABLE_CONCAT_FOLD`, and the welcome flag) test for a non-empty string, so `'0'` also enables them; unset them to disable. `FVC_PERF` specifically treats `'0'` as disabled.

| Variable                       | What it does                                                                                                                                                                                                                                                                                                                                                                                                          | Default                                                               | Read at                                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `FVC_HWENCODE`                 | Opt-in auto-select of a hardware H.264 encoder (`h264_videotoolbox` / `h264_mediacodec`) when no explicit `codecConfig.videoCodec` is set. Off by default — benchmarks showed it's slower than libx264 `ultrafast` on short multi-segment renders and only marginally faster on heavy single encodes (see `docs/perf-findings.md`). **Node `compile()` path only** — never touches the browser or React Native paths. | unset (off)                                                           | `index.ts` — `autoSelectHardwareEncoder`                                                            |
| `FVC_DISABLE_FUSION`           | Forces the two-pass overlay path (a separate xfade assembly, then a standalone overlay pass) instead of fusing whole-video `global.animations` / `global.watermark` into the xfade re-encode. Bench/debug A/B escape hatch.                                                                                                                                                                                           | unset (fusion on)                                                     | `editor/VideoEditor.ts` — `stageOverlaysForFusion` / `overlayAnimations`                            |
| `FVC_DISABLE_CONCAT_FOLD`      | Forces the standard two-pass finalize (a separate concat-copy pass, then the music/normalize pass) instead of folding the concat-copy into the following audio pass (music mix or normalization must actually run). Bench/debug escape hatch.                                                                                                                                                                         | unset (fold on)                                                       | `director/TemplateDirector.ts`, consumed by `director/finalize-concat-fold.ts` — `shouldFoldConcat` |
| `FVC_PERF`                     | Enables the process-wide perf timer (spans for director/segment/ffmpeg/editor stages). Any truthy value except `'0'` turns it on; absent when `process` doesn't exist (browser).                                                                                                                                                                                                                                      | unset (disabled)                                                      | `utils/perf-timer.ts` — `createPerfTimer`                                                           |
| `FVC_PERF_OUT`                 | Pins an exact file path for the per-run perf-report JSON — lets a bench harness avoid path collisions across fixtures that share `meta.name`. When unset, the report is written to `${buildDir}/perf-${name}.json`.                                                                                                                                                                                                   | unset (derived path)                                                  | `index.ts` — `emitPerfReport`                                                                       |
| `FVC_RENDER_CONCURRENCY`       | Sets `hardwareConfig.maxRenderConcurrency` from a number in the monorepo dev compile script. Use positive integer widths; `1` forces serial rendering. Does not apply to the library API or published `leclap render` command.                                                                                                                                                                                        | unset (adapter default)                                               | `compile.ts` — `buildProjectConfig`                                                                 |
| `FVC_ASSET_BASE_URL`           | Overrides the public catalog library base URL for fallback downloads of fonts, music, and relative catalog media. Local staged assets are preferred. Trailing slashes are removed.                                                                                                                                                                                                                                    | LeClap GitHub `raw/main/packages/leclap-creative-kit/src/library` URL | `core/asset-source.ts` — `assetBaseUrl`                                                             |
| `LECLAP_LOG_LEVEL`             | Sets the Node Pino logger level (e.g. `silent`).                                                                                                                                                                                                                                                                                                                                                                      | `info`                                                                | `platform/logging/PinoLogAdapter.ts` — `resolveLogLevel`                                            |
| `FVC_FONT_CACHE_DIR`           | Directory of the persistent font cache: faces resolved by family (`{ family, weight?, style? }`) and catalog fonts are copied there, outside the build dir, so a repeat render needs no network. Written best-effort and atomically; an unwritable directory only costs the re-download. **Node only** (Expo and the browser keep no persistent cache).                                                               | `~/.cache/leclap/fonts`                                               | `platform/filesystem/FilesystemNodeAdapter.ts` — `fontCacheDir`                                     |
| `FFMPEG_COMPOSER_SKIP_WELCOME` | Suppresses the CLI's startup banner. The banner is already skipped in CI or a non-TTY terminal regardless of this flag.                                                                                                                                                                                                                                                                                               | unset (banner shown when TTY and not CI)                              | `compile.ts` / `src/main.ts` — `shouldShowWelcome`                                                  |

## Encoder selection & tiers

**Shared encoder selection order** (`resolveVideoCodec` / `buildVideoEncoderArgs`):

1. Explicit `codecConfig.videoCodec` — wins in shared encoder resolution and prevents hardware auto-selection.
2. `FVC_HWENCODE=1` (Node only) — probes the ffmpeg build's available encoders and auto-selects a platform hardware encoder if one is exposed.
3. `h264` — the default when neither above applies (the default `ProjectConfig` sets `videoCodec` to `''`, and any falsy value falls through to `h264`).

**Tier tables** — `resolveTier` reads `qualityTier` (falling back to `'standard'` for anything unrecognised), then `buildVideoEncoderArgs` picks the table for the resolved codec family:

| Codec family                                         | Args shape                                                              | draft                | standard            | high              |
| ---------------------------------------------------- | ----------------------------------------------------------------------- | -------------------- | ------------------- | ----------------- |
| Software (`h264`/libx264-style — server/web default) | `-crf … -tune film -b:v … -profile:v high -preset …`                    | crf 30, veryfast, 6M | crf 23, medium, 12M | crf 18, slow, 16M |
| Hardware (`*_mediacodec` / `*_videotoolbox`)         | `-c:v … -b:v …` (no libx264-only flags)                                 | 4M                   | 8M                  | 12M               |
| `libopenh264` (on-device LGPL software encoder)      | `-c:v libopenh264 -b:v …` (Constrained Baseline only — no `-profile:v`) | 2M                   | 4M                  | 6M                |
| `mpeg4` (on-device LGPL fallback)                    | `-c:v mpeg4 -q:v …` (qscale — lower is better)                          | 8                    | 4                   | 2                 |

`hardwareConfig.preset` overrides the software tier's preset. In a normal compile, `Project.applyDefault()` fills an omitted preset with `DefaultConfig.PRESET` (`ultrafast`), so changing `qualityTier` changes CRF/bitrate but retains `ultrafast` unless the host supplies another preset. The table shows tier fallback presets used by the encoding helper when no preset is present.

Software `VideoSegment` branches select `h264` on Node and `libx264` in the browser; explicit software codec overrides are not consumed by those branches. Hardware, `libopenh264`, and `mpeg4` selections route through the shared helper.

The **browser WASM `VideoSegment`** path uses fixed `-c:v libx264 … -preset ultrafast`, taking only `crf` from the resolved software tier. Other segment types and final transition/overlay passes use the shared encoding helper; this fixed-preset exception does not describe every browser re-encode.
