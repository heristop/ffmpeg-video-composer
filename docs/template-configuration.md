# 🧩 Template Configuration

A **template** is a JSON document that describes a video: its global settings and the ordered sections that make it up. The compiler (`ffmpeg-video-composer`) turns a template plus a `ProjectConfig` (build/assets dirs, locale, user-supplied form values, recorded clips) into a finished video. Native descriptor scenes render on Node, in the browser via WebAssembly, and fully on-device on React Native. Registered effect scenes require a configured backend to resolve them into compatible clips before composition.

This is the template descriptor reference. Upgrading an older template? See [Migrating older templates](#migrating-older-templates).

- **Source of truth (zod):** [`packages/ffmpeg-video-composer/src/schemas/`](../packages/ffmpeg-video-composer/src/schemas/) — every field carries a `.describe()`. `TemplateDescriptorSchema` is the root.
- **Machine-readable schema:** [`docs/template-descriptor.schema.json`](./template-descriptor.schema.json) — generated from the zod source via `pnpm --filter ffmpeg-video-composer generate:schema`. Feed this to an editor or an agent for autocompletion/validation.
- **Examples:** [`packages/leclap-creative-kit/src/templates/`](../packages/leclap-creative-kit/src/templates/) — shared template descriptors plus bundled creative assets.
- **Validation:** `TemplateValidator` validates a descriptor against the schema (plus cross-field rules) before compilation.

> For the conceptual compile pipeline (director → builder → segments → managers), see [`architecture.md`](./architecture.md).

## Philosophy: structured sugar vs. raw filters

A descriptor has two layers, and you can mix them freely:

- **Structured sugar** — the editor-friendly, LLM-clear layer. `transition`, `look`, `grade`, `motion`, `audio`, `layers`, animation `inputs`, and the text sugar (`caption`, `titleCard`, `lowerThird`, `reveal`, and whole-video `global.overlays`/`look`/`grade`) are high-level intents. They compile down to ordinary FFmpeg filters for you (`xfade`/`acrossfade`, `eq`/`colorbalance`/`curves`, `zoompan`/`rotate`/`crop`/`hflip`/`vflip`, `loudnorm`/`sidechaincompress`/`afade`, `drawbox`/`drawtext`/`fade`/gradients). Prefer this layer — it is portable, validated, and on-device-safe. A title card or lower-third replaces ~80 lines of hand-positioned `drawtext` + `alpha` expressions with a few fields.
- **Raw filters (escape hatch)** — `filters[]`, `inputs[].filters`, and `maps[]` pass FFmpeg filter names and arguments through **verbatim**. This is the power-user layer for anything the sugar doesn't cover.

Because `filters[]` is a raw pass-through, its `values` keys stay **FFmpeg-native by design** — `x`, `y`, `w`, `h`, `c`, `t`, `fontcolor`, `fontsize`, `fontfile`, `alpha`, `d`, `st`, `color`, `box`, `boxcolor`, `boxborderw`. They are _not_ camelCased. The structured-sugar fields, in contrast, use editor-friendly camelCase names (`sourceVolume`, `musicVolume`, `colorBalance`, `curvesPreset`). Keep the two mental models separate: sugar = friendly keys, raw filters = FFmpeg keys.

## Top-level shape

```jsonc
{
  "meta": {/* Optional display metadata */},
  "global": {/* GlobalConfig — project-wide defaults */},
  "sections": [/* ordered Section[] — scenes, forms, or partial references */],
  "partials": [/* optional reusable fragment definitions */],
}
```

All top-level keys are optional (so partial descriptors can be validated incrementally), but a useful template has at least one section.

**Native descriptor durations are in seconds** — `options.duration`, `transition.duration`, `audioFade.in.duration`, `countdownDuration`, etc. Registered-effect props can use frame counts or other units defined by their effect schema; do not assume they use seconds.

Host paths, media bindings, encoder/quality settings and MCP startup options live outside the descriptor;
see [engine configuration](./engine-configuration.md). `global.orientation` determines the output
layout, and `global.fps` takes precedence over host `videoConfig.fps`. `meta.creativeDirection` is
an authoring brief and does not override either configuration layer.

## `meta`

Optional human-facing metadata embedded in the descriptor, used by template browsers and agent catalogs.

| Field               | Type     | Description                                                                                            |
| ------------------- | -------- | ------------------------------------------------------------------------------------------------------ |
| `name`              | `string` | Human-readable template name.                                                                          |
| `description`       | `string` | Short template summary for catalogs and agents.                                                        |
| `creativeDirection` | `string` | Optional authoring brief, trimmed, 1–4000 characters. Guides humans/agents; does not change rendering. |

Use `meta.creativeDirection` to record audience, hierarchy, typography, palette, motion, pacing,
avoidances and review criteria. Implement it through explicit section settings and effect props;
the renderer never interprets or executes this prose. See [creative direction](./creative-direction.md)
for distinct example treatments, the CLI starter flag and MCP prompt arguments.

## `global`

Project-wide defaults and the options a builder/editor exposes to end users. `global` is `strict` — unknown keys are rejected.

| Field                   | Type                                    | Description                                                                                                                                    |
| ----------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `variables`             | `Record<string, string \| string[]>`    | Named values referenced anywhere via `{{ varName }}`.                                                                                          |
| `orientation`           | `'landscape' \| 'portrait' \| 'square'` | Output orientation → resolution preset: landscape `1280x720`, portrait `720x1280`, square `1080x1080` (default `landscape`).                   |
| `fps`                   | `number`                                | Output frame rate for the rendered video — integer `1..120` (default `30`). Applies to every re-encode pass (segments and the final assembly). |
| `colorsList`            | `string[]`                              | Palette offered to the user; reference as `{{ color1 }}`, `{{ color2 }}`.                                                                      |
| `musicEnabled`          | `boolean`                               | Whether background music is enabled (default `true`).                                                                                          |
| `music`                 | `{ name: string, url?: string }`        | Default background track. Omit `url` to use an app-managed track.                                                                              |
| `animations`            | `GlobalAnimation[]`                     | Whole-video overlays, composited over the whole video (see [Whole-video animations](#whole-video-animations)).                                 |
| `overlays`              | `GlobalTextOverlay[]`                   | Whole-video TEXT overlays — a brand watermark authored once, drawn on every section (see [Global decorations](#global-decorations)).           |
| `look`                  | look preset                             | Colour-grade preset applied across every section (whole-video look).                                                                           |
| `grade`                 | `Grade`                                 | Fine-grained colour grade applied across every section.                                                                                        |
| `transition`            | `Transition`                            | Default boundary transition between sections (see [Transitions](#transitions)).                                                                |
| `audio`                 | `GlobalAudio`                           | Global audio mix (see [Audio](#audio)).                                                                                                        |
| `allowedMusic`          | `string[]`                              | Allowlist of music identifiers the user may choose.                                                                                            |
| `allowUploadMusic`      | `boolean`                               | Allow the user to upload a custom music file (default `false`).                                                                                |
| `allowedBackgrounds`    | `string[]`                              | Allowlist of background identifiers the user may choose.                                                                                       |
| `allowUploadBackground` | `boolean`                               | Allow the user to upload a custom background (default `false`).                                                                                |

## Sections

`sections` is a discriminated union on `type`. Native sections share the **base fields** below, then add type-specific `options`. Registered `effect` scenes require an effect reference and duration; see [Registered JSON effects](#registered-json-effects-desktop-authoring).

### Section types

| `type`             | Renders                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `video`            | A pre-recorded / asset-backed clip (`options.videoUrl`).                                                                                    |
| `project_video`    | A clip captured from the device camera (supports a `framingGuide`).                                                                         |
| `form`             | A text-input form (`options.fields`); collects values for `{{ field }}`.                                                                    |
| `color_background` | A solid or layered colour background (`options.backgroundColor`, `layers`).                                                                 |
| `image_background` | A still image background (`options.pictureUrl`).                                                                                            |
| `music`            | An audio-only / timeline-padding section (no video).                                                                                        |
| `partial`          | Expands inline to a reusable partial's sections (see [Partial sections](#partial-sections)).                                                |
| `effect`           | Registered JSON effect resolved into a clip before composition (see [Registered JSON effects](#registered-json-effects-desktop-authoring)). |

Native visual segments live in `packages/ffmpeg-video-composer/src/editor/segments/`; `SegmentFactory` maps `type` → class. A `partial` is expanded into real sections before validation and compile. An `effect` is resolved by the caller's backend before the native engine runs.

### Partial sections

A `partial` section pulls in a reusable fragment from the shared registry ([`@leclap/creative-kit`](../packages/leclap-creative-kit) — e.g. `logo-bumper`, `flash-card`), so a template composes vetted building blocks instead of repeating them.

```jsonc
{ "type": "partial", "ref": "flash-card", "prefix": "q1_", "variables": { "optionA": "{{ optionA1 }}" } }
```

| Field       | Type                     | Description                                                                                 |
| ----------- | ------------------------ | ------------------------------------------------------------------------------------------- |
| `ref`       | `string`                 | Id of a partial in the registry; its sections replace this one.                             |
| `prefix`    | `string`                 | Prepended to each expanded section's `name`, so the same partial can be used repeatedly.    |
| `variables` | `Record<string, string>` | Substituted into the partial's `{{ key }}` placeholders (values may themselves be globals). |

Expansion happens **before** schema validation and compile, so everything downstream only sees real sections.

### Base fields (native sections)

| Field         | Type             | Description                                                                                                      |
| ------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------- |
| `name`        | `string`         | Unique id within the template; used in section references.                                                       |
| `type`        | section literal  | One of the types above (discriminates the union).                                                                |
| `title`       | `Translation`    | Localised title shown to the user (e.g. `{ "en": "…" }`).                                                        |
| `description` | `Translation`    | Localised instruction text shown to the user.                                                                    |
| `options`     | type-specific    | See [Options](#options).                                                                                         |
| `inputs`      | `Input[]`        | Animation/image overlays composited over the section (see [Overlay inputs](#overlay-inputs-animations--images)). |
| `maps`        | `Map[]`          | Custom filtergraph maps (see [Maps](#maps)).                                                                     |
| `filters`     | `Filter[]`       | Raw FFmpeg filter chain on the section output (see [Filters](#filters)).                                         |
| `transition`  | `Transition`     | Boundary transition applied **after** this section; overrides `global.transition`.                               |
| `look`        | look preset      | Named colour-grade (see [Looks & grade](#looks--grade)).                                                         |
| `grade`       | `Grade`          | Fine-grained colour-grade (see [Looks & grade](#looks--grade)).                                                  |
| `letterbox`   | `Letterbox`      | Cinemascope-style horizontal bars simulating a wider aspect ratio (see [Letterbox](#letterbox)).                 |
| `motion`      | `MotionEffect[]` | Ordered motion / geometric effects (see [Motion](#motion)).                                                      |
| `caption`     | `Caption`        | Styled lower-third / overlay caption, rendered as a `drawtext` filter (see [Captions](#captions)).               |
| `lowerThird`  | `LowerThird`     | Structured title/subtitle band over the clip (see [Lower thirds](#lower-thirds)). On visual sections.            |

`color_background` sections also accept a section-level `titleCard` (see [Title cards](#title-cards)).

### Options

Common options (`BaseSectionOptionsSchema`, `strict`) shared by native sections, plus per-type extras. Effect sections require `duration` and reject `useVideoSection`, `videoUrl` and `pictureUrl`. **All durations are in seconds.**

| Field                                      | Type                                        | Description                                                                                                                                                                   |
| ------------------------------------------ | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `duration`                                 | `number` (s)                                | Fixed section duration in **seconds**; overrides clip length.                                                                                                                 |
| `musicVolume`                              | `number` 0..1                               | Per-section music volume override (overrides `global.audio.musicVolume`).                                                                                                     |
| `audioFade`                                | `{ in?, out? }`                             | Section audio fades (see [Audio](#audio)).                                                                                                                                    |
| `audioEffect`                              | `'echo' \| 'telephone' \| 'muffled'`        | Voice effect preset applied to the section audio (see [Audio](#audio)).                                                                                                       |
| `speed`                                    | `number` > 0                                | Playback speed as a PTS multiplier (default 1; `2` = half-speed slow-mo). Needs a `setpts` map node to take effect; audio uses `atempo`, clamped to `[0.5, 2]`.               |
| `muteSection`                              | `boolean`                                   | Silence the source audio of this section (default `false`).                                                                                                                   |
| `countdown`                                | `boolean`                                   | Show a countdown overlay before recording (default `false`).                                                                                                                  |
| `countdownDuration`                        | `number` (s)                                | Countdown length in seconds (default 3); only when `countdown`.                                                                                                               |
| `upperCase` / `lowerCase`                  | `boolean`                                   | Force all text in the section to upper/lower case.                                                                                                                            |
| `useVideoSection`                          | `string`                                    | Reuse another `project_video` section's recorded clip by name.                                                                                                                |
| `videoUrl`                                 | `string`                                    | Pre-recorded video asset (`video` section).                                                                                                                                   |
| `logoUrl` / `backgroundUrl` / `pictureUrl` | `string`                                    | Asset URLs composited into the section.                                                                                                                                       |
| `backgroundColor`                          | `string`                                    | Solid background colour as a CSS hex (e.g. `#000000`).                                                                                                                        |
| `forceAspectRatio`                         | `boolean`                                   | Cover-crop the clip to fill the output frame — scales up, crops overflow, never stretches (on by default; `false` skips scaling).                                             |
| `forceOriginalAspectRatio`                 | `boolean`                                   | Letterbox to preserve the clip's original aspect ratio (bars, no crop). Overrides cover-crop (default `false`).                                                               |
| `layers`                                   | `BackgroundLayer[]`                         | **`color_background` only** — composited layers (see [Layers](#layers)).                                                                                                      |
| `framingGuide`                             | `FramingGuide`                              | **`project_video` only** — recording-UI overlay (see [Framing guide](#framing-guide)).                                                                                        |
| `captureMode`                              | `'front' \| 'back' \| 'screen' \| 'upload'` | **`project_video` only** — default capture mode when the recorder opens (default `'front'`). `screen` = display capture (web only); `upload` = file picker instead of camera. |
| `allowedCaptureModes`                      | `CaptureMode[]`                             | **`project_video` only** — modes the user may switch between. Omit to allow all; single-element array locks to one mode. `screen` is silently ignored on native/Expo.         |

`form` sections use `options.fields`: `{ name, maxLength, label: Translation }[]`. Each field's `name` becomes a `{{ name }}` variable usable in any filter.

## Transitions

A `Transition` controls the boundary **after** a section:

```jsonc
{ "type": "fade", "duration": 0.4 } // xfade name, or "cut" for a hard cut
```

- `type` — one of the [xfade names](#xfade-transition-names) below, or `"cut"`.
- `duration` — optional, in seconds (max 5). **Effective duration = `section.transition.duration` ?? `global.transition.duration` ?? `0.3`** (`DEFAULT_TRANSITION_DURATION`).

**How it compiles & performs:**

- A template whose boundaries are **all `cut`** (or have no transition) uses a fast stream-copy `concat` — cheap.
- **Any non-`cut` boundary forces a single re-encode assembly pass**: the segments are stitched with `xfade` (video) / `acrossfade` (audio), with offsets computed from the **probed** segment durations.
- ⚠️ **Performance:** that re-encode runs over the **full timeline** and is costly on WASM (the ~2 GB IndexedDB filesystem limit) and on-device. Cuts are nearly free. Prefer cuts unless a soft transition meaningfully improves the result.

The validator rejects:

- a non-`cut` transition on the **last** rendering section (nothing to transition into — `dangling_transition`);
- an effective transition duration **≥** the smaller of the two adjacent _declared_ `options.duration`s (`transition_too_long`);
- `kenburns` motion outside `image_background`, `video`, `project_video` or `effect` (`motion_unsupported_section`).

### xfade transition names

Quoted from `XFADE_TRANSITIONS` in [`effects.schemas.ts`](../packages/ffmpeg-video-composer/src/schemas/effects.schemas.ts) — that array is the authoritative list (don't retype it):

`fade`, `fadeblack`, `fadewhite`, `fadegrays`, `distance`, `dissolve`, `pixelize`, `radial`, `hblur`, `wipeleft`, `wiperight`, `wipeup`, `wipedown`, `wipetl`, `wipetr`, `wipebl`, `wipebr`, `slideleft`, `slideright`, `slideup`, `slidedown`, `smoothleft`, `smoothright`, `smoothup`, `smoothdown`, `circlecrop`, `rectcrop`, `circleclose`, `circleopen`, `horzclose`, `horzopen`, `vertclose`, `vertopen`, `diagbl`, `diagbr`, `diagtl`, `diagtr`, `hlslice`, `hrslice`, `vuslice`, `vdslice`, `hlwind`, `hrwind`, `vuwind`, `vdwind`, `coverleft`, `coverright`, `coverup`, `coverdown`, `revealleft`, `revealright`, `revealup`, `revealdown`, `squeezeh`, `squeezev`, `zoomin` — plus the special value `cut`.

## Looks & grade

`look` is a one-word colour-grade preset (`LOOK_PRESETS`). Three families:

- **`eq`/`curves` looks** (a stack of ordinary filters): `cinematic`, `warm`, `cool`, `vintage`, `noir`, `vivid`, `dreamy`.
- **LUT-backed cinema looks** (a single `lut3d` + a bundled `.cube` file — a stronger, cleaner grade than the filter stacks): `teal-orange`, `warm-film`, `mono-film`, `noir-film`, `vivid-pop`. The engine stages the referenced `.cube` the same way it stages fonts, and `lut3d` is a standard LGPL filter that runs on every backend (host, on-device, WASM). A backend without `lut3d` drops the look with a warning rather than aborting (the clip renders ungraded).
- **Stylized looks** (each its own small filter stack, all LGPL/on-device-safe — no `eq`/`geq`/`boxblur`): `duotone` (`hue` desaturate + `colorchannelmixer` tint + a `lutyuv` contrast lift), `posterize` (a single `lutyuv` that quantizes luma/chroma into 48-level steps), `sketch` (`edgedetect` in `colormix` mode + a `lutyuv` contrast/brightness lift), `glitch` (`rgbashift` channel offset + `noise`), `soft-vignette` (a single `vignette`).

`grade` is the fine-grained equivalent and stacks on top of `look`. All fields optional:

| Field                                                | Range           | Default | Compiles to    |
| ---------------------------------------------------- | --------------- | ------- | -------------- |
| `brightness`                                         | -1..1           | 0       | `eq`           |
| `contrast`                                           | 0..2            | 1       | `eq`           |
| `saturation`                                         | 0..3            | 1       | `eq`           |
| `gamma`                                              | 0.1..3          | 1       | `eq`           |
| `hue`                                                | -180..180 (deg) | 0       | `hue`          |
| `colorBalance.{shadows,midtones,highlights}.{r,g,b}` | -1..1           | —       | `colorbalance` |
| `blur`                                               | 0..20 (px)      | 0       | `gblur`        |
| `grain`                                              | 0..1            | 0       | `noise`        |
| `curvesPreset`                                       | string key      | —       | `curves`       |

Looks and grades compile to ordinary FFmpeg filters (`eq`, `colorbalance`, `curves`, `gblur`, `noise`, `hue`) — nothing exotic, on-device-safe. `grain` lowers to `noise=alls=<0..20>:allf=t+u` (strength scaled from the 0..1 input).

## Letterbox

`letterbox` overlays two solid `drawbox` bars, top and bottom, to simulate a wider aspect ratio than the actual output frame (a cinemascope look):

```jsonc
{ "letterbox": { "aspect": 2.39, "color": "#000000" } }
```

| Field    | Type              | Description                                                          |
| -------- | ----------------- | -------------------------------------------------------------------- |
| `aspect` | `number` 1..4     | Target aspect ratio the bars simulate (e.g. `2.39` for cinemascope). |
| `color`  | `string` optional | Bar colour (default `black`).                                        |

The bar height is `(ih - iw/aspect) / 2`, computed from the compiled output frame. **No-op when `aspect` is narrower than or equal to the output frame's own aspect ratio** — the engine never emits a bar with a non-positive height, so authoring `letterbox` on a frame that's already at least as wide as `aspect` silently draws nothing rather than producing an invalid filter.

## Motion

`motion` is an **ordered array** of geometric effects applied to the section video; they compile to `zoompan` / `rotate` / `crop` / `hflip` / `vflip`:

```jsonc
[
  { "type": "kenburns", "direction": "in", "intensity": 1.2 }, // still background or video clip
  { "type": "rotate", "angle": 5 },
  { "type": "crop", "w": 1280, "h": 720, "x": 0, "y": 0 },
  { "type": "flip", "axis": "horizontal" },
  { "type": "shake", "intensity": 6, "frequency": 2 },
  { "type": "pulse", "intensity": 1.08, "frequency": 1 },
]
```

| `type`     | Fields                                                                                           | Notes                                                                                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kenburns` | `direction?` (`in`/`out`/`left`/`right`/`up`/`down`), `intensity?` (1.01..2, default 1.15)       | `zoompan` on `image_background`, `video`, `project_video` or resolved `effect` clips. Video uses one output frame per input frame after fps normalization. |
| `rotate`   | `angle` (degrees, + = clockwise)                                                                 | `rotate`.                                                                                                                                                  |
| `crop`     | `w`, `h` (required), `x?`, `y?` (px or FFmpeg expression)                                        | `crop`; default offset centres the crop.                                                                                                                   |
| `flip`     | `axis` (`horizontal` / `vertical`)                                                               | `hflip` / `vflip`.                                                                                                                                         |
| `shake`    | `intensity?` (jitter amplitude px, 1..20, default 6), `frequency?` (Hz, 0.5..8, default 2)       | Handheld shake: a wandering `crop` window, scaled back to the section's output size so it never shrinks the frame. No section-type restriction.            |
| `pulse`    | `intensity?` (peak zoom, 1.01..1.3, default 1.08), `frequency?` (pulses/sec, 0.25..4, default 1) | Rhythmic `zoompan` zoom in/out around the frame centre, mirroring `kenburns`'s still-vs-video (`d=frames` / `d=1`) handling. No section-type restriction.  |

## Audio

`global.audio` (`GlobalAudio`) sets the mix; per-section `options.audioFade` and `options.musicVolume` refine it.

| Field          | Type                                                               | Compiles to / behaviour                                                                                                                                                                                                                                                             |
| -------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sourceVolume` | `number` 0..1 (default 1)                                          | Recorded/source-audio volume in the final mix.                                                                                                                                                                                                                                      |
| `musicVolume`  | `number` 0..1 (default 0.5)                                        | Background-music volume; per-section `options.musicVolume` overrides.                                                                                                                                                                                                               |
| `normalize`    | `'loudnorm'` \| `'dynaudnorm'`                                     | `loudnorm I=-16:TP=-1.5:LRA=11` or single-pass `dynaudnorm`.                                                                                                                                                                                                                        |
| `ducking`      | `boolean` \| object                                                | Music ducking via `sidechaincompress` when source audio is present.                                                                                                                                                                                                                 |
| `musicFade`    | `number` 0.05..3 seconds (default: the global transition duration) | Length of the music cross-fade (`acrossfade`) between sections, independent of the video transition. Longer values smooth large per-section `musicVolume` changes. Clamped to half the shortest renderable section's duration so a short section can't be entirely crossfaded away. |

`ducking` as an object: `{ threshold? (0..1, default 0.05), ratio? (1..20, default 8), attack? (ms, default 20), release? (ms, default 400) }`.

**Section audio fades** — `options.audioFade`: `{ in?: { duration, curve? }, out?: { duration, curve? } }`, compiled to `afade`. `duration` is in seconds; `curve` is an FFmpeg afade curve (`tri` default).

**Section audio effect** — `options.audioEffect`: `'echo' | 'telephone' | 'muffled'`, a voice-effect preset appended to the section's `-af` chain **before** any `audioFade` entries (so fades still ramp the already-effected signal in/out). Skipped entirely when the section is muted (`muteSection: true`).

| Value       | Compiles to                     |
| ----------- | ------------------------------- |
| `echo`      | `aecho=0.8:0.7:60:0.4`          |
| `telephone` | `highpass=f=300,lowpass=f=3400` |
| `muffled`   | `lowpass=f=1200`                |

> `speed` ≠ 1 retimes audio via `atempo`, which is **clamped to `[0.5, 2]`**. Outside that range, video and audio can desync — split into multiple `atempo` stages or avoid extreme speeds.

## Layers

`color_background` sections can stack composited `layers` on top of the base colour (drawn as boxes / gradients). Ordered; each:

```jsonc
{
  "color": "#0d1b2a", // solid fill (CSS hex / FFmpeg colour name)
  "opacity": 0.8, // 0..1, default 1
  "x": 0,
  "y": 0, // offset (px or FFmpeg expr), default 0
  "w": 1280,
  "h": 150, // size (px or FFmpeg expr), default full output
  "gradient": {
    // optional; overrides `color`
    "from": "#13243f",
    "to": "#0d1b2a",
    "direction": "vertical", // horizontal | vertical | diagonal (default vertical)
  },
}
```

## Framing guide

`project_video` sections may declare `options.framingGuide` — a **recording-UI overlay only**. It guides the user while filming and is **never rendered into the output video**:

```jsonc
{ "type": "silhouette", "position": "center", "opacity": 0.5 }
```

`type` is always `silhouette`; `position` is `left` | `center` | `right`; `opacity` 0..1 (default 0.5).

## Chroma key

A native visual section (`video`, `project_video`, `image_background`, `color_background`) may declare a `chromaKey` block to **key out a solid screen colour** (green/blue screen) and composite the clip over a flat background colour. The section inverts internally to a colour base + a keyed-clip overlay (`colorkey` → `format=rgba` → `overlay`).

```jsonc
{ "color": "#00b140", "similarity": 0.3, "blend": 0.1, "background": "#101418" }
```

| Field        | Type             | Description                                                                             |
| ------------ | ---------------- | --------------------------------------------------------------------------------------- |
| `color`      | hex (required)   | The screen colour to remove.                                                            |
| `similarity` | `number` 0.01..1 | How close a pixel must be to `color` to be keyed (default ~0.3).                        |
| `blend`      | `number` 0..1    | Edge softness between kept and keyed pixels (default 0).                                |
| `background` | hex              | Flat colour composited behind the keyed clip (default the section's `backgroundColor`). |

`colorkey` is LGPL and present on every backend; a backend without it drops the key with a warning (the clip renders un-keyed) rather than aborting. v1 keys over a **solid colour only** (no simultaneous background image / animation overlay on the same section).

## Captions

A section's `caption` field renders a styled lower-third / overlay as a `drawtext` filter — burned into the video (unlike the framing guide). A `style` preset sets the base look; the other fields override it.

```jsonc
{ "text": { "en": "Design is how it works" }, "style": "bar", "position": "lower-third", "align": "center" }
```

| Field                             | Type          | Description                                                                     |
| --------------------------------- | ------------- | ------------------------------------------------------------------------------- |
| `text`                            | `Translation` | Localised caption text (required).                                              |
| `style`                           | preset        | Visual preset (default `bar`).                                                  |
| `position`                        | enum          | Vertical placement (default `lower-third`).                                     |
| `align`                           | enum          | Horizontal alignment (default `center`).                                        |
| `font` / `fontsize` / `color`     | overrides     | Override the preset's font (see [Fonts](#fonts)), size (px), colour (hex).      |
| `box` / `boxColor` / `boxOpacity` | box style     | Background box behind the text, its colour (hex) and opacity (0..1).            |
| `reveal`                          | `Reveal`      | Animated entrance (see [Reveal](#reveal)).                                      |
| `effect`                          | `TextEffect`  | Drop shadow / outline for legibility (see [Text legibility](#text-legibility)). |

## Fonts

`font` accepts three forms anywhere a text sugar takes one (`caption`, `titleCard` line styles, `global.overlays`):

| Form                          | Resolved                       | Example                                        |
| ----------------------------- | ------------------------------ | ---------------------------------------------- |
| Bundled registry id           | bundled, else catalog (cached) | `"font": "bebas"`                              |
| Raw `.ttf` filename           | bundled / catalog, else remote | `"font": "Oswald.ttf"`                         |
| `{ family, weight?, style? }` | Google Fonts (cached)          | `"font": { "family": "Inter", "weight": 700 }` |

The object form names any Google Fonts family, including multi-word ones, and picks an exact weight
(`100`–`900` in steps of 100, default `400`) and `style` (`normal` / `italic`, default `normal`):

```json
{ "caption": { "text": { "en": "Hello" }, "font": { "family": "Playfair Display", "weight": 700, "style": "italic" } } }
```

It is deliberately a different _shape_ from the string forms rather than another string: a typo in a
registry id (`"bebbas"`) stays a local `unknown_font` validation error instead of becoming a network
lookup that fails mid-render. The trade-off is that a family name is **not** checked at validation
time — there is no offline copy of Google's catalogue — so a family that does not exist surfaces as a
resolution error during the render, naming the family.

**Staging order.** A font is resolved from the cheapest source first: already staged → bundled with
the package → a persistent on-disk cache → the catalog → Google Fonts. A font that cannot be resolved
**fails the render**; it is never skipped, because a missing font does not stop `drawtext` — it just
draws with the wrong face, so the only symptom would be a silently wrong video.

**Caching.** A face resolved by family, and a catalog font, is copied into `~/.cache/leclap/fonts`
(override with `FVC_FONT_CACHE_DIR`), which outlives the build directory, so a repeat render of the
same font needs no network and does not re-hit Google's rate limit. Entries are written atomically, so
renders sharing the cache never read a half-written face. A raw filename resolved from Google is not
cached: its face is guessed from the file stem (the weight in `Roboto-Bold.ttf` is ignored).

**Platform support.** Resolving a font by family requires sending a legacy `User-Agent` — Google keys
the response format off it and otherwise returns woff2, which `drawtext` cannot read. Node and Expo
can do this; a browser cannot override the header, so the browser/WASM backend rejects the object form
up front, before rendering, with an explanatory error. Web apps should ship the fonts they need instead.

## Text legibility

Every text sugar (`caption`, `titleCard`, `lowerThird`, `global.overlays`) takes an optional `effect` — a drop shadow and/or an outline that the engine lowers onto the `drawtext` (`shadowx`/`shadowy`/`shadowcolor` and `borderw`/`bordercolor`). Both are core libfreetype, present on every backend, so text stays readable over busy footage without hand-writing the options.

```jsonc
"effect": { "shadow": true, "outline": true }
"effect": { "shadow": { "color": "#000000@0.6", "dx": 2, "dy": 2 }, "outline": { "color": "#101010", "width": 3 } }
```

| Field     | Shorthand                    | Object form                         |
| --------- | ---------------------------- | ----------------------------------- |
| `shadow`  | `true` → `#000000@0.6` @ 2,2 | `{ color?, dx?, dy? }` (px offsets) |
| `outline` | `true` → `#000000` width 2   | `{ color?, width? }` (px)           |

## Reveal

Every text sugar (`caption`, `titleCard`, `lowerThird`, `global.overlays`) takes an optional `reveal` — an animated entrance that the engine lowers into the `drawtext` `alpha`/`x`/`y` `t`-expressions you used to hand-write. Author it as a bare string or an object with timing:

```jsonc
"reveal": "rise"
"reveal": { "type": "slide-left", "delay": 0.3, "duration": 0.6, "distance": 60 }
```

| Type          | Effect                                               |
| ------------- | ---------------------------------------------------- |
| `none`        | No entrance (static).                                |
| `fade`        | Fades in over `duration`.                            |
| `rise`        | Rises up into place from `distance` px below + fade. |
| `slide-left`  | Enters from the right (+fade).                       |
| `slide-right` | Enters from the left (+fade).                        |

`delay` (s, default 0.3, ≥0), `duration` (s, default 0.6, >0), `distance` (px, default 60, >0, rise/slide only). Optional `easing` is `linear` (default), `ease-out` (cubic-out), `ease-in-out` (smoothstep), or `ease-out-back` (about 10% travel overshoot). It curves text travel and alpha; back easing clamps alpha to 0..1 while allowing position to overshoot. In `titleCard`/`lowerThird` the lines enter top-to-bottom. Title cards accept `stagger` (seconds, 0..1, default 0.15) between non-empty lines; zero reveals them together. Empty lines consume no stagger slot, and the accent bar follows its associated emitted line. Lower thirds retain the fixed 0.15-second stagger.

## Exit

A positioned text overlay (a `drawtext` filter on a section, as the builder emits) also takes an optional `exit` — an animated **departure** that the engine bakes alongside the entrance onto the same `drawtext` (the combined alpha is `enterFade × exitFade`, and the position eases from any entrance offset out to the exit offset). Same vocabulary as `reveal`; author it as a bare string or an object with timing:

```jsonc
"exit": "fade"
"exit": { "type": "slide-left", "after": 2.5, "duration": 0.6, "distance": 60, "easing": "ease-out" }
```

The types match `reveal` (`none`/`fade`/`rise`/`slide-left`/`slide-right`). The one extra field is **`after`** — seconds from the section start when the exit begins; omit it and the engine times the exit to **end at the section's end**. `duration` (s, default 0.6, >0), `distance` (px, default 60, >0, rise/slide only) and `easing` (`linear`/`ease-out`/`ease-in-out`/`ease-out-back`, default `linear`) behave as for `reveal`. `after` must be ≥0. Rise exits travel upward, slide-left exits travel left and slide-right exits travel right. Omitted easing preserves historical output. Exits remain positioned `drawtext` controls; caption/titleCard/lowerThird blocks do not gain an `exit` field.

## Title cards

A `color_background` section takes a section-level `titleCard` that collapses the kicker / headline / accent bar / subtitle / fade boilerplate into one block. Positions and sizes are derived from the output scale, so one card renders correctly in any orientation.

```jsonc
{
  "name": "intro",
  "type": "color_background",
  "options": { "backgroundColor": "#0d1b2a", "duration": 2.6 },
  "titleCard": {
    "kicker": { "en": "ON THE RECORD" },
    "headline": { "en": "{{ form_1_name }}" },
    "subtitle": { "en": "{{ form_1_title }}" },
    "accent": "#7C83FD",
    "reveal": "rise",
  },
}
```

| Field                          | Type             | Description                                                                               |
| ------------------------------ | ---------------- | ----------------------------------------------------------------------------------------- |
| `kicker`/`headline`/`subtitle` | `Translation`    | The three lines (all optional; emit only what has text).                                  |
| `accent`                       | hex              | Draws an underline bar and tints the kicker.                                              |
| `align`                        | `left`\|`center` | Horizontal alignment (default `left`).                                                    |
| `background`                   | hex              | Fade colour (defaults to the section background).                                         |
| `stagger`                      | number           | Seconds between non-empty line entrances, 0..1 (default 0.15); zero starts them together. |
| `reveal`                       | `Reveal`         | Staggered entrance for the lines (default `rise`).                                        |
| `fade`                         | `{ in?, out? }`  | Auto fade-in / fade-out over the card (both default on; set `out: false` on an outro).    |

## Lower thirds

Any visual section takes a `lowerThird` — a title/subtitle band over the clip with an optional right-aligned badge. It composites **on top** of any animation overlay (no `maps`/`@name` ceremony needed). `accent` and `boxOpacity` are separate fields so you never write `{{ var }}@alpha` by hand.

```jsonc
"lowerThird": {
  "title": { "en": "{{ form_1_name }}" },
  "subtitle": { "en": "{{ form_1_tagline }}" },
  "badge": { "en": "{{ form_1_price }}" },
  "accent": "#7C83FF", "reveal": "rise"
}
```

| Field              | Type            | Description                                           |
| ------------------ | --------------- | ----------------------------------------------------- |
| `title`/`subtitle` | `Translation`   | The two lines (optional).                             |
| `badge`            | `Translation`   | Optional right-aligned pill (a price, a step number). |
| `accent`           | hex             | Accent bar + badge background.                        |
| `boxOpacity`       | 0..1            | Legibility band opacity (default 0.6; `0` = no band). |
| `position`         | `bottom`\|`top` | Vertical anchor (default `bottom`).                   |
| `reveal`           | `Reveal`        | Staggered entrance (default `rise`).                  |

## Global decorations

Whole-video text/colour, the sibling of `global.animations`: authored once in `global`, applied to every section (or a named subset). A brand watermark authored once instead of re-drawn per section.

```jsonc
"global": {
  "overlays": [
    { "text": { "en": "{{ brand }}" }, "position": "top-right", "color": "#ffffff", "reveal": "fade" }
  ],
  "look": "cinematic"
}
```

`global.overlays[]` — each: `text` (Translation), `position` (`top-left`/`top-right`/`bottom-left`/`bottom-right`/`top`/`bottom`/`center`, default `top-right`), `font`/`size`/`color`/`opacity`, `reveal`, and `sections?` (array of section names to limit it to). `global.look` / `global.grade` apply a whole-video colour grade. (`global.grade` is bypassed on a section that already has an animation-overlay graph — apply per-section `grade` there instead.)

## Overlay inputs (animations & images)

`inputs[]` composites overlays on top of a section. Each input is one of two `type`s — `animation` (a single-file animated input) or `image` (a single still picture). Both share the same `position`/`scale` placement convention and composite in array order (later entries paint on top), so a section can carry any number of them — e.g. a branded backdrop, a logo, and a confetti animation at once.

### `type: "animation"`

An animation is **one** single-file animated input. **APNG** and **WebM** (VP9 with alpha) are the two recommended formats — APNG decodes natively on every platform (incl. on-device) with lossless alpha; WebM is much smaller. `.webp` and `.gif` also work:

```jsonc
{
  "name": "confetti",
  "url": "{{ confettiUrl }}", // e.g. "animations/confetti.apng"
  "type": "animation",
  "options": {
    "fps": 25, // informational; the file's own frame rate governs playback
    "position": "0:0", // overlay "x:y" in output px
    "scale": "640:-1", // pre-composite scale "w:h"
    "opacity": 0.6, // 0..1, default 1 — fades the whole overlay
    "loop": true, // → -stream_loop -1 (play for the whole section)
    "loops": 3, // OR a finite play count → -stream_loop {N-1} (overrides loop)
    "duration": 8, // OR seconds the overlay plays → -t 8 (overrides loops/loop)
    "start": 3, // delay before it appears, seconds → -itsoffset 3 (default 0)
    "persistent": true, // → eof_action=repeat (holds last frame past EOF)
    "rotation": 0, // clockwise degrees applied before compositing (default upright)
    "motion": "rise", // animated entrance, reuses the Reveal vocabulary (see below)
  },
  "filters": [/* optional raw chain on this input before compositing */],
}
```

**Playback extent** — set exactly one of `loop` (forever), `loops` (a finite play count), or `duration` (seconds); precedence is `duration` > `loops` > `loop`. `start` delays the overlay (`-itsoffset`, default 0). `persistent` maps to `eof_action=repeat` (freeze the last frame once the overlay ends, instead of letting the video show through). `opacity` < 1 fades the leg via `colorchannelmixer=aa`. Reference an input by `@name` from a `maps[]` entry.

**Motion** — `options.motion` gives the overlay an animated entrance, reusing the [Reveal](#reveal) vocabulary (`fade`/`rise`/`slide-left`/`slide-right`, or an object with `delay`/`duration`/`distance`). It compiles to time-expressions on the `overlay` `x`/`y` (and the leg's fade for `fade`), so a logo or animation can slide / rise / fade into place. Available on both `animation` and `image` inputs.

### `type: "image"`

A still picture (PNG/JPG/WebP) composited over the section — a backdrop, watermark, or logo. It is held for the section's full duration (`-loop 1`) and placed with the same `position`/`scale` as an animation. The builder names these `image_0`, `image_1`, … by their array order:

```jsonc
{
  "name": "image_0",
  "url": "{{ logoUrl }}", // e.g. "pictures/logo.png", or a library:// / media:// marker (web/expo)
  "type": "image",
  "options": {
    "position": "40:40", // overlay "x:y" in output px
    "scale": "160:-1", // pre-composite scale "w:h" (-1 keeps aspect)
    "opacity": 0.9, // 0..1, default 1
    "rotation": 0, // clockwise degrees (default upright)
    "motion": "slide-left", // animated entrance — same Reveal vocabulary as an animation overlay
  },
}
```

In the template builder, each image is picked from the bundled library or uploaded, then **dragged to position and resized** on the preview frame — exactly like an animation overlay. It takes the same `opacity`/`rotation`/`motion` options too.

## Whole-video animations

`inputs[]` overlays are scoped to one section — they restart at every section. To run an overlay **continuously across the whole video** (a border that holds through intro → clip → outro, a drifting light leak, a grain layer), declare it under `global.animations[]`. The engine composites these once over the **final joined video** — after the sections are concatenated, before music is mixed — so the same mechanism that lets music span the whole video lets an animation span it too.

```jsonc
"global": {
  "animations": [
    {
      "url": "animations/light_leak.apng", // animated: .apng/.webp/.gif/.webm (stream-looped); still: .png/.jpg/.jpeg (-loop 1, always spans the whole video — start/duration gate its VISIBLE window, not its loop). May use {{ varName }}.
      "duration": 8,        // play for 8s (omit for `loop: true` to span the whole video)
      "start": 3,           // delay before it appears, seconds (default 0)
      "opacity": 0.35,      // 0..1, default 1 — fade the overlay
      "position": "0:0",   // overlay "x:y" in output px (default top-left)
      "scale": "1280:720", // pre-composite scale "w:h" (-1 keeps aspect)
      "rotation": 0,        // clockwise degrees (default upright)
      "persistent": false   // freeze last frame on end vs. let the video show through
    }
  ]
}
```

Each entry takes the same placement/playback options as a section animation input (`position`/`scale`/`opacity`/`rotation`, the playback extent `loop`/`loops`/`duration`, and `start`/`persistent`), minus `name`/`type`/`maps`. They composite in array order (later entries paint on top of earlier ones, on top of every section). A whole-video overlay sits **above** everything, including a section's own `maps[]` composite — for an overlay that must sit _under_ a section's drawn elements, keep it as a section input. The builder exposes these in its **Style & audio** step as "Whole-video animations".

## Watermark

`global.watermark` is authoring-time sugar for the single most common whole-video overlay: a still logo pinned to a corner for the entire video. It is pure sugar over `global.animations` — it lowers into one entry (`watermarkToAnimation`, prepended so any explicit `global.animations[]` entry still composites on top of it) and needs no dedicated engine support of its own.

```jsonc
"global": {
  "watermark": {
    "url": "pictures/logo.png", // png/jpg watermark image; may use {{ varName }}
    "position": "bottom-right", // top-left / top-right / bottom-left / bottom-right (default bottom-right)
    "scale": 0.12,              // fraction of the output WIDTH, 0.02..0.5 (default 0.12)
    "opacity": 0.8,             // 0..1 (default 0.8)
    "margin": 24                // inset from the frame edges in output px, 0..200 (default 24)
  }
}
```

`scale` resolves against the project's output width into a pixel width emitted as `"<px>:-1"` (aspect-preserving); `position` resolves to the corner's overlay `x:y` expression (e.g. bottom-right → `"W-w-<margin>:H-h-<margin>"`). Exactly one watermark per template — it is authoring-time only (no end-user override) and always spans the whole video (no `start`/`duration`).

## Maps

`maps[]` wires the FFmpeg filtergraph explicitly — only needed for multi-input / overlay sections beyond what the sugar covers.

| Field     | Type                              | Description                                                                                 |
| --------- | --------------------------------- | ------------------------------------------------------------------------------------------- |
| `inputs`  | `string[]`                        | Ordered input stream labels feeding this graph. `@name` resolves to an input/animation pad. |
| `outputs` | `string[]`                        | Ordered output labels; the **final** map's last output **must end with `final`**.           |
| `filters` | `Filter[]`                        | Filter chain between inputs and outputs.                                                    |
| `options` | `{ useSectionFilters?: boolean }` | When true, the section-level `filters` run inside this map's chain.                         |

## Filters

`filters[]` is the **raw FFmpeg escape hatch** — each entry is passed through verbatim:

For a hand-framed scene, a final `{ "type": "scale", "value": "output" }` is a LeClap shorthand: aspect-preserving scale and pad to the project's actual `videoConfig.scale`, then square pixels (`setsar=1`). It prevents a fixed-size custom frame from breaking concatenation when output orientation or resolution changes. Padding is black. Other `scale` values remain raw FFmpeg arguments.

| Field    | Type               | Description                                                                                           |
| -------- | ------------------ | ----------------------------------------------------------------------------------------------------- |
| `type`   | `string`           | Raw FFmpeg filter name (`drawtext`, `drawbox`, `fade`, `vignette`, `boxblur`, `overlay`, `scale`, …). |
| `value`  | `string \| number` | Single scalar arg for simple filters.                                                                 |
| `values` | `FilterValues`     | Structured args — **FFmpeg-native keys** (see below).                                                 |
| `range`  | `string`           | Active window as `"start:end"` in seconds.                                                            |
| `reveal` | `Reveal`           | Animated entrance for positioned `drawtext` (see [Reveal](#reveal)).                                  |
| `exit`   | `Exit`             | Animated departure for positioned `drawtext` (see [Exit](#exit)).                                     |

`values` keys (kept FFmpeg-native **by design**): `x`, `y`, `w`, `h`, `c`, `t`, `text` (a `Translation`), `fontcolor`, `fontsize`, `fontfile`, `alpha`, `d`, `st`, `color`, `box`, `boxcolor`, `boxborderw`, `shadowcolor`, `shadowx`, `shadowy`, `bordercolor`, `borderw`, `enable`.

`text`, `title`, `description`, and form-field `label` are `Translation` objects (`{ "en": "…", "fr": "…" }`) for i18n.

## Variables & placeholders

- **`global.variables`** — `string` or `string[]`; reference anywhere with `{{ name }}`. Resolved by `VariableManager`.
- **`{{ colorN }}`** — 1-indexed into `global.colorsList`.
- **`{{ form_field }}`** — a `form` section's field `name`, filled at compose time.

---

## Example: simple (cuts, music)

A minimal, complete, valid descriptor — two clips joined by hard cuts with a background track.

```json
{
  "global": {
    "orientation": "landscape",
    "musicEnabled": true,
    "music": { "name": "air-prelude.mp3" },
    "audio": { "sourceVolume": 1, "musicVolume": 0.5 }
  },
  "sections": [
    {
      "name": "intro",
      "type": "color_background",
      "transition": { "type": "cut" },
      "options": { "backgroundColor": "#0d1b2a", "duration": 2 },
      "filters": [
        {
          "type": "drawtext",
          "values": {
            "text": { "en": "My Story" },
            "fontcolor": "#ffffff",
            "fontsize": 96,
            "x": "(w-text_w)/2",
            "y": "(h-text_h)/2",
            "fontfile": "BebasNeue.ttf"
          }
        }
      ]
    },
    {
      "name": "clip",
      "type": "video",
      "options": { "videoUrl": "{{ clip }}", "duration": 6 },
      "filters": [
        { "type": "fadein", "values": { "color": "#0d1b2a" } },
        { "type": "fadeout", "values": { "color": "#0d1b2a" } }
      ]
    }
  ]
}
```

(Declare `clip` in `global.variables`, or pass it at compose time.)

## Example: rich (transition + look + motion + audio + layers)

A complete, valid descriptor exercising the structured-sugar layer: a layered title card that wipes into a Ken-Burns still and a graded camera clip, with ducked, normalised audio.

```json
{
  "global": {
    "orientation": "landscape",
    "musicEnabled": true,
    "music": { "name": "air-prelude.mp3" },
    "transition": { "type": "fade", "duration": 0.4 },
    "audio": {
      "sourceVolume": 1,
      "musicVolume": 0.5,
      "normalize": "loudnorm",
      "ducking": { "threshold": 0.05, "ratio": 8 }
    }
  },
  "sections": [
    {
      "name": "title",
      "type": "color_background",
      "title": { "en": "Title card" },
      "transition": { "type": "wipeleft", "duration": 0.4 },
      "options": {
        "backgroundColor": "#0d1b2a",
        "duration": 2.4,
        "audioFade": { "in": { "duration": 0.6, "curve": "qsin" } },
        "layers": [
          { "color": "#13243f", "opacity": 1, "x": 0, "y": 0, "w": 1280, "h": 150 },
          {
            "x": 0,
            "y": 570,
            "w": 1280,
            "h": 150,
            "gradient": { "from": "#13243f", "to": "#0d1b2a", "direction": "vertical" }
          }
        ]
      },
      "filters": [
        {
          "type": "drawtext",
          "values": {
            "text": { "en": "PRESENTING" },
            "fontcolor": "#e8eef7",
            "fontsize": 30,
            "x": "(w-text_w)/2",
            "y": 250,
            "fontfile": "Oswald.ttf"
          }
        }
      ]
    },
    {
      "name": "still",
      "type": "image_background",
      "transition": { "type": "fade", "duration": 0.4 },
      "options": { "pictureUrl": "{{ photo }}", "duration": 3 },
      "look": "cinematic",
      "grade": { "contrast": 1.1, "saturation": 1.2 },
      "motion": [{ "type": "kenburns", "direction": "in", "intensity": 1.2 }]
    },
    {
      "name": "clip",
      "type": "project_video",
      "title": { "en": "Record your clip" },
      "options": {
        "duration": 30,
        "forceAspectRatio": true,
        "framingGuide": { "type": "silhouette", "position": "center", "opacity": 0.5 }
      },
      "look": "warm",
      "grade": {
        "brightness": 0.02,
        "saturation": 1.15,
        "colorBalance": { "highlights": { "r": 0.05, "b": -0.05 } }
      },
      "filters": [{ "type": "vignette" }]
    }
  ]
}
```

> Note: no transition is declared on the **last** rendering section (`clip`) — a non-`cut` one there would be rejected (`dangling_transition`). Each declared transition duration (0.4 s) is shorter than the smaller adjacent `duration`, satisfying `transition_too_long`. `kenburns` sits on an `image_background`, satisfying `motion_unsupported_section`.

## Validating

Run a descriptor through `TemplateValidator` (zod + the cross-field rules above). On failure, zod reports the exact path/field — fix the JSON to match the schema. Cross-field rules also flag: a whole-video animation with no url (`global_animation_missing_url`) and a `caption`/`global.overlays` `font` string that is neither a bundled id nor a `.ttf` filename (`unknown_font` — a typo would otherwise silently fall back to the default font; the `{ family }` object form is checked at render time instead, see [Fonts](#fonts)). After editing any `.json`, run `pnpm fmt`. To regenerate the machine-readable schema after a zod change: `pnpm --filter ffmpeg-video-composer generate:schema`.

## Migrating older templates

| Old field                                       | Replacement                                                                          |
| ----------------------------------------------- | ------------------------------------------------------------------------------------ |
| `global.audioVolumeLevel`                       | `global.audio.sourceVolume`                                                          |
| `global.transitionDuration`                     | `global.transition.duration` (with `transition.type`)                                |
| `options.musicVolumeLevel`                      | `options.musicVolume`                                                                |
| `inputs[].frames` / `frequency` / `overlay`     | removed — use a single `animation` input (`.apng`/`.webp`/`.gif`/`.webm`)            |
| `inputs[].type: "frame"`                        | removed — use `type: "animation"`                                                    |
| ZIP frame-sequence animation (`url: "…/x.zip"`) | removed — convert to a single-file animation (`.apng` recommended); see MIGRATION.md |

Other breaking changes:

- **Durations are now seconds everywhere.** Previously, `project_video` `options.duration` was in **milliseconds**; now it is **seconds** (e.g. `30000` → `30`). All other durations were already seconds.
- Transitions are now structured: a bare `transitionDuration` becomes a `transition` object (`{ type, duration }`) on `global` and/or per section. A template that relied on an implicit cross-fade should set `global.transition` explicitly, or `{ "type": "cut" }` for hard cuts.
- The structured-sugar layer (`look`, `grade`, `motion`, `audio`, `layers`, `framingGuide`) is new — older templates remain valid without it.

## Registered JSON effects (desktop authoring)

See the [complete effect configuration reference](./effects-configuration.md) for every built-in/example prop, default, bound, asset slot, timing rule and registration workflow.

An `effect` section references a versioned, registered graphics implementation while its editable controls remain ordinary JSON. The execution caller resolves effects into `project_video` clips before invoking the existing FFmpeg engine. The core exports `resolveTemplateEffects(template, renderer, { preflight })` for library consumers; it does not import Remotion or launch Chromium.

```json
{
  "name": "intro",
  "type": "effect",
  "effect": {
    "id": "leclap.title-reveal",
    "version": "1.0.0",
    "props": {
      "headline": "LECLAP",
      "headlineY": 320,
      "logoDelayFrames": 15,
      "entranceDurationFrames": 24,
      "springDamping": 18
    },
    "assets": {
      "background": "/absolute/path/to/media/background.mp4",
      "logo": "/absolute/path/to/media/logo.png",
      "font": "/absolute/path/to/media/font.ttf"
    }
  },
  "options": { "duration": 10 }
}
```

Effect IDs and exact semantic versions are required; props contain JSON values only. The core validates the reference contract, while the registered backend validates its specific props, asset slots and runtime support. Every effect is preflighted before effect rendering begins. Resolution preserves section filters, transitions and compositing options.

The Node MCP backend includes `leclap.title-reveal@1.0.0` (`LeclapTitle`) and `leclap.web-app-promo@1.0.0` (`LeclapWebAppPromo`), plus operator-registered effects from a configured catalog. Discover the available effects with `get_effect_schema` and `{ "list": true }`, then request an exact id/version to inspect prop defaults/bounds, asset slots and runtime requirements. The current output contract is 1280×720, 30 fps, 300 frames (10 seconds). Enable the Remotion opt-in and configure a trusted entry; see [the runnable example](../examples/llm-remotion-title). The example paths above are placeholders: replace them with absolute regular local files contained under the configured media directory, including a background video at least 10 seconds long for the title effect. Inspect selected frames or a short range with `render_preview` before `compose_video`. This is desktop rendering; native/browser callers may consume the resulting compatible clip but do not execute React code locally.

Calling the core compile API with an unresolved effect reports `effect_backend_unavailable` before platform initialization. Ordinary templates are unchanged. Library consumers can provide another trusted renderer/preflight callback to the generic resolution API; MCP operators can register bounded JSON prop and asset contracts in their configured catalog.

Configure the MCP entry, browser, catalog, media root, timeout and cache through its startup flags,
not effect props or `ProjectConfig`. See [registered-effect configuration](./engine-configuration.md#registered-effects-and-mcp-runtime).
Use expanded effect section names, including partial prefixes, for preview and patch requests.
`patch_template` preserves inline partial authoring and materializes only a selected registry instance;
other references and the shared definition remain unchanged. JSON revisions guard edits, while
render provenance records observed inputs; neither guarantees identical bytes across hosts.

For reproducibility, retain the JSON, exact implementation/dependencies, resolved assets/fonts and render settings. JSON syntax alone does not guarantee identical pixels across rendering backends or identical encoded bytes.
