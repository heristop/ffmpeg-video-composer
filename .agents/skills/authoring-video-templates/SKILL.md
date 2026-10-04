---
name: authoring-video-templates
description: Use when creating or editing a video template JSON (the template descriptor), adding or changing sections/filters/maps/variables/transitions/looks/motion/audio/layers/registered effects/creative direction, or debugging template validation errors in ffmpeg-video-composer.
---

# Authoring Video Templates

## Overview

A template is a JSON **descriptor** that the engine compiles into a video. Its main keys are `global` (project-wide defaults) and `sections` (the ordered list of scenes), with optional `meta` (display metadata and `creativeDirection`) and `partials` (reusable fragments). Validate descriptors against the schema; don't guess fields.

Sources of truth (in order of authority):

- **zod source:** `packages/ffmpeg-video-composer/src/schemas/` (`TemplateDescriptorSchema` in `section.schemas.ts`, re-exported by `template.schemas.ts`). This defines accepted fields; use the validator and lowering code to check behavior.
- **Validator and behavior:** `packages/ffmpeg-video-composer/src/services/TemplateValidator.ts` (+ `template-validation-rules.ts`), native lowering in `src/editor/presets/`, and registered contracts in `packages/leclap-mcp/src/effects/`.
- **Machine-readable JSON Schema:** `docs/template-descriptor.schema.json` — generated from the zod source; feed it to an editor/agent for autocompletion + validation. Regenerate with `pnpm --filter ffmpeg-video-composer generate:schema`.
- **Full field reference + examples:** `docs/template-configuration.md`.
- **Built-in examples:** `packages/leclap-creative-kit/src/templates/*.json`.

## Two layers: structured sugar vs. raw filters

- **Structured sugar** (prefer this): `transition`, `look`, `grade`, `motion`, `audio`, `layers`, animation `inputs`, and text sugar (`caption`, `titleCard`, `lowerThird`, `reveal`, `global.overlays`/`look`/`grade`). Editor-friendly camelCase intents that compile to ordinary, on-device-safe FFmpeg filters.
- **Raw filters** (escape hatch): `filters[]`, `inputs[].filters`, `maps[]` — passed to FFmpeg verbatim. A final `{ "type": "scale", "value": "output" }` conforms a custom frame to the actual project dimensions with aspect-preserving scale/pad and square pixels. Other arguments stay raw. Their `values` keys stay FFmpeg-native (`x/y/w/h/c/t/fontcolor/fontsize/fontfile/alpha/d/st/color/box/boxcolor/boxborderw`), **not** camelCase, by design.

## Structure

```jsonc
{
  "global": {
    "variables": { "video": "https://…/earth.mp4" },
    "orientation": "landscape", // "landscape" (1280x720) | "portrait" (720x1280) | "square" (1080x1080)
    "musicEnabled": true,
    "music": { "name": "track.mp3" },
    "transition": { "type": "fade", "duration": 0.4 }, // xfade name | "cut"; duration in SECONDS
    "audio": { "sourceVolume": 1, "musicVolume": 0.5 },
  },
  "sections": [
    {
      "name": "intro",
      "type": "video", // see Section types
      "options": { "videoUrl": "{{ video }}", "duration": 4, "musicVolume": 1 }, // SECONDS
      "transition": { "type": "wipeleft", "duration": 0.4 }, // boundary AFTER this section
      "look": "cinematic",
      "filters": [{ "type": "fadein", "values": { "color": "#000000" } }],
    },
    {
      "name": "outro",
      "type": "color_background",
      "options": { "backgroundColor": "#101418", "duration": 2 },
    },
  ],
}
```

## Section types (discriminated on `type`)

| `type`             | Use for                                                                   |
| ------------------ | ------------------------------------------------------------------------- |
| `video`            | A clip from `options.videoUrl` (remote or local).                         |
| `project_video`    | A clip recorded from the device camera; supports `framingGuide`.          |
| `image_background` | Still image (`options.pictureUrl`); supports `kenburns`.                  |
| `color_background` | Solid colour (`options.backgroundColor`) + composited `layers`.           |
| `form`             | User input fields (`options.fields`); each field `name` → `{{ name }}`.   |
| `music`            | Audio-only / timeline-padding section.                                    |
| `partial`          | Reusable or inline fragment expanded before validation/compile.           |
| `effect`           | Versioned registered effect resolved to a clip before FFmpeg composition. |

Native visual segments live in `packages/ffmpeg-video-composer/src/editor/segments/`; `SegmentFactory` maps their `type` → class. Partials expand first; effect sections require caller-provided resolution.

For `effect`, author an exact `{ id, version, props, assets }` reference and a required positive `options.duration`. The core accepts JSON props; the backend validates each registered effect's actual props/assets and runtime. In MCP, discover with `get_effect_schema` (`{ "list": true }`), then request the exact id/version contract and use `render_preview` before `compose_video`. The trusted Node/Chromium worker is configured by the operator; browser/native callers consume resolved clips. See [Registered JSON effects](../../../docs/template-configuration.md#registered-json-effects-desktop-authoring).

Keep an optional `meta.creativeDirection` brief (trimmed, 1–4000 characters) when editing. It guides authoring, adds no rendering behavior, and must be implemented through explicit native settings or registered props; see [creative direction](../../../docs/creative-direction.md).

## Capabilities (brief)

- **Transitions** — `transition: { type, duration? }` on `global` and/or per section (boundary after that section). `type` is an xfade name (see `XFADE_TRANSITIONS`) or `"cut"`. Effective duration = section ?? global ?? 0.3 s. Any non-`cut` boundary forces a full-timeline re-encode (costly on WASM/on-device); cuts are a fast stream-copy concat.
- **Looks & grade** — `look` is a preset: `eq`/`curves`-based (`cinematic`/`warm`/`cool`/`vintage`/`noir`/`vivid`/`dreamy`), **LUT-backed** (`teal-orange`/`warm-film`/`mono-film`/`noir-film`/`vivid-pop` → a single `lut3d` + a bundled `.cube`, a stronger grade; staged like fonts, runs on every backend, dropped-with-warning where `lut3d` is absent), or **stylized** (`duotone`/`posterize`/`sketch`/`glitch`/`soft-vignette` → small LGPL-safe filter stacks — `hue`/`colorchannelmixer`/`lutyuv` quantize/tint, `edgedetect`, `rgbashift`+`noise`, `vignette` — never `eq`/`geq`/`boxblur`). `grade` (brightness/contrast/saturation/gamma/hue/colorBalance/blur/grain/curvesPreset) → `eq`/`colorbalance`/`curves`/`gblur`/`noise`/`hue`, stacks on top; `grain` (0..1) lowers to `noise=alls=<0..20>:allf=t+u`.
- **Letterbox** — section `letterbox: { aspect, color? }` (`aspect` 1..4, e.g. `2.39` for cinemascope) overlays two `drawbox` bars top/bottom to simulate a wider frame; compiles after grade/look so bars sit over the graded image. No-op ([]) when `aspect` is narrower than or equal to the frame's own aspect ratio.
- **Motion** — ordered `motion[]`: `kenburns` (`image_background`, `video`, `project_video`, or resolved `effect` clips), `rotate`, `crop`, `flip`, `shake` (handheld jitter via a wandering `crop` window, `intensity`/`frequency`), `pulse` (rhythmic zoom via `zoompan`, `intensity`/`frequency`) → `zoompan`/`rotate`/`crop`/`hflip`/`vflip`. `shake`/`pulse` have no section-type restriction.
- **Chroma key** — section `chromaKey: { color, similarity?, blend?, background? }` keys out a solid screen colour (`colorkey`) and composites the clip over a flat colour. v1 = solid-colour background only; dropped-with-warning where `colorkey` is absent.
- **Audio polish** — `global.audio`: `sourceVolume`, `musicVolume`, `normalize` (`loudnorm`/`dynaudnorm`), `ducking` (bool or fine-grained). Per-section `options.audioFade` (`in`/`out`, `afade`) and `options.musicVolume`. `options.audioEffect` (`echo`/`telephone`/`muffled`) appends a voice preset (`aecho`/`highpass+lowpass`/`lowpass`) to the `-af` chain before any fade, skipped entirely when `muteSection` is true.
- **Layers** — `color_background` `options.layers[]`: solid/opacity/gradient boxes composited over the base colour.
- **Framing guide** — `project_video` `options.framingGuide` (`silhouette`): a **recording-UI overlay only**, never rendered into the video.
- **Animation & image inputs** — one input per overlay: an `.apng`/`.webp`/`.gif`/`.webm` animation **or** a still `image` (PNG/JPG). `options.loop` → `stream_loop`, `options.persistent` → `eof_action=repeat`, `options.rotation` (deg), `options.motion` (an animated entrance reusing the `reveal` vocabulary → `overlay` x/y time-expressions).
- **Text sugar** — prefer these over hand-positioned `drawtext`: `caption` (styled overlay), section `titleCard` on `color_background` (kicker/headline/subtitle/accent/fade — collapses ~80-line intros), section `lowerThird` on any visual section (title/subtitle/badge band, composites above animations). On any of them: `reveal` (`none`/`fade`/`rise`/`slide-left`/`slide-right`, bare string or `{type,delay,duration,distance,easing}`) for an entrance, and `effect: { shadow?, outline? }` (`TextEffect`) for drop-shadow/outline legibility. A title card takes optional `stagger` (seconds 0..1, default .15) between non-empty lines; zero starts them together and its accent follows its associated line. A positioned `drawtext` filter also takes `exit` (same vocabulary + an `after` start time, defaulting to end-at-section-end). Entrance and exit `easing` is `linear` (default), `ease-out`, `ease-in-out`, or `ease-out-back`; it curves text alpha and travel. Back easing overshoots travel by about 10% while clamping text alpha to 0..1. Overlay fade motion uses the linear fade filter. No `exit` field exists on caption/titleCard/lowerThird blocks. Sized from the output scale, so they render in any orientation.
- **Global decorations** — authored once in `global`, applied to every section (sibling of `global.animations`): `global.overlays[]` (whole-video text/brand watermark, with `position` anchor + optional `sections` subset), `global.look` / `global.grade` (whole-video colour). Removes per-section `{{ brand }}` repetition.

## Variables, filters, maps

- **Variables** — define in `global.variables` (string or string[]); reference anywhere with `{{ name }}`. `{{ colorN }}` is 1-indexed into `colorsList`; `{{ form_field }}` is a form field's value.
- **Filters** — `{ type, value?, values?, range? }`. `type` is a raw FFmpeg filter name. `values` keys are FFmpeg-native (see above). Common types: `fadein`, `fadeout`, `scale`, `drawtext`, `drawbox`, `overlay`, `vignette`.
- **Maps** — `{ inputs, outputs, filters?, options? }` to route FFmpeg streams explicitly; `@name` references an input/animation pad; the final output must end with `final`. Only needed for multi-input/overlay sections.
- `text`, `title`, `description`, field `label` are `Translation` objects (`{ "en": "…" }`) for i18n.

## Validating

Validate with `TemplateValidator` (zod + cross-field rules). zod reports the exact path/field on failure. Cross-field rules reject: a non-`cut` transition on the last rendering section (`dangling_transition`); an effective transition duration ≥ the smaller adjacent declared `duration` (`transition_too_long`); `kenburns` outside `image_background`/`video`/`project_video`/`effect` (`motion_unsupported_section`); a whole-video animation or watermark with no url (`global_animation_missing_url` / `global_watermark_missing_url`); and a `caption`/`global.overlays` `font` **string** that is neither a bundled id nor a `.ttf` (`unknown_font` — catches typos that would otherwise silently fall back to the default).

- **Fonts** — `font` takes a bundled id (`"bebas"`), a `.ttf` filename, or `{ family, weight?, style? }` to pull any Google Fonts family (`{ "family": "Playfair Display", "weight": 700 }`; weight 100..900 in steps of 100, default 400; style `normal`/`italic`). The object form is not validated against Google's catalogue — a bad family fails at render time naming the family — but it is the only way to get a multi-word family or a specific weight. An unresolvable font fails the render rather than silently drawing the wrong face. Not supported on the browser/WASM backend. After editing any `.json`, run `pnpm fmt`.

## Common mistakes

- Inventing option keys — `global` and section `options` are `strict`; only schema keys are valid.
- Using **old field names**: `audioVolumeLevel` → `audio.sourceVolume`; `transitionDuration` → `transition.duration`; `musicVolumeLevel` → `musicVolume`; `type: "frame"` / `frames`/`frequency`/`overlay` → a single `type: "animation"` input.
- Forgetting **durations are seconds** everywhere (`project_video` duration was previously ms — `30000` becomes `30`).
- Volumes (`sourceVolume`/`musicVolume`) must be 0..1; `duration`/`speed`/`transition.duration` must be positive.
- Using a `{{ var }}` that isn't declared in `global.variables` (or isn't a `colorN`/form field).
- Wrong `type` string — it must be one of the literals above (discriminated union).
