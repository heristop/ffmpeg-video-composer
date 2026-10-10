# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [3.1.0] - 2026-10-10

### Added

- Template fonts for HTML layers. `global.fonts` declares the faces a template brings,
  `{ family, src, weight?, style? }`, one entry per weight or style; an HTML layer selects one with
  `font-family` in its `css`, and a declared family wins over a bundled family of the same name. `src` is a
  TrueType (`.ttf`), OpenType (`.otf`) or WOFF (`.woff`, unpacked to TrueType by the engine's own pure-JS
  inflate, no new dependency) file, or a base64
  `data:` URI, at most 8 MB. WOFF2 is refused with the command that converts it (Satori and HarfBuzz read
  neither WOFF2 nor its Brotli tables). Drawn text (drawtext, kinetic, captions) keeps the font registry.
- `ProjectConfig.fontDirs` (Node): read-only directories a `src` path resolves in, before the assets dir. A
  relative `src` is looked up in each in turn, an absolute one must lie inside one of them, and symlinks are
  resolved before the check. Template fonts are never fetched over the network, and the temp and build dirs
  other staged media may come from are not searched.
- A layer drawn with a template font is named by the hash of the font's bytes: the same font file gives the
  same frames, and a changed file under the same name is drawn again rather than reused.
- Validation: `font_woff2_unsupported` and `font_format` for a `src` that is WOFF2 or no font, `font_too_large`
  for an oversized data URI, and the `font_unused` advisory for a declared family no HTML layer selects.
  `templateFontErrors(descriptor, { assetsDir, fontDirs })` (Node entry) opens the files the way a render
  reads them and reports `font_not_found`, `font_unreadable`, `font_format`, `font_woff2_unsupported` and
  `font_too_large`. `loadTemplateFonts` and `templateFontSpecs` are exported from the Node and browser
  entries; `renderHtmlLayerPreview` takes the loaded faces as `templateFonts`.

### Changed

- CSS `@font-face` is still dropped, and its `html_unsupported_css` finding now points at `global.fonts`.
  `html_font_unknown` says the family is neither declared in `global.fonts` nor in the registry.

### Fixed

- Files read on the phone (React Native) keep their last bytes: the Expo filesystem adapter decoded base64 with
  its own helper, which turned the final one or two bytes of any file whose size is not a multiple of 3 into
  `0xFF`. An image inside an HTML layer (a JPEG losing its end marker) drew blank on the phone, and fonts or
  other staged files could be cut the same way. The adapter now uses the engine's shared base64 helpers.
- A muted `project_video` section (`muteSection: true`) with layers (HTML, image or animation inputs, `@video`
  maps, chroma key) no longer fails with "Stream specifier ':v' … matches no streams". The muted section
  puts its silent audio input first, so the recorded clip is input 1, but the overlay graph still read the
  video from input 0 and numbered the layers from 1.
- The phone's HTML layer page (`dist/html-rasteriser.html`) loads on older WebViews again: it called
  `Promise.withResolvers` (Chrome 119, Safari 17.4), so every HTML layer failed on an Android System WebView
  before 119 or iOS before 17.4. The page now supports Android System WebView 87+ and iOS 16.4+: its build
  targets them and it polyfills `Array.prototype.at` for Satori where missing. Rendered bytes are unchanged.

## [3.0.0] - 2026-10-09

A motion, effects, footage, audio and agent-tooling release: HTML layers, composed sound effects, typed
template fields, auto-captions, per-format compositions and a determinism contract. Validation is stricter
and renders are no longer byte-identical to 2.5.0, hence the major version.

Upgrading from v2? See the [migration guide](MIGRATION.md#upgrading-from-v2-to-v3).

### Added

- HTML layers, on Node, in the browser and on the phone. An `inputs[]` entry of `type: "html"` takes `html`,
  `css`, `width` and `height` and lays out a card, badge, price tag or stat row in a flexbox subset of CSS
  (tag, `.class` and descendant selectors). The markup is sanitised (no scripts, iframes, forms, SVG, event
  handlers or links), `{{ name }}` placeholders are filled HTML-escaped from typed fields, variables and form
  values, and `$color.*` / `$font.*` tokens resolve in `css` and `html`. Fonts come from the registry
  (variable fonts are pinned to static weights with HarfBuzz; layers of one section may share a font); images
  must be template assets or PNG/JPEG data URIs. Satori, resvg and HarfBuzz draw the layer at 2× into a transparent PNG named by content hash
  (`html:<hash>`, cached per process), which composites as a still image, so `position`, `scale`, `start` and
  `motion` work unchanged. One pipeline (`core/html/satori-raster.ts`) runs on every host, so a layer's PNG is
  byte-identical everywhere; only where its WebAssembly comes from differs:
  - Node reads it from `node_modules`.
  - The browser engine (`compileBrowser`) takes it from the host through `BrowserCompileOptions.loadHtmlWasm`
    (the web app serves it under `/html-engine/<version>/`); the engine never fetches it from a third party.
    It loads on the first HTML layer, in lazy chunks. `renderHtmlLayerPreview(request, { loadHtmlWasm })`
    draws one layer with the advisories its render reports, for a live preview.
  - Hermes has no WebAssembly, so the React Native entry takes a rasteriser from the host
    (`registerHtmlRasteriser`). The build ships `dist/html-rasteriser.html`, one self-contained page (5.2 MB,
    the pipeline and its WebAssembly inlined) that a hidden WebView runs, spoken to with
    `createRasterSession` / `readRasterReply` (JSON messages, PNG and fonts as base64, each font sent once per
    page).

  A host with no rasteriser registered (a browser compile without `loadHtmlWasm`, a React Native host that
  registered none) refuses the template with `html_unavailable`; validators that only check templates (the
  MCP server, the CLI) accept HTML layers. Validation also fails on `html_too_large` (a side over 1920 px).
  Advisories `html_unsupported_css`, `html_unsupported_markup`, `html_font_unknown`, `html_missing_field` and
  `html_overflow` (measured in the Node geometry checks); `motionCatalog().html` lists the subset and four
  recipes. Samples: `html-card` (a listing reel), `html-testimonial` (a Reels quote card), `html-speaker` (a
  conference lower third) and `html-stats` (a square stat dashboard), in `examples/motion-design/`.

- Composed sound effects. An `sfx` cue takes a `sound` instead of an `id`: layers of `tone`, `noise`,
  `strike` and `silence` shaped by envelopes, filter chains, glides, drive, pan and sequences, with
  whole-sound saturate/crush/room/echo, bounded to 4 s and 8 layers. A pure TypeScript synth renders it,
  seeded by `global.seed` and the cue path, to `build/sfx/<hash>.wav`, mixed like a library file: the same
  sound and seed give the same file on a given platform, while Node, browsers and Hermes can differ in the
  last bit (each JavaScript engine computes `Math.sin` and `Math.exp` its own way). A note shorter than its
  attack plus release (a tick, a fast roll) stays audible, and jittered, accelerating rolls keep every hit.
  Every library sound is also a recipe (`SOUND_PRESETS`); `sound.preset` varies one by `pitch`, `length`,
  `brightness` and `room`, while `id` cues keep playing the shipped files. A sound's notes add up to at most
  32 s of audio, so its render cost stays bounded. Advisories `sound_silent`, `sound_clipped`,
  `sound_harsh`, `sound_muddy`, `sound_long`, `sound_repeated` and `sound_overlap`;
  `motionCatalog().audio.compose`; `renderSound`, `analyzeChannels`, `soundSpec` and `SoundSchema` exports.
- Typed template fields: `global.fields` declares a template's inputs (map or list of `{ name, type, default?,
required?, maxLength?, min?, max?, options?, label?, description? }`, types text, color, url, media, number,
  enum and time). Values come from `ProjectConfig.fields`, then `default`; each is coerced by its type and
  filled into `{{ name }}` after partial expansion — a whole-string placeholder takes the typed value, so
  `"duration": "{{ HOLD }}"` lands as a number — then the slot's own schema judges it. A render fails before
  encoding on a missing required or ill-typed value; `validateTemplate(t, { fields })` checks strictly,
  without `fields` it probes. New advisories (`getFieldWarnings`, also in `getMotionWarnings`):
  `field_undefined`, `field_unused`, `field_type_mismatch`, `field_missing_required`. Node entry exports
  `resolveFields`, `assertFieldsResolved`, `coerceFieldValue` (pluggable coercers and `encode`),
  `declaredFields`, `fieldAdvisories` and `resolveTemplate`. Templates without `global.fields` are unchanged.
  Colours follow FFmpeg's grammar (`#rgb(a)` and `rgb()`/`rgba()` normalised to `#rrggbb(aa)`, names from
  FFmpeg's list, `@alpha` in 0–1); urls take http(s), data, `media://` or relative paths; a field value with
  filtergraph separators is refused in a raw filter value. Validation without values returns the authored
  descriptor; the resolved descriptor drops `global.fields`, so resolution is idempotent. A form field bound
  to a non-text declared field may omit `maxLength`.
- Auto-captions: `subtitles.transcribe: { from?, language?, model? }` asks for a section's speech as word
  timings. Transcribe once, then pin: a Node resolve pass (whisper.cpp — the `whisper-cli` binary with DTW word
  alignment, else an FFmpeg built with `--enable-whisper`) replaces the request with `subtitles.words` and records
  engine, model, language, clip digest and date in `meta.resolved.transcripts`; renders only read pinned words.
  Word times are mapped from clip to section seconds through `clip`, `speed`, speed ramps, freeze holds and kept
  take windows. The Node compile resolves an unpinned request itself; the browser and on-device engines report
  `transcribe_unavailable`. New advisories `transcript_low_confidence` and `transcript_stale` (the clip changed
  since the pin), new error `invalid_transcribe_source`, and optional `confidence` on words. Node exports
  `transcribeMediaFile`, `transcribeTemplate`, `ensureWhisperModel` (models downloaded once on explicit opt-in to
  `~/.cache/leclap/whisper`, SHA-256-verified, never bundled) and the platform-neutral `mapTranscriptWords`,
  `pinTranscript`, `transcriptSrt` (also on the React Native entry). Pins also record a fingerprint of the
  section's edits, and `transcript_edit_changed` reports a pin whose clip, speed, trim, ramp or freeze changed
  since. `CompileReporter.signal` (Node) cancels a build, transcription included.
- Template links (Node entry): `createBuilderLink`, `encodeTemplatePayload` / `decodeTemplatePayload` and
  `mediaToRebind` carry a template, compressed, in a builder URL's `#t=` fragment (never sent to a server),
  listing the media only the source machine can read (local paths, `file:`, `media://`, unsupported schemes).
  A base URL other than `https://leclap.dev` adds a warning, since that page can read the fragment.
- `applyJsonPatch(doc, operations, { maxOps })` and `parsePointer(pointer)` (Node entry): RFC 6902 JSON
  Patch (`add`, `remove`, `replace`, `move`, `copy`, `test`) over RFC 6901 pointers (`-` append, `~0`/`~1`
  escapes). Atomic (runs on a copy, the input is never mutated); rejects `__proto__`/`prototype`/`constructor`
  segments and keys and anything deeper than 64 levels; failures throw a `JsonPatchError` with a `code`, the
  failing operation's `index` and its `path`.
- `templateRevision(template)`: stable SHA-256 of a template's canonical JSON (object key order ignored),
  synchronous and platform-neutral; matches a `node:crypto` digest of the same JSON byte for byte.
- `findingLine`, `invalidTemplateText` and `summarizeErrors` (Node entry): the plain-text renderings of
  validation findings `@leclap/mcp` uses, now shared with other agent surfaces.
- Effects tour (`examples/motion-design/effects-tour.json`): a six-minute tour of every motion effect in ten chapters (chapter 5 now shows every fx primitive), first in the Effects & editing showcase (51 samples).
- `samples`: new `effects` category with 16 native samples (effects tour, FX pack, word captions, formats, kinetic fills, split layouts, right-to-left type, emoji type, beat grid, theme/roles/safe zones, footage editing, sound design, and four HTML layer samples: listing reel, testimonial, speaker card, stats dashboard).
- Determinism contract. `global.seed` roots every procedural effect. A deterministic encoder profile
  (bit-exact muxing, pinned libx264 threads) is applied to every command through one adapter tap; it is on
  by default and `ProjectConfig.deterministic: false` opts out. A render manifest is delivered through
  `CompileReporter.onManifest`. Raw filters that read the wall clock or `random()` raise the advisory
  `nondeterministic_expression` (their renders are not reproducible).
- Motion system: physical springs, cubic-bezier, the named curve set,
  `steps()` and point curves, all lowered to piecewise polynomials in `t` within 0.1%. `global.motion`
  tokens (springs, curves, durations, energy) and built-ins mirror the app's motion curves. `animate`
  keyframe tracks (`x`, `y`, `opacity`, `scale`) on positioned `drawtext`. The energy dial scales every
  travel distance. Each section chain is conformed to CFR and `noise` filters are seeded.
- Kinetic typography (`sections[].kinetic`): 14 presets (cascade, rise, drop, slide, pop,
  impact, tracking-in, typewriter, scramble, wave, highlight, counter, split, fade) laid out with real
  metrics of the bundled fonts (generated advance table) and animated per word, glyph or line as native
  `drawtext`. Accents, highlight markers, carets, seeded scramble/random order, exits, energy scaling, a
  shared baseline, and automatic wrapping and alignment. `motionCatalog()` exposes presets, defaults and
  art-direction rules for agents.
- Effects: a section `camera` (push-in, pull-out, drift, orbit, handheld presets; zoom/x/y/
  rotate tracks; beat `hits`; seeded shake; over-scanned so edges never show), animated `graphics` (flash,
  bars, underline, frame, corners, wipe, panel; frame-exact boxes), and designed transitions (`push-*`,
  `swipe-*`, `zoom-through`, `iris`, eased or spring-driven) composed from per-frame filters on the xfade
  timeline.
- Exports: `core/determinism` (hashing, seeds, manifest), `core/motion` (curves, easing, tokens, tracks),
  `ENGINE_VERSION`, `digestRenderedFile`.
- Agent-grade validation: findings carry optional `hint`, `suggestion` and `kind` (`format` = safe to
  auto-apply, `judgement` = ask the author first). Unknown keys are reported as `unknown_key` with a
  "did you mean" suggestion, including on objects that used to drop them silently; enum and unknown-type
  errors suggest the nearest value; schema and rule findings come back together, deduplicated.
- Time references: time fields accept `"<id>.start"`, `"<id>.end"`, `"50%"`, `"end - 0.5"`, `"beat:12"`,
  `"bar:3"` and `"cue:drop"`, resolved to seconds at compile time. Optional `id` on kinetic blocks,
  graphics and drawtext filters; `sections[].cues`; `global.beats` (`{ bpm, offset?, beatsPerBar? }` or
  `{ times }`). Codes `unknown_time_ref`, `circular_time_ref`, `unresolvable_time_ref`, `negative_time`,
  `duplicate_time_id`.
- Motion feedback: `motionTimeline()` and `TemplateValidator.getMotionWarnings()` (advisory
  `ease_monotony`, `front_loaded`, `stagger_too_long`, `starts_at_zero`, `transition_monotony`,
  `exit_before_transition`, `dead_air`, `tempo_flat`, each with a hint). Section `assert` (`visibleBy`,
  `before`, `inFrame`, `keepsMoving`) fails validation with `assertion_failed`. `motionCatalog()` adds a
  doctrine per genre, 10 validated scene blueprints, and a verb / `useWhen` / `avoidWhen` / `pairsWith`
  on every preset, transition and graphic.
- `global.theme`: twelve built-in themes (leclap, midnight, editorial, bold, neon, paper, sunset, ocean, mono,
  candy, retro, corporate; `fg` and `muted` at WCAG AA on `bg`, accents at 3:1) or
  `{ extends, colors, fonts, radius, motion }`; `$color.<name>[@alpha]` / `$font.<name>` resolve before
  lowering, so a themed template renders exactly like its literal version. `unknown_theme`,
  `unknown_theme_token`, advisory `accent_overuse`; `themeCatalog()`.
- `global.platform` (tiktok, reels, shorts, youtube, x, linkedin, facebook, square-feed, plus aliases):
  default orientation, captions lifted above the app's bottom UI, `loudnorm` aimed at -14 LUFS / -1 dBTP,
  and advisory `platform_ui_overlap`, `platform_duration_exceeded`, `platform_fps_mismatch`,
  `platform_orientation_mismatch`. `platformCatalog()`.
- Glyph coverage: text drawn with a bundled font that lacks glyphs fails validation with
  `font_missing_glyphs` (listing the characters and a bundled font that covers them). `pnpm generate:font-advances` also writes a per-font coverage table.
  The advance tables cover General Punctuation (curly quotes and apostrophes, dashes, ellipsis, bullet,
  primes, guillemets) and the euro sign; a character the kinetic font really lacks is reported as
  `kinetic_glyph_unmeasurable` instead of the block vanishing.

- Output QC (`ProjectConfig.qc`, `CompileReporter.onQc`, manifest `qc`): format checks (duration, frame
  count, A/V drift, pixel format, colour tags, audio present) and an optional content pass (black, frozen,
  silence, loudness, true peak) with a `verified` verdict; unmeasurable checks report "not checked".
- Render manifest `planHash`, and a Node per-section render cache (`ProjectConfig.cacheDir`, manifest
  `cache`) whose warm renders are byte-identical to cold ones.
- `loudnorm` re-checks the true peak after AAC encoding and retries with a lower ceiling (manifest
  `loudness`); it targets the delivery platform's loudness when `global.platform` is set.
- Final output on the Node/static adapters is published atomically; a render whose output is one of its
  inputs is refused.

- Per-format compositions: top-level `formats` overrides (deep-merge patches, `byId`, `remove`) and
  `{ "$format": { … } }` responsive values, resolved right after partial expansion. `ProjectConfig.format`
  picks one; validation runs per declared format, with advisories `format_crop_only` and
  `format_story_diverges`. Exports `resolveFormat`, `declaredFormats`, `usesFormats`, `FORMAT_NAMES`.
- Footage editing on `video` / `project_video`: `fit` (`cover`, `letterbox`, `blur`, `off`) with `fill` and
  cover `focus` (anchors, points, keyframed pans), `clip` in/out points, `speedRamp` presets or keys with
  `rampAudio`, `freeze` frames with an optional flash, `trimSilence` (Node `silencedetect`) and explicit
  `keep` windows, and `cutaways[]` B-roll with `a`/`b`/`mix` audio. Edited lengths drive the timeline,
  transitions, music and QC; an edited clip pads its audio only up to the edited length, so the audio never
  overruns the picture. New validation codes (including `take_edit_combination`) and advisories;
  `motionCatalog().footage`.
- `look: { preset, strength }` dials a LUT look toward the untouched footage, and `grade.lut: { url, strength? }`
  applies a user `.cube` (single `lut3d`, parsing errors name the line).
- Media probes report HDR (`pq`, `hlg`, `dolby-vision`), colour primaries and transfer, bit depth, VFR and
  rotation; HDR clips are tone-mapped to SDR on Node when the build has `zscale` and `tonemap` (read from
  the `-filters` listing of FFmpeg 7 and of FFmpeg 8 and later), otherwise the render logs
  `hdr_source_sdr_pipeline`.
- Word-timed `sections[].subtitles` from words, cues or SRT/WebVTT: phrase grouping, fit-then-balanced
  wrapping, splitting, platform safe zones, six caption styles (`clean`, `loud`, `keynote`, `documentary`,
  `boxed`, `neon`), karaoke `word` / `fill` / `pop` and a crown line, lowered to `drawtext` / `drawbox`.
  Errors `invalid_srt`, `invalid_word_timings`, `invalid_subtitle_cue`, `subtitle_font_unmeasurable`;
  advisories `caption_split`, `caption_shrunk`, `subtitle_past_end`, `caption_crown_repeated`;
  `motionCatalog().captions`. Opt-in `caption.wrap` / `caption.fit` and `kinetic[].wrap: "balanced"`.
  Karaoke styles that enlarge the spoken word (`loud`, `neon`, pop) leave room for it on both sides, and the
  line stays still as the highlight moves.
- Audio polish: `options.voice` presets (`clean`, `broadcast`, `warm`, `rumble-cut`, `room-gate`),
  `options.audioAutomation` and `global.audio.automation` (music bed, before ducking), section and global
  `sfx` from ten bundled sounds, `global.audio.sfx: "auto"` (whooshes, hits and risers from the motion),
  whole-video time references for global fields, and `motionCatalog().audio`.
- Beat analysis: `analyzeBeats`, `analyzeMusicFile` and `applyMusicAnalysis` measure tempo, the downbeat, a
  confidence and drop/build/end cues. `global.beats: { analyze: "music" }` is measured during the Node
  compile (`beats_analysis_unavailable` elsewhere); section `options.duration` accepts `{ beats }` /
  `{ bars }` (`beat_duration_needs_bpm`); advisory `beat_grid_low_confidence`.
- Motion roles: `global.motion.roles` (`micro`, `panel`, `camera`, `headline`, `accent`, `mascot`) with
  built-in defaults, `$role.<name>` tokens and `role` on kinetic blocks, graphics, drawtext filters, title
  cards, lower thirds and the camera; advisories `overshoot_overuse` and `headline_hold_short`;
  `motionCatalog().roles`.
- Section `purpose` / `role` metadata, and `meta.brief` / `meta.requirePurpose` opting into the advisory
  `section_without_purpose`.
- Motion FX: kinetic `trail` echoes, `whip-left|right|up|down` designed transitions, `glitch`, `focus`,
  `progress`, `ticker` and `bars-chart` graphics, and `lowerThird.style` (`clean-bar`, `side-rule`,
  `kicker`, `stack-bars`, `pill`); `motionCatalog().lowerThirds` and `kinetic.trail`. Whips model a 144°
  shutter: the blur follows the push's real speed, ramps in and out with the ease, is centred on its frame
  and is capped at 4.5 % of the travel axis.
- `above: true` graphics are drawn after the section's own authored `filters` and masks, so an authored mask
  or a text plate does not hide them. An `underline` and an fx on a `text:<i>` target default to above.
- Compositing: `kinetic[].fill` (gradient, texture or shimmer inside the letters, through `alphamerge`) and
  `sections[].layout` split screens and before/after wipes; errors `unknown_layout_source`,
  `layout_unsupported_section`, `layout_wipe_out_of_range`; advisory `mask_unavailable`;
  `motionCatalog().compositing`.
- Right-to-left and complex scripts: `text_shaping` follows the real build (libfribidi), such kinetic text
  animates per line (`kinetic_unit_coarsened`, `rtl_unshaped`), and the bundled `noto-arabic` /
  `noto-hebrew` fonts.
- Colour emoji in drawn text render as bundled image overlays that share the text's timing, motion and fade;
  `global.emoji` (`image`, `strip`, or `error` to fail with `emoji_unsupported`) and advisories `emoji_missing_asset`, `emoji_overlay_cap`,
  `emoji_stripped`; `resolveBundledEmoji` filesystem hook.
- Reference style: `analyzeStyle` / `analyzeStyleFile` derive a theme and style guide (palette roles with
  WCAG AA contrast, grain, pacing, motion energy, genre) from an image or clip, deterministically.
- Advisory `palette_drift` (off-palette hex colours, more than two font families) with `global.theme` set;
  `findPaletteDrift`.
- Capability doctor: `probeCapabilities()` probes the Node FFmpeg (listings plus one-frame renders, cached
  per binary and version); renders drop unusable filters with a warning and fall back to cuts without
  xfade; `TemplateValidator.getCapabilityWarnings()` returns `feature_unavailable`. `FVC_CAPABILITY_PROBE=0`
  skips the probe.
- Elastic partials: `envelope`, `syncPoints`, `jobs` / `useWhen` / `avoidWhen` on definitions, and ref
  `duration` and `align`; sync points become cues; advisory `partial_compressed`;
  `motionCatalog().partials` and `partialCatalog()`.
- Inspection (Node): `renderSnapshots`, `compareSnapshots` and `lookSnapshots` save PNG frames at
  whole-video time references, at transitions or once each section settles, with contact sheets,
  platform safe-zone shading, crops, variant and look grids, and per-format rendering. `videoTimeline()`
  places sections, motion events, beats and cues on video seconds; `searchMotionCatalog()` ranks catalog
  entries, including captions, sound effects, voice, footage, roles, compositing, lower thirds and formats.
- On-device engine: `acompressor`, `adelay`, `agate`, `alimiter`, `equalizer` and `alphamerge` join the
  filter allowlist and the build links libfribidi (rebuild the engine).

- Light and effects: `graphics[]` entries with `type: "fx"`, 13 procedural primitives lowered at output
  resolution and clipped to a `target` (`"frame"`, `"pane:<i>"`, `"layer:<i>"`, `"text:<i>"` or a
  `{ x, y, w, h, radius }` rectangle in px or frame fractions). Light: `sheen`, `leak`, `edge-glow`, `bloom`.
  Marks: `ripple` (`ring` / `tap`), `glint` (`scatter` / `corners` / `orbit`), `confetti`. Ambient (≤ 0.12,
  absent at `global.motion.energy: 0`): `bokeh`, `dust`, `vignette-breathe`, `grain`. Surfaces: `glass`,
  `resolve`. Shared fields `at`, `duration` (≤ 30 s), `ease`, `until`, `repeat`, `every`, `color` (theme
  tokens), `intensity` (0–1 of the primitive's ceiling), `seed` and `above`; omitted parameters derive from the
  target size, the theme accent, the motion energy and the seed, deterministically. Every primitive uses
  on-device filters with fallbacks (compile-time sprites without `gradients`), has a reduced-motion form, and
  is skipped with `fx_target`, `mask_unavailable` or `fx_skipped` when it cannot render. `motionCatalog().fx`
  (and `searchMotionCatalog` kind `fx`) lists each primitive's parameters, defaults and design intent from
  `FX_DOCS`; that prose is loaded lazily, outside the browser's eager load. `leak`, `bloom` and
  `vignette-breathe` dither their soft light with a fine static grain, so they do not band after libx264
  encoding at crf 23.
- Strokes: `frame`, `corners` and `underline` draw even-pixel strokes that trace from the top-left with a head
  fade and leave before `until`, and take `target`, `clearance` (24), `radius`, `trace`, `exit`,
  `exitDuration` and `contrast` (`auto` | `shadow` | `none`); `corners` adds `spread`, `underline` adds round
  `caps` and `settle`.
- Kinetic `counter`: tabular digits, locale grouping and decimal marks (`locale`, `grouping`), `overshoot`,
  an exact landing on `to`, and `to` read from the first number of the block text (`"{{ form_price }}"`) when
  omitted. Without a duration the roll lasts 0.6–1.6 s by range.
- Sameness lint on the motion feedback channel: `fx_untuned`, `effect_repeated`, `library_animation_sample`,
  `effect_off_theme`, `decor_overload`. `motionCatalog().samples` maps each library APNG to the primitives
  that replace it.
- Packaged samples: the six effect recipes (interface-focus, product-spotlight, celebration-burst,
  focus-lock, light-pass, frame-reveal) are built from engine primitives instead of APNG overlays.

### Changed

- `compile()` leaves error reporting to a reporter that takes `onError` (no console message or stack trace).
- **Breaking:** validation is stricter, so some templates that passed in 2.5.0 now fail:
  - keys that strip objects used to drop silently (section options, transitions, discriminated unions) are
    reported as `unknown_key` errors; remove or rename them (the finding suggests the nearest key);
  - text drawn with a bundled font that lacks its glyphs fails with `font_missing_glyphs`.
- **Breaking:** renders are no longer byte-identical to 2.5.0: the deterministic encoder profile is on by
  default (`ProjectConfig.deterministic: false` restores the previous encoder settings), every section is
  conformed to CFR and zooms are rendered at sub-pixel precision. Pin golden files again after upgrading.
- Five bundled app templates draw their cards with HTML layers (in the `samples` catalog too): Interview's
  lower third (name, role and an "On the record" badge in one padded box), Product Launch's offer tag, spec
  card and call-to-action pill, Web App Promo's feature chips, App Tutorial's numbered step badges and Story
  Reel's chapter cards (story progress segments and "01 / 03" above each caption, inside the Reels and TikTok
  safe zones). Field and form names are unchanged.
- Browser entry: `zod` is no longer inlined into `dist/browser.js`. It is imported from the `zod`
  runtime dependency (like `tslib`), so the host's bundler shares one copy with the app. Validation
  also no longer loads the background sugar presets or the rounded-panel PNG encoder at startup.
  Together these cut the eager load from 806 KB to 587 KB, and `Template` still validates synchronously.

### Fixed

- A letterboxed clip (`fit: "letterbox"` or `forceOriginalAspectRatio`) under an image, animation or HTML
  input keeps its bars: the overlay path cover-cropped the footage to fill the frame.
- Zooms and pans (camera rig, Ken Burns, pulse, `resolve`, `zoom-through`) no longer stutter: `zoompan`
  cropped a whole-pixel window, so a slow push-in held for one to four frames and then jumped by up to a
  pixel, sometimes backwards. Every zoom now lowers to an exact sub-pixel zoom with the same on-device
  filters, at about the same cost; a moving zoom rests at a 1.5 px over-scan that fades out by zoom 1.05, so
  eased zooms do not hold their first and last frames before a half-pixel jump.
- A cut between sections that also use designed transitions is joined with `concat`: the 0.001 s xfade shorter than a frame ended the output early on FFmpeg 6.x.
- No false text-collision warning for a global overlay on back-to-back sections (sub-millisecond overlaps are ignored).
- Node renders pass a filtergraph longer than 64 KB through a file, so a long stepped or per-frame graph no
  longer fails to spawn with E2BIG: `-/filter_complex <file>` (and `-/vf`, `-/af`) on FFmpeg 7.0 and later,
  `-filter_complex_script` / `-filter_script` on FFmpeg 6 (`ffmpeg-static`). A command FFmpeg cannot start
  (E2BIG, ENOENT) reports the system error instead of an empty failure.
- FFmpeg 8 no longer crashes on animated text sizes: a drawtext whose `fontsize` changes over time (kinetic scale presets, the karaoke word pop, `animate.scale`) is drawn as one constant-size drawtext per run of frames.
- Backslashes in drawtext text (captions, title cards, overlays, kinetic counter prefix/suffix) render
  literally instead of being swallowed; escaping is shared and verified against a real FFmpeg.
- FFmpeg 7.1+: Rec.709 tags are set through libx264 parameters, avoiding an unintended colour conversion.
- `project_video` sections whose audio is shorter than the video no longer lose video frames to
  `-shortest` (the clip's audio is padded).
- Normalisation now runs when music is enabled but no track resolves.
- FFmpeg 9 support: long filtergraphs no longer use `-filter_complex_script` / `-filter_script`, which FFmpeg 9
  removed (see above).
- FFmpeg 9: a music mix no longer loses its last 0.1 s of video. With the video stream-copied, FFmpeg 9's
  `-shortest` dropped the last frames, so the mix now ends at the planned timeline length (`-t`) on every
  release, and still reads the segment list directly. Version checks now live in `core/ffmpeg-version.ts`.

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
