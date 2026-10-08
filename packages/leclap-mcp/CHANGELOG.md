# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Removed

- Breaking: seven tools are gone, merged into others or dropped, because every tool's name and
  description is sent to the agent on every turn and overlapping tools dilute its choice. No aliases;
  call the replacement:

  | Removed                     | Call instead                                                            |
  | --------------------------- | ----------------------------------------------------------------------- |
  | `ping`                      | the MCP protocol `ping` request                                         |
  | `report_catalog_gap`        | nothing: `get_motion_catalog { query }` logs a query that matches none  |
  | `get_resolved_template`     | `validate_template { template, include: ["resolved"], fields, format }` |
  | `get_timeline`              | `validate_template { template, include: ["timeline"], format }`         |
  | `patch_template { edits }`  | `edit_template { template, expectedRevision, effectProps: edits }`      |
  | `list_samples { …filters }` | `get_samples { …filters }`                                              |
  | `get_sample { id }`         | `get_samples { id }`                                                    |

  Fourteen tools are now always registered (seventeen with the Remotion opt-in).

### Changed

- `validate_template` takes `include: ["resolved" | "timeline"]`, plus `fields` and `format` for them:
  `resolved` is `{ descriptor, values }` as `get_resolved_template` returned it (a refused field value is
  still an error), `timeline` is what `get_timeline` returned. Without `include`, validation is unchanged.
- `edit_template` takes `effectProps` (`[{ section, props }]`, the former `patch_template` edits), applied
  after the JSON Patch `operations` in the same revision-guarded, all-or-nothing batch and checked by the
  effect backend; it returns `changedSections`. `operations` is optional when `effectProps` is given.
- `get_samples` replaces `list_samples` and `get_sample`: without `id` it lists, with `id` it returns the
  sample and its template.
- `get_motion_catalog` appends a query that matches nothing to the catalog gap log
  (`--catalog-gap-log` / `LECLAP_MCP_CATALOG_GAP_LOG`, still confined to the output dir); its `gap` no
  longer points at another tool.

### Added

- HTML layers (`inputs[].type: "html"`): `compose_video` and `render_frames` draw a card, badge or price
  tag laid out in HTML and CSS and composite it like an image; its images must be template assets under the
  media dir. `validate_template` reports `html_unsupported_css`, `html_unsupported_markup`,
  `html_font_unknown`, `html_missing_field` and a measured `html_overflow`, and fails on `html_too_large`.
  `get_template_schema` documents the input and `get_motion_catalog` lists the CSS subset and four layout
  recipes under `html`.

- `analyze_sound`: renders an `sfx[].sound` (composed layers, or a library preset varied by pitch, length,
  brightness and room) with the engine synth and returns its length, peak and RMS dBFS, raw
  pre-normalisation peak, spectral centroid, energy above 8 kHz / under 250 Hz, attack time and the sound
  advisories it raises, plus a spectrogram and a waveform PNG. An optional `cue` path
  (`sections.intro.sfx[0]`) seeds the render exactly like the mix; a silent sound reports −120 dB and
  `sound_silent`. Seventeen tools are now always registered.

- Typed template fields: `get_resolved_template` returns the descriptor `compose_video` would render for
  the given `fields` (declared `global.fields` filled with typed values) or every value it would refuse;
  `compose_video` and `render_frames` take `fields` as strings, numbers or booleans and refuse a missing
  required or ill-typed value before rendering; `validate_template` lists the declared contract as `fields`
  and reports `field_undefined`, `field_unused`, `field_type_mismatch` and `field_missing_required`.
- `open_in_builder`: returns a `https://leclap.dev/studio/builder#t=v1.…` link that opens the template in
  the web builder for a person to edit, with `mediaToRebind` (local paths and uploads the browser cannot
  read) and `warnings`. The template travels compressed in the URL fragment, which browsers never send to a
  server; `baseUrl` targets a locale prefix or a local dev server, with a warning off `https://leclap.dev`.
  Nineteen tools are now always registered.
- `transcribe_media`: transcribe a local audio/video file's speech with whisper.cpp on the host → words, SRT,
  language, mean confidence and the "pin, then review" advice. `compose_video` resolves `subtitles.transcribe`
  before rendering. The model is never downloaded by the tool: the operator opts in once
  (`leclap transcribe --download-model` or `LECLAP_WHISPER_DOWNLOAD=1`). Twenty tools are now always registered.
- `edit_template`: an RFC 6902 JSON Patch over inline template JSON under `expectedRevision` (stale →
  `revision_conflict`), all-or-nothing and validated after applying; returns the template, its new
  `revision` and `changedPaths`. The web builder's WebMCP tools share the name, operations and revision,
  along with `get_template_schema`, `get_motion_catalog`, `list_samples`, `get_sample`, `validate_template`,
  `get_timeline` and `render_frames`. Sixteen tools are now always registered.
- `list_samples` accepts `category: "effects"`; 46 packaged samples.
- `compose_video` runs the engine's output QC and returns it in `structuredContent.qc` with a one-line
  verdict.
- `get_motion_catalog` returns the engine's motion catalog: kinetic typography presets with
  defaults, exits, stagger orders, the easing grammar, built-in tokens, art-direction rules and a starter.
  `get_template_schema` and the `compose-video` prompt point agents at it.
- `compose_video` renders with the deterministic encoder profile.
- `validate_template` returns every finding with its hint (`structuredContent.errors` with `hint`,
  `suggestion`, `kind`) and advisory `motionWarnings`; failing section assertions are validation errors.
- `get_motion_catalog` also returns genre doctrine, scene blueprints, per-preset verbs and guidance,
  built-in themes, delivery platforms and the time-reference grammar; the registry manifest lists it.
- `get_template_schema` describes `global.platform`; the `compose-video` prompt adds motion pacing rules.
- New always-registered tools: `extract_style` (theme and style guide from a reference under the media
  dir), `analyze_music` (beat grid and cues), `get_capabilities` (local FFmpeg capability report),
  `render_frames` (PNG frames, contact sheets, safe zones, variant and look grids), `get_timeline` and
  `report_catalog_gap`.
- `get_motion_catalog` accepts `{ query, kind? }` and returns ranked matches, with a pointer to
  `report_catalog_gap` when nothing matches; `--catalog-gap-log` / `LECLAP_MCP_CATALOG_GAP_LOG` sets the log.
- `compose_video`, `render_frames` and `get_timeline` accept `format`; the template is resolved to that
  format before validation, the sandbox guard and the render.
- `validate_template` adds `featureWarnings` from the local capability probe and reports
  `partial_compressed`; `get_sample` adds a `partialCatalog` summary.
- `probe_media` reports `hdr`, `colorPrimaries`, `colorTransfer`, `bitDepth`, `vfr` and `rotation`.
- The `get_template_schema` guide covers formats, footage editing, subtitles, voice/automation/sfx, music
  timing, motion roles and section purpose, trails, the new graphics, whips, lower-third styles, fills,
  layouts, right-to-left text and emoji.
- `get_motion_catalog` lists the `type: "fx"` primitives (parameters, defaults, design intent, reduced
  motion) under `fx`, and the library APNGs under `samples` with the primitives that replace them; `kind:
"fx"` searches them. `get_template_schema` and the `compose-video` prompt steer agents to compose motion
  from these primitives, tuned to the brief, and `validate_template` returns the sameness lint
  (`fx_untuned`, `effect_repeated`, `library_animation_sample`, `effect_off_theme`, `decor_overload`).

### Changed

- Template revisions (`expectedRevision` / `revision`) and the validation finding text now come from the
  engine (`templateRevision`, `invalidTemplateText`), so other surfaces compute the same revision for the
  same JSON; values are unchanged.
- Built on `ffmpeg-video-composer` 3: `validate_template`, `edit_template` and `compose_video` reject
  templates with unknown keys (`unknown_key`) and text a bundled font cannot draw (`font_missing_glyphs`),
  which 0.4.0 accepted.

## [0.4.0] - 2026-10-03

### Added

- Always-available `list_samples` and `get_sample` tools expose all 32 packaged showcase descriptors,
  creative direction and required inputs without executing effects or downloading media.
- Always-available `patch_template` edits descriptors with revision checks. Opt-in `get_effect_schema`
  and `render_preview` tools let agents discover strict versioned effect contracts and inspect selected
  frames or a frame range before composition. Built-in contracts include `leclap.title-reveal@1.0.0` and
  `leclap.web-app-promo@1.0.0`.
- Operator effect catalogs register custom IDs/versions, prop defaults and bounds, asset slots,
  compositions and output contracts with `--effect-catalog` / `LECLAP_MCP_EFFECT_CATALOG`.
- `compose_video` preflights and resolves registered effects through the operator's trusted Remotion
  entry before FFmpeg composition. Remotion execution remains disabled by default; enable it with
  `--allow-remotion`, install the optional Remotion peers, and configure the trusted entry/browser.
- Registered-effect artifacts use a bounded persistent cache (512 MiB by default; configurable with
  `--effect-cache-max-bytes` / `LECLAP_MCP_EFFECT_CACHE_MAX_BYTES`, zero disables it). Rendering runs
  in bounded workers with timeouts and cancellation; cache identity includes source, contracts,
  assets and runtime information.

### Changed

- Requires `ffmpeg-video-composer` 2.5.0 or later. Registry metadata and the authoring guide describe
  sample discovery, custom effects and the new engine configuration.
- Package tarballs include this changelog.

### Fixed

- Effect preflight rejects incompatible catalogs, props, assets and output contracts before rendering.
- Descriptor patching rejects unsafe keys and preserves named clip bindings when editing partials.
- Asset policies confine effect inputs to regular files within the configured media root and isolate
  staged files for each render. Catalog defaults and file reads are bounded.

## [0.3.5] - 2026-09-28

### Added

- `render_remotion_clip` now reports render progress on stderr. Remotion's per-frame callback is
  throttled to the same 2% step `compose_video` uses, so a long clip render prints roughly fifty
  `[render_remotion_clip] render <id> <n>%` lines instead of one per frame — a render that used to
  look hung now shows it is moving. Non-finite progress values are dropped rather than logged, so a
  missing figure can neither print `NaN%` nor disable the throttle for the rest of the render.
  stdout is untouched: it stays the JSON-RPC framing channel, and the tool's result payload is
  unchanged.
- `validate_template` returns geometry findings on a new optional `geometry` field, one line each:
  text off the frame or out of the title-safe area, colliding, hidden under a band, too small,
  low-contrast, or unguarded over footage. They are advisory and never change `valid`. A finding
  drawn from an estimate carries an `(approx: …)` note saying why.
- `validate_template` accepts `render: true` to also render the sections that hold text and
  measure their contrast from real pixels. A new optional `render` field reports how many texts
  were measured and how long it took, or why nothing was rendered; the render-free findings are
  returned either way and `valid` never changes. The check runs in the same forked render worker
  as `compose_video`, under the same timeout and cancellation, so a render that hangs or crashes
  takes down the worker rather than the server — and a timeout degrades to the render-free
  findings instead of an error.

### Fixed

- `compose_video` no longer returns a successful result for a video missing a section. When a
  section fails to build, the tool returns `isError` with the engine's cause, naming the section
  (`Section "outro" failed: …`), instead of a bare "compilation failed". Requires
  `ffmpeg-video-composer` 2.4.0.
- Any other render that fails inside the engine — an FFmpeg command it rejects, a segment it
  cannot probe — also leads the `compose_video` error with the engine's reason instead of
  "compilation failed"; the worker's log tail still follows it.

## [0.3.4] - 2026-08-24

### Changed

- The MCP registry name moves from `dev.leclap/mcp` to `dev.leclap/video`. The registry's
  `search` parameter matches the server **name** only — descriptions are not indexed, so
  `dev.leclap/mcp` was unreachable from the one query with real intent behind it. The domain
  proof already covers the whole `dev.leclap/*` namespace, so no DNS change is involved.

## [0.3.3] - 2026-08-24

### Changed

- The MCP registry name moves from `io.github.heristop/leclap` to `dev.leclap/mcp`, matching
  the project's own domain rather than a personal GitHub handle. `mcpName` is validated from
  the published tarball, which is why the rename needs a release.

### Added

- `bugs` now points at the issue tracker explicitly instead of being inferred from
  `repository`.

## [0.3.2] - 2026-08-15

### Fixed

- `ffmpeg-video-composer` is depended on by a plain semver range. 0.3.0 and 0.3.1 shipped the
  literal string `workspace:*` — npm publishes it verbatim, so both releases fail to install
  with `EUNSUPPORTEDPROTOCOL`. Use 0.3.2 or later.
- `serverInfo.version` reports the real published version rather than a stale constant.

## [0.3.1] - 2026-08-15

### Fixed

- `validate_template` and `compose_video` now run the engine's full `TemplateValidator`
  (schema plus section-reference, transition, motion, animation, watermark, and font rules)
  with partials expanded first — a template can no longer validate clean and then fail
  mid-render, and a `project_video` living inside a partial now surfaces in
  `requiredClips` and the clip-coverage checks.
- `compose_video` passes the configured media dir as the engine's assets root, so
  descriptor asset paths under `LECLAP_MCP_MEDIA_DIR` resolve during renders — they were
  rejected as "outside the staged media directories" while `probe_media` accepted the
  same paths.
- The `probe_media` ffprobe fallback is honest: the name-swapped `ffmpeg-static` path is
  existence-checked (the package ships no ffprobe) and a missing binary yields an
  actionable install message instead of a raw spawn error.

### Changed

- The README documents the real media allowlist default (`~/.leclap/media`, not the home
  directory) and the `--allow-remotion` / `LECLAP_MCP_ALLOW_REMOTION` opt-in that gates
  `render_remotion_clip`.

## [0.3.0] - 2026-08-13

### Added

- `compose_video` now returns a `resource_link` alongside its text and structured
  content — a `file://` URI for the rendered `video/mp4`. Clients open or fetch the
  file themselves instead of the server inlining megabytes of base64 into the
  conversation.
- Render progress. The forked worker reports fractional progress over the IPC channel,
  throttled to 2% steps (the terminal 100% always gets through, exactly once), and
  `compose_video` writes it to **stderr** as `[compose_video] render <id> NN%`. It is
  not a protocol notification: the per-request log channel is deprecated in the
  2026-07-28 revision, which names stderr as the replacement for stdio servers, and
  stdout remains reserved for JSON-RPC framing.

### Changed

- Migrated from the monolithic `@modelcontextprotocol/sdk` v1 to the split SDK v2
  (`@modelcontextprotocol/server`), which implements the
  [2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28) protocol
  revision — the stateless one, with `server/discover` in place of the `initialize`
  handshake. Clients still on a 2025-era revision keep working: the stdio entry serves
  both eras from the same tool definitions.
- `tools/list`, `prompts/list`, and `server/discover` now advertise cache hints
  (5-minute TTL, `private` scope) instead of the SDK's conservative `ttlMs: 0`. The
  tool surface is fixed for the process lifetime, so a real freshness window is
  correct; `private` because the listing depends on this server's configuration.
- Tool and prompt argument schemas are declared as `z.object(...)` (the raw-shape
  overload is deprecated in v2), and handlers now receive the v2 `ServerContext` —
  cancellation moved from v1's flat `extra.signal` to `ctx.mcpReq.signal`.

## [0.2.0] - 2026-07-24

### Security

- `compose_video` now contains the descriptor's raw filter chain before it reaches
  ffmpeg: file/URL-reading filter types (`movie`, `amovie`, `subtitles`, `ass`, and
  plugin loaders such as `frei0r`/`ladspa`) are rejected, as are file/URL tokens
  smuggled through a scalar filter `value` (e.g. `curves=psfile=/etc/passwd` or an
  `http://…` URL). This closes an arbitrary-file-read + SSRF escape past the media-dir
  sandbox that only the `userVideoPaths` inputs were previously guarded against.

### Changed

- **Opt-in required:** `render_remotion_clip` — which bundles and executes
  caller-supplied code in headless Chromium — is now **disabled by default**. Enable it
  with `--allow-remotion` or `LECLAP_MCP_ALLOW_REMOTION=1` for trusted local design-time
  use. Callers of an existing server must add the flag for the tool to appear.
- `outputBaseName` on `compose_video` is now honoured, naming the output `.mp4`
  accordingly (previously validated but ignored).

### Fixed

- Forked render workers now have an `error` listener, so a spawn/IPC failure fails only
  that render instead of crashing the whole MCP server.
- The render worker flushes its IPC result before exiting, so a successful render is no
  longer reported as a failure.
- Concurrent renders are capped, client cancellation kills the worker immediately
  (freeing its slot), and intermediate render files are pruned to bound disk usage.
- `serveUrl` containment for `render_remotion_clip` is now realpath-based (symlink-safe),
  and `probe_media` plus the Remotion setup steps (`bundle`/`ensureBrowser`/
  `selectComposition`) are timeout-bounded.
- The stdout guard is installed before the engine's module graph loads, so a load-time
  write can no longer corrupt the JSON-RPC framing.

## [0.1.0] - 2026-06-27

Initial release: an MCP server exposing `ffmpeg-video-composer` as
agent-callable video composition tools.

### Added

- MCP tools for composing and rendering videos from JSON templates, plus a
  compose guide covering orientations (including square).
- Remotion clip rendering.

### Fixed

- Tightened local render access.
