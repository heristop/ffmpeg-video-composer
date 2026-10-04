# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.5.0] - 2026-10-03

### Added

- Versioned JSON `effect` sections with validated props and asset slots. The exported
  `resolveTemplateEffects` API runs optional preflight checks, renders effects through a host-supplied
  backend, and lowers them to ordinary `project_video` clips with bindings and provenance. The core
  does not execute React or require Remotion; resolve effect sections before calling a compile entry.
- The `ffmpeg-video-composer/samples` entry point exports `listSamples` and `getSample`, with 32
  showcase descriptors, creative direction, required clips/form fields, assets and setup requirements.
  It supports ESM and CommonJS without loading the renderer. Media and effect implementations are
  supplied separately.
- `meta.creativeDirection` records the intended audience, visual hierarchy, pacing and motion in the
  descriptor and survives schema validation.
- Configurable entrance/exit easing (`linear`, `ease-out`, `ease-in-out`, `ease-out-back`) and title-card
  line `stagger`. Back easing allows position overshoot while keeping alpha within 0..1. Omitted
  settings preserve existing animation timing.
- `{ "type": "scale", "value": "output" }` preserves aspect ratio and pads a custom scene to the
  configured output dimensions with square pixels.

### Fixed

- Unresolved effects, including those inside active nested partials, fail before platform setup or
  composition instead of reaching an unsupported segment path.
- Geometry checks use the configured title-card stagger, including empty-line handling.
- Sample asset requirements include effective font files introduced by text presets.

## [2.4.0] - 2026-09-28

### Added

- `CompileReporter.onError(error)`: called with the cause when `compile()` resolves `null`, so a
  host can report why a render failed instead of a generic "no output": the error that stopped
  the director (a failed section, an FFmpeg command it rejected, a segment it could not probe) or
  the validation error `compile()` caught itself. A failure the director reported as a bare
  string arrives as that string, not JSON-quoted.
- **`compileBrowser` takes a `loadFFmpegCore` option,** for a host that serves the ffmpeg.wasm
  core itself rather than having every visitor fetch it from unpkg (the LeClap web app now
  self-hosts it, which also keeps rendering available offline). `FFmpegWasmAdapter` takes the
  same loader as its second constructor argument, and `FFMPEG_CORE_VERSION` names the
  `@ffmpeg/core` version to serve. Without the option nothing changes: that pinned version,
  0.12.10, still comes from unpkg.
- **Any Google Fonts family, by name.** A text `font` now also accepts
  `{ family, weight?, style? }` (e.g. `{ "family": "Playfair Display", "weight": 700,
"style": "italic" }`), resolved from Google Fonts at render time. `weight` is 100..900 in steps
  of 100 (default 400), `style` is `normal` or `italic`. Registry ids and `.ttf` filenames keep
  working unchanged, and a typo in a registry id is still a validation error rather than a network
  lookup. A family that does not exist fails the render with an error naming it — a missing font is
  never silently swapped for another face.
- **A persistent font cache (Node).** Faces resolved by family, and catalog fonts, are copied to
  `~/.cache/leclap/fonts` (override with `FVC_FONT_CACHE_DIR`), so a repeat render of the same font
  needs no network. Entries are written atomically; an unwritable directory only costs the
  re-download.
- `isFontRef`, `FontRef` and `FontInput` are exported from every entry point, and `FontRefSchema` /
  `FontInputSchema` from the Node entry.
- `TemplateValidator.getGeometryWarnings()` catches templates that are valid but visually broken,
  before anything renders. It lowers each section through the renderer's own text and box filters
  (captions, title cards, lower thirds and their badges, global text overlays, authored
  `drawtext`/`drawbox`) and reports text that runs off the frame or out of the title-safe area,
  collides with other text on screen at the same time, is drawn under a band or panel that paints
  over it, is too small to read on a phone, has too little contrast against what it sits on, or sits
  over footage or an image with no box, outline or shadow. Each finding says what to change.
  Findings are advisory: they never enter `errors` and never change `success`. At most 20 are
  returned, worst first; when more exist, the last one says how many were left out.
- Widths come from the real fonts. The Node entry exports `createBundledFontLoader` (bundled fonts
  first, then the LeClap asset catalog the renderer uses, 5s timeout per font) and
  `nodeGeometryWarnings` / `geometryApproxNote`, plus the `GeometryWarning` and `FontLoader` types.
  A finding drawn from an estimate says why: `(approx: font unavailable, width estimated)`,
  `(approx: {{ variable }} length unknown until render)` or `(approx: section duration assumed)`.
- `renderedGeometryWarnings()` (Node entry) measures text contrast from rendered pixels, on request.
  The render-free check never sees a pixel: text over a picture, under a grade or a look is only
  flagged for lacking a box, outline or shadow. This renders the sections that hold text twice — the
  second time with every glyph recoloured, so the glyphs are exactly the pixels that change — reads
  one frame per piece of text where it rests, and scores it against the pixels around it (lower
  quartile, WCAG ratio). It reports `text_low_contrast_rendered` below 3:1, and over a fixed
  backdrop (colour card, picture) it replaces the render-free contrast and over-footage findings
  for that text. It costs seconds and needs a native FFmpeg with `drawtext`; without one, or when
  the render fails, it returns the render-free findings and says why in `unavailable`. The FFmpeg it
  would render with is asked for its filter list first (once per binary), so a build without
  libfreetype is named, with what to install, instead of failing every section mid-render.

### Changed

- **`AbstractMusic.process` returns the track to mix.** It resolves `{ rc, musicPath }`: the
  track it was handed when that already covers the video, else a looped copy in the build
  directory. It no longer writes the loop over its input, so a custom `AbstractMusic` must now
  return `musicPath`; the bundled Node, browser and device adapters do.
- The browser/WASM backend cannot request a TrueType face from Google, so it now rejects a template
  that names a font by family up front, before any section is encoded, with an error listing where.
  Ship the fonts you need, or use a bundled font id or a `.ttf` filename.

### Fixed

- In the browser, a segment FFmpeg fails to write no longer passes for a fresh render. ffmpeg.wasm's
  in-memory filesystem outlives a render, so an output an earlier render left at the same path
  counted as this command's output: a failed segment "succeeded", and a clip FFmpeg couldn't read
  rendered as the previous render's clip. `FFmpegWasmAdapter` now deletes a command's output path
  before running it, unless the command also reads that path.
- A section that fails to build now fails the whole compile. The build error (an asset or font
  that can't be resolved, for instance) used to be logged and swallowed: the section rendered
  nothing, the concat skipped it, and `compile()` resolved `output.mp4` without that section.
  `compile()` now resolves `null` on the first failing section, the browser and React Native
  entries reject, and the cause is a `SectionError` whose message names the section —
  `Section "outro" failed: <cause>`. A segment whose render exits non-zero or leaves no output
  file fails the compile the same way instead of being dropped from the concat.
- Looping a background track shorter than the video no longer rewrites that track. The loop is
  written to the build directory and mixed from there. Earlier versions replaced the track in
  place — in the CLI's `assets/musics`, the MCP media library, the package's bundled tracks, or a
  device's staged copy — with a longer MP4/AAC file still named `.mp3`, so later renders no longer
  looped it. Tracks already rewritten are not repaired.
- After a failed compile in a long-lived process (e.g. `leclap render --watch`), a compile with
  music enabled but no track resolved no longer mixes the failed compile's track.
- A background track shorter than the video now loops whatever its container. The Node loop
  joined copies of the file byte for byte, which only loops a bare MP3 stream: an MP4 container
  named `.mp3` (`pop.mp3`, `point-being.mp3` and `future-bass-energy.mp3` in the bundled library,
  or a track an earlier version rewrote in place) played once and then fell silent, and an MP3
  with embedded cover art (`air-prelude.mp3`, `anxiety.mp3`, `arcadia.mp3`) failed the render,
  on device too. Both loops now repeat the track's demuxed audio alone.
- A failed FFmpeg command on Node (system FFmpeg or `ffmpeg-static`) now reports the lines
  FFmpeg failed on, instead of its whole stderr: ten lines of version banner, then a dump of
  every input and of the stream mapping, ahead of the line naming the problem. Both adapters
  run FFmpeg at `-loglevel error` and keep the last 20 lines of what it prints.
- Bundled fonts now resolve from a built `dist/` (the CLI, the MCP server, any installed consumer),
  not only when running from source.
- A bundled asset name carrying a path separator or a leading dot is no longer resolved, so a
  descriptor font such as `../../etc/passwd.ttf` cannot read a file outside the library.

## [2.3.0] - 2026-08-16

### Changed

- **`FFmpegLeclapAdapter` is renamed to `FFmpegDeviceAdapter`.** The adapter drives any
  injected `NativeEngine` and imports no app or Expo code, so the old name named the wrong
  thing; its siblings (`FFmpegNodeAdapter`, `FFmpegWasmAdapter`, `FFmpegStaticAdapter`) are
  named for how they run. Code importing `FFmpegLeclapAdapter` from
  `ffmpeg-video-composer/reactnative` must import `FFmpegDeviceAdapter` instead — no alias is
  kept. Behaviour and the `NativeEngine` interface are unchanged, so
  `createReactNativeContainer` consumers need no edit.

## [2.2.1] - 2026-08-15

### Fixed

- Partial `codecConfig` / `hardwareConfig` / `audioConfig` / `videoConfig` blocks now merge
  over the defaults instead of replacing them wholesale — a partial `audioConfig` used to
  drop `channelLayout` and fail every blank-audio section with an invalid
  `anullsrc=channel_layout=:` argument.
- `compile()` now fails when the music-mix or overlay finalize pass errors, instead of
  resolving success with a missing or half-built `output.mp4`.
- Probing a stream that carries no duration (e.g. WebM/MKV browser captures) yields `null`
  instead of `NaN`, so the declared `options.duration` fallback applies instead of the
  render aborting with "No section info found".
- Music display names with spaces or quotes no longer break the mix: staged music filenames
  are slugged, and music paths are argv-guarded before command assembly.
- `@name` map references are matched escaped, end-anchored, and longest-first — an input
  named `logo` can no longer corrupt `@logo2`, and names carrying regex metacharacters
  resolve literally instead of misfiring.
- Animated `drawtext` with numeric `x`/`y` anchors at the authored position instead of the
  frame origin, and `end={{ section_duration }}` in a filter `range` resolves to the section
  duration instead of emitting an always-false `between(t,…,NaN)` enable.

## [2.2.0] - 2026-07-27

### Added

- Effects pack: film grain and cinemascope letterbox, stylized look presets, shake and
  pulse motion effects, and section-level audio effect presets.
- `global.watermark` — a global image watermark from an upload or a URL, with explicit
  still-image handling and URL validation.
- Named render-quality tiers, with tier-aware video segment selection.
- `global.fps` on the descriptor: optional, default 30, so frame rate is a creative
  choice rather than a hardcoded engine constant.
- A generated runtime capability matrix plus a device filter capability set. Filters a
  given FFmpeg build cannot provide are now dropped (or approximated) with a warning
  instead of failing silently — closing the LGPL/on-device gap.
- Descriptor validation on the Node `compile()` path, with a `skipValidation` opt-out on
  `ProjectConfig` for callers that have already validated upstream.
- Music cross-fade is decoupled from the video transition, so the audio curve no longer
  has to match the cut.
- Gradient shapes and angles, overlay flip and easing, layer borders, and global
  animation motion.
- Entrance options for shapes and layers, accent-bar reveal sync, and transition
  duration bounds.
- Rounded panel assets.

### Changed

- **`compile()` now validates by default on the Node path.** A malformed descriptor
  fails fast with a structured summary instead of failing late inside the engine or
  rendering something wrong. Descriptors that previously compiled despite schema errors
  will now throw; pass `skipValidation: true` to restore the old behaviour.
- fps and scale defaults are centralised rather than scattered across the builder and
  the editor.
- Editor utility modules are grouped under `editor/utils`, and remaining util modules
  are renamed to kebab-case.
- Effects and section schemas are split into `effects-visual` and `section-media`.
- Library packages use function-declaration style throughout.

### Fixed

- Build state is now fully reset between compiles, so back-to-back compiles in a
  long-lived process (browser / on-device) stay independent — a leftover `videoInputs`
  entry no longer makes the next compile probe a prior build's segment.
- The music timeline uses rendered durations and hardens leg state, and stays aligned
  with transition overlaps instead of drifting against them.
- Still images loop correctly in whole-video overlays.
- Letterbox and grain edge guards.
- Segments are built from a section copy, so compiling the same descriptor twice yields
  identical commands.
- `drawbox` is centred using `iw` rather than the box width.
- Gradients freeze at minimum speed under wasm.
- Sugar is preserved in overlay graphs.

## [2.1.1] - 2026-06-29

### Added

- `TemplateValidator` (plus `ValidationResult` / `ValidationError` types) is now
  exported from the entry, so consumers can validate a descriptor without compiling.

## [2.1.0] - 2026-06-29

### Added

- `compile()` accepts an optional `CompileReporter` (`onProgress(fraction)` +
  `onLog(line)`) for live compilation progress and forwarded engine logs; the
  Node and browser entries share the same listener wiring.
- Partial-expansion mechanism and font registry now ship in the engine
  (`findFont`, `expandPartials`/`expandPartialsSafe`, exported from the entry),
  with a `TemplatePartialSchema` and an optional `partials` field on the root
  descriptor schema. Partials travel with the descriptor (`descriptor.partials`).
- Asset-source helpers (`assetBaseUrl`/`fontAssetUrl`/`musicAssetUrl`/
  `catalogAssetUrl`) resolving catalog media to the public repository.

### Changed

- Fonts and music are no longer bundled in the package — `dist/fonts` and
  `dist/musics` (~106 MB) are gone, dropping the install size to ~1 MB. Catalog
  fonts (by registry id), tracks referenced by name, and catalog media
  (`videos/…`, `pictures/…`) are fetched on demand from the public LeClap
  repository; the base URL is overridable via `FVC_ASSET_BASE_URL`. Standard font
  families still fall back to Google Fonts, and an explicit music `url` is used
  as-is.
- The package no longer depends on the private `@leclap/creative-kit`; a catalog
  supplies its shared partials by merging them into `descriptor.partials` before
  compiling.

### Fixed

- Generated type declarations: the `TextEffect` type is no longer emitted as a
  dangling `TextEffect$1` alias, so `dist/index.d.ts` typechecks cleanly for
  consumers (previously `error TS2552`).

### Removed

- Dropped unused `boxen`, `cli-spinners`, `figlet`, `gradient-string`, and
  `pino-pretty` dependencies (CLI cosmetics that moved to `@leclap/cli`).

## [2.0.0] - 2026-06-27

Stable release of the 2.0.0 line (consolidates the `2.0.0-beta.*` prereleases).

Upgrading from v1? See the [migration guide](MIGRATION.md). The npm package name
is **unchanged** (`ffmpeg-video-composer`); the `le-clap`→`leclap` rename was
internal to the monorepo and does not affect consumers.

### Added

- Multi-platform package entries: a `react-native` entry
  (`ffmpeg-video-composer/reactnative`) and a dedicated `browser` entry alongside
  the default Node entry, with native engine adapters and codec-aware segment
  rendering backed by a shared command parser.
- On-device FFmpeg engine with in-flight run cancellation (an `AbortSignal`
  cancels the native run), an iOS `xcframework` build, Android 16 KB page
  alignment, and a build-from-source orchestrator
  (`scripts/ffmpeg/build-engine.sh`) with tracked engine crate and FFmpeg
  toolchain sources.
- `TemplateDescriptorSchema` exported from the package entry for consumers that
  want to validate templates with the library's own Zod schema.
- Effect sugar: `text` (reveal / title-card / lower-third), `lut3d` colour looks,
  `chromaKey`, and `overlayMotion` effects, backed by compiler registries and
  global descriptor decorations; animated text can exit as well as reveal.
- Overlay system: overlay animations in the core engine with bundled overlay
  assets in the creative kit.
- Descriptor schema: `captureMode` / `allowedCaptureModes` (camera / screen /
  upload) on project-video sections.
- Performance: parallel segment rendering, automatic hardware H.264 encoder
  selection (VideoToolbox / MediaCodec) when available, and a perf-timer plus
  bench harness instrumenting the compile pipeline.
- bt709 colour metadata on re-encoded output, and validation that flags unknown
  caption and overlay fonts.
- Creative kit: refreshed bundled template catalog and an expanded music
  library, with tutorial / launch and square-promo templates and a flash-card
  partial.
- `CONTRIBUTING.md`, `SECURITY.md`, and GitHub issue/PR templates.

### Changed

- **Breaking:** `engines.node` now requires Node `>=24.11.0` (was `>=22.14.0`).
- **Breaking:** the CLI is no longer bundled in the core package — it ships
  separately as `@leclap/cli`.
- **Breaking:** package layout reworked for publishing — the standalone
  `compile.js` / `diagnose.js` scripts are no longer shipped (use `@leclap/cli`),
  and the `./src/index` export was dropped (the `.`, `./browser`, and
  `./reactnative` entries remain). `prepack` builds `dist`.
- **Behavior:** FFmpeg is now invoked via `execFile` (no shell), and template
  string values used as ffmpeg argv tokens (color / url / section values) reject
  embedded whitespace and NUL — a template whose value contains a raw space now
  throws instead of silently injecting extra ffmpeg arguments.
- **Behavior:** server-side remote media fetches now enforce an SSRF guard —
  private/reserved/metadata IPs are rejected, redirects are re-validated per hop,
  and non-http(s) schemes are refused.
- Performance: cut redundant finalize re-encode passes by folding single-segment
  concat and fusing the xfade + animation-overlay graphs into one pass.
- Completed the cutover to the native engine, replacing the `ffmpeg-expo` plugin
  with an NDK config plugin and removing orphaned `ffmpegArgs`.
- Configurable log level via `LECLAP_LOG_LEVEL`.
- Refreshed documentation: on-device engine references and the on-device
  compilation architecture doc.

### Fixed

- Surface the real FFmpeg error from the WASM log stream instead of the benign
  trailing `Aborted()`.
- Add silent audio to video-only clips so transitions don't abort, and cap xfade
  transition duration to prevent short-clip collapse.
- Fall back to the declared duration when ffprobe can't read a clip.
- Make the perf-timer browser-safe, derive WASM compile progress from elapsed
  time, and drop ineffective dynamic imports in the Node entry.
- Panic-safe (RAII) file-descriptor restore in engine output capture.
- Guard the postinstall build so the published package installs cleanly.

## [1.0.0] - 2025-10-11

### Added

- Custom error types with detailed FFmpeg logs.
- `dependency-cruiser` for module-graph checks.

### Changed

- Migrated the build from tsup to tsdown for faster builds.
- Improved formatter speed management (#9).
- Reworked CLI error handling and process exit codes, and removed direct
  console logging from the director's error handling.
- Upgraded dependencies; added funding metadata.

## [0.3.0] - 2025-02-19

### Changed

- Dropped the bundled `ffmpeg-static` dependency.
- Applied the stone theme to the sample template.
- Documentation: added a Mermaid architecture graph and refreshed the feature
  list.

## [0.2.0] - 2024-09-07

### Changed

- Updated template asset URLs and the bundled sample.
- Updated dependencies.

## [0.1.1] - 2024-05-03

### Changed

- Maintenance release.

## [0.1.0] - 2024-05-01

### Added

- Initial release: an FFmpeg video composer with a director/compilation
  pipeline and a sample template.
- Custom output path on compilation.
