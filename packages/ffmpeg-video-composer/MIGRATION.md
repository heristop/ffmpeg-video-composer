# Upgrading from v2 to v3

v3 keeps the same API and entry points: `compile(projectConfig, template)`, `loadConfig(path)`, the
`/browser`, `/reactnative` and `/samples` exports, and every name they exported in v2.5 are unchanged. Two
things are breaking: validation is stricter, so `compile()` can reject a template that v2.5 rendered, and
renders are no longer byte-identical to v2.5. Everything else in the release is additive (see the
[changelog](./CHANGELOG.md)).

## TL;DR

- **Validate your templates before upgrading** with `new TemplateValidator().validateTemplate(template)`
  or `leclap validate <template.json>`. `compile()` validates by default (the browser and React Native
  entries always do), so a template that fails validation now fails to compile.
- **Stray keys are errors now.** A key the schema does not declare is reported as `unknown_key`, even on
  objects that v2.5 silently trimmed. Most are typos; the finding names the key to use instead.
- **Text in a bundled font must be drawable by that font.** Missing characters fail with
  `font_missing_glyphs` instead of rendering as empty boxes.
- **Re-pin goldens and checksums.** The deterministic encoder profile is on by default and several
  renderers changed (below), so output bytes differ from v2.5 even for unchanged templates.
- **No Node or dependency change** for consumers: still Node `>=24.11.0`, and `zod` is still a regular
  dependency.

## Stricter validation

### Unknown keys (`unknown_key`)

v2.5 rejected unknown keys on strict objects but let many others through: discriminated unions such as
`sections[]` options, transitions, wrappers and pipes trimmed them silently, so a typo simply did
nothing. v3 walks the schema and reports every one of them:

```jsonc
// v2.5: `length` was dropped silently and the transition used its default duration.
// v3:   unknown_key at sections.0.transition.length, suggestion "duration".
"transition": { "type": "fade", "length": 0.5 }
```

Each finding carries a `suggestion` (the closest allowed key at that path) and a `kind`. `format`
findings are mechanical renames that are safe to apply as-is; `judgement` findings (for instance when the
suggested key is already set) need a person to decide. Keys starting with `$` or `_` are treated as
comments, and free-form maps (translations, `global.variables`, effect `props`/`assets`, motion tokens,
raw filter `values`) are never checked. See [validation findings](../../docs/template-configuration.md#validation-findings).

To list what to fix in a batch of templates:

```ts
import { TemplateValidator } from 'ffmpeg-video-composer';

const result = new TemplateValidator().validateTemplate(template);

for (const error of result.errors ?? []) {
  console.log(error.code, error.path, error.suggestion ?? '', error.kind ?? '');
}
```

### Missing glyphs (`font_missing_glyphs`)

Text drawn with a bundled font (captions, title cards, lower thirds, `drawtext` filters, global overlays,
kinetic blocks) is checked against the font's character coverage for every locale. A character the font
cannot draw now fails validation, with a `hint` naming a bundled font that covers it (or a font family to
use instead, for scripts no bundled font covers). See [glyph coverage](../../docs/template-configuration.md#glyph-coverage-font_missing_glyphs-emoji_unsupported).

### Opting out

On Node, `compile({ ...projectConfig, skipValidation: true }, template)` still renders without
validating. Keep it for trusted, generated templates you cannot change yet: an unknown key is ignored
exactly as before, and a missing glyph renders as an empty box.

### Raw filters that read the clock or `random()`

These are **not** errors. Raw `filters[]` using `%{localtime}`, `%{gmtime}`, `time(…)` or `random(…)`
render as before and raise the advisory `nondeterministic_expression` from
`TemplateValidator.getMotionWarnings()`: two renders of such a template differ, so the preview may not
match the export and the section cache and `leclap verify` cannot vouch for it.

## Different render output

Nothing to change in templates, but expect different bytes, and in a few places a different picture:

| Change                                      | Effect                                                                                                                                    | Opt out                                                                |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Deterministic encoder profile on by default | Bit-exact muxing, pinned libx264 threads, no inherited metadata: the same template renders to the same bytes on a given platform          | `ProjectConfig.deterministic: false` (`--no-deterministic` in the CLI) |
| Constant frame rate per section             | Each section chain is conformed to CFR, so animation times land on exact frames and phone footage with a variable frame rate cannot drift | —                                                                      |
| Sub-pixel zooms                             | Ken Burns and pulse zooms no longer step a pixel at a time                                                                                | —                                                                      |

If you compare renders against stored goldens or checksums, render each template once with v3 and store
the new output. With the deterministic profile on, later renders on the same platform match it byte for
byte.

## Still the same

- `compile`, `loadConfig` and every v2.5 export, with the same signatures.
- The `{ global, sections }` descriptor shape. Every new field in v3 is optional.
- The browser and React Native entries, and their adapters.
- Node `>=24.11.0`.

---

# Upgrading from v1 to v2

The npm package name is **unchanged** — you still install `ffmpeg-video-composer`.
The `le-clap` → `leclap` rename in this release was internal to the monorepo
(directories and `@leclap/*` workspace scopes) and is **invisible to consumers**
of the published package. The `compile` / `loadConfig` API is the same.

## TL;DR

- **API is unchanged** — `compile(projectConfig, template)` and `loadConfig(path)`
  keep the same signatures.
- **Node `>=24.11.0`** is now required (was `>=22.14.0`).
- **New entry points** — `/browser` and `/reactnative` exports (the CLI now lives in `@leclap/cli`).
- **The template descriptor grew a lot** — colour grading, motion, captions,
  per-section transitions, partials, background layers, and an audio mix block.
  All of it is **additive**: existing templates keep working.
- **Six fields were renamed.** A v1 template still compiles (compile does not
  validate), but the old names are now **silently ignored** — so the affected
  settings quietly fall back to defaults. Rename them, or validate with the new
  `TemplateDescriptorSchema` to catch them (see [Template descriptor](#template-descriptor)).

## Node version

`engines.node` now requires **Node `>=24.11.0`** (v1 required `>=22.14.0`).
Upgrade your runtime; the package will refuse to install on older Node.

## Package layout / entry points

| Concern       | v1               | v2                                                 |
| ------------- | ---------------- | -------------------------------------------------- |
| CLI binary    | (none published) | moved to the `@leclap/cli` package (`leclap` bin)  |
| Browser entry | (none)           | `ffmpeg-video-composer/browser`                    |
| RN entry      | (none)           | `ffmpeg-video-composer/reactnative`                |
| `compile.js`  | shipped script   | removed — use `@leclap/cli render`                 |
| `diagnose.js` | shipped script   | removed — use `@leclap/cli diagnose`               |
| `./src/index` | available        | dropped (`.`, `./browser`, `./reactnative` remain) |

The default `.` import is unchanged:

```js
import { compile, loadConfig } from 'ffmpeg-video-composer';
```

## Template descriptor

The `{ global, sections }` shape is the same, and **`compile()` does not validate**
— it just reads the fields it knows. That has one consequence worth underlining:
a v1 template **will not throw**, but anywhere a field was renamed, v2 reads the
new name, misses the old one, and uses the **default**. Symptoms are silent:
music at `0.5` instead of your level, the wrong animation cadence, no transition.

### Renamed fields — do these or the setting is dropped

| v1                                 | v2                            | Notes                                                                                                                  |
| ---------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `global.audioVolumeLevel`          | `global.audio.sourceVolume`   | Moved into the new `audio` block (alongside `musicVolume`, `normalize`, `ducking`).                                    |
| `global.transitionDuration`        | `global.transition.duration`  | Now an object — add a `type` (e.g. `{ type: 'dissolve', duration: 0.5 }`). Also unlocks per-section video transitions. |
| `section.options.musicVolumeLevel` | `section.options.musicVolume` | Same `0..1` range, new key.                                                                                            |
| `input.type: "frame"`              | `input.type: "animation"`     | Frame-sequence / animated overlays.                                                                                    |
| `input.options.frequency`          | `input.options.fps`           | **Reciprocal, not a copy:** `fps = 1 / frequency`. `0.04 → 25`, `0.3 → 3.333`.                                         |
| `input.options.overlay`            | `input.options.position`      | Same `"x:y"` string, new key.                                                                                          |

> `options.duration` is **seconds in both versions** (it maps straight to ffmpeg
> `-t`). If a v1 template used an oversized cap like `20000` on a `project_video`,
> that still works (the clip trims to its real length) — it is **not** milliseconds
> and needs no change. Tidy it to a real bound (e.g. `20`) if you like.

Let the schema find them for you — the new strict schema **rejects** every legacy
key above, so a `safeParse` is a fast migration checklist:

```js
import { TemplateDescriptorSchema } from 'ffmpeg-video-composer';

const result = TemplateDescriptorSchema.safeParse(json);
if (!result.success) {
  // e.g. "Unrecognized key: musicVolumeLevel", "frequency", "audioVolumeLevel" …
  console.error(result.error.issues);
}
```

### New, optional capabilities

None of these are required — adopt them per section when you want the effect.

- **Look & grade** — `section.look` (`cinematic` · `warm` · `cool` · `vintage` ·
  `noir` · `vivid` · `dreamy`) and `section.grade`
  (`brightness`, `contrast`, `saturation`, `gamma`, `hue`, `colorBalance`, `blur`,
  `curvesPreset`).
- **Motion** — `section.motion: [{ type: 'kenburns' | 'rotate' | 'crop' | 'flip', … }]`
  (e.g. a Ken Burns push-in: `{ type: 'kenburns', direction: 'in', intensity: 1.1 }`).
- **Captions** — `section.caption: { text, style, position, align, … }` — styled
  lower-thirds without hand-writing `drawtext`.
- **Transitions** — `section.transition` / `global.transition`
  (`{ type, duration }`) drive real xfade transitions between sections; any
  `XFADE_TRANSITIONS` name, or `"cut"` for a hard cut.
- **Partials** — a new section type: `{ type: 'partial', ref: '<id>', variables: { … } }`
  expands a reusable fragment (with `{{ key }}` substitution) before compilation.
- **Background layers** — `color_background` sections take `options.layers: [{ color | gradient, opacity, x, y, w, h }]`.
- **Audio mix** — `global.audio: { sourceVolume, musicVolume, normalize, ducking }`,
  plus per-section `options.audioFade: { in, out }`.
- **Selection allowlists** — `global.allowedMusic`, `allowUploadMusic`,
  `allowedBackgrounds`, `allowUploadBackground` (for editor/agent surfaces).
- **Metadata** — optional `meta: { name, description }` at the root.

New exports back all of this: `TemplateDescriptorSchema`,
`templateDescriptorJsonSchema`, the `LOOK_PRESETS` / `XFADE_TRANSITIONS` /
`AFADE_CURVES` constants, and the `Transition` / `Grade` / `MotionEffect` /
`BackgroundLayer` types.

### Before / after

A `project_video` section, v1 → v2 (renames applied, new sugar added):

```jsonc
// v1
{
  "name": "video_1",
  "type": "project_video",
  "options": { "duration": 20000, "musicVolumeLevel": 0.1 },
  "inputs": [
    {
      "name": "animatedIcon",
      "type": "frame",
      "options": { "frequency": 0.3, "overlay": "600:200", "scale": "1280:720", "persistent": false }
    }
  ]
}

// v2
{
  "name": "video_1",
  "type": "project_video",
  "look": "warm",                                                   // new
  "grade": { "contrast": 1.1, "saturation": 1.2, "gamma": 0.96 },   // new
  "motion": [{ "type": "kenburns", "direction": "in", "intensity": 1.1 }], // new
  "transition": { "type": "pixelize", "duration": 0.4 },            // new
  "options": { "duration": 20, "musicVolume": 0.1 },                // musicVolumeLevel → musicVolume
  "inputs": [
    {
      "name": "animatedIcon",
      "type": "animation",                                          // frame → animation
      "options": { "fps": 3.333, "position": "600:200", "scale": "1280:720", "persistent": false }
      //            frequency 0.3 → fps 3.333 (1/0.3)   overlay → position
    }
  ]
}
```

## Animations are now single-file (ZIP frame-sequences removed)

Animation overlays (`inputs[].type: "animation"`) must now be a **single animated
file**. APNG and WebM (VP9 with alpha) are the two recommended formats — APNG for
lossless alpha and universal decode, WebM for much smaller files; `.webp` and
`.gif` also work. The old **ZIP frame-sequence** form (`url` ending in `.zip`,
extracted to an `image2` PNG sequence) has been removed, along with the
`extract-zip` dependency and the `unzip` filesystem method.

- **Why:** ZIP extraction only ran on Node — the browser-WASM and on-device
  (React Native) engines could never extract it. A single animated file decodes
  natively on every platform with no extraction step.
- **Migrate:** convert your frame sequence to one file and point the input `url`
  at it — `ffmpeg -framerate <fps> -i frame-%03d.png -plays 0 out.apng` (APNG), or
  `ffmpeg -framerate <fps> -i frame-%03d.png -c:v libvpx-vp9 -pix_fmt yuva420p out.webm`
  (WebM, smaller). The `.webm` `-c:v libvpx-vp9` flag is added automatically at
  render. A `url` still ending in `.zip` now **throws** a clear error at render time.
- `options.fps` is now informational for single-file animations — the file's own
  frame rate governs playback. Encode at the rate you want.

## Security / behavior changes

These tighten how untrusted or edge-case templates are handled. If you feed
hand-crafted or user-supplied templates, review these:

- **No shell.** FFmpeg is now invoked via `execFile` instead of a shell, so
  shell metacharacters in template values are no longer interpreted.
- **argv tokens reject whitespace.** Template string values interpolated as
  unquoted ffmpeg argv tokens (e.g. a section `color`, an input `url`, a section
  name) now reject embedded whitespace and NUL bytes. A template whose `color`
  is `"red 0.5"` (raw space) now **throws** instead of silently injecting extra
  ffmpeg arguments. Use a valid single-token value (`red@0.5`); real URLs should
  percent-encode spaces.
- **SSRF guard on remote fetches (server-side).** When the Node runtime fetches
  a remote `videoUrl` / `music.url` / background URL, it now refuses:
  - non-`http(s)` schemes (e.g. `file:`, `gopher:`),
  - private / reserved / loopback / link-local addresses, including the cloud
    metadata address `169.254.169.254` and `localhost`,
  - hostnames that resolve to any of the above — re-checked across HTTP redirects.

  Templates that legitimately reference public `http(s)` media are unaffected.

## Still the same

- The `compile(projectConfig, template)` / `loadConfig(path)` API is unchanged,
  and compile still consumes the descriptor without requiring schema validation.
- The `{ global, sections }` document shape, `{{ variable }}` interpolation, and
  authored `filters` / `maps` are unchanged.
- FFmpeg detection order (system → `ffmpeg-static` → WASM) is unchanged.
- `drawtext`-capable FFmpeg is still required for text / background-color
  segments.
