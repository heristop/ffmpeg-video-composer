# Motion review harness

`pnpm motion:review` renders every library effect in isolation, plus every bundled template, as 3×2 contact
sheets through `leclap snapshot`, and writes a static `index.html` that shows runs side by side (a `before`
column and an `after` column). It needs no Git LFS media: see [Media without LFS](#media-without-lfs).

```sh
pnpm motion:review --before HEAD --out /tmp/review     # "before" column: the engine at HEAD
pnpm motion:review --out /tmp/review                   # "after" column: the working tree
pnpm motion:review --out /tmp/review --only sheen      # one effect, every background and format
pnpm motion:review:templates --out /tmp/review         # the bundled templates only
```

Open `<out>/index.html`. Each row is one sheet key; each column is one run. Under every sheet: the render
time and the notes (stand-ins used, layers that could not be rendered).

| Option                               | Meaning                                                                                                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--before <ref>`                     | Shorthand for `--ref <ref> --label before`                                                                                                                                     |
| `--ref <ref>`                        | Render with the engine at that git ref. It is exported with `git archive` into `<tmp>/leclap-motion-review-cache/engines/<sha>`, installed offline and built once, then reused |
| `--label <name>`                     | The run's column (default `after`)                                                                                                                                             |
| `--out <dir>`                        | Output root (default `<tmp>/leclap-motion-review`). Runs land in `<out>/<label>/`                                                                                              |
| `--only <text>`                      | Keep the fixtures or templates whose key contains the text (repeatable, comma-separated)                                                                                       |
| `--formats`, `--backgrounds`         | Subsets, e.g. `--formats portrait --backgrounds dark,light`                                                                                                                    |
| `--effects-only`, `--templates-only` | Skip one half                                                                                                                                                                  |
| `--assets <dir>`                     | The asset bundle (default `apps/leclap-web/public/assets`); point it at a real bundle to render the legacy APNGs                                                               |
| `--showcase <dir>`                   | Copy existing PNG sheets into `<out>/showcase/`, listed in the index as "showcase baseline"                                                                                    |
| `--jobs <n>`                         | Parallel renders (default: half the CPUs)                                                                                                                                      |
| `--build`                            | Rebuild the current engine and CLI first (the harness warns when the engine sources are newer than its dist)                                                                   |

Each run writes `<out>/<label>/sheets/<key>.png`, the single frames in `<out>/<label>/frames/<key>/` (for
pixel checks), the exact descriptors in `<out>/<label>/descriptors/<key>.json`, and `manifest.json`. The exit
code is 1 when any render failed. A filtered run (`--only`, `--formats`, …) replaces only its own rows in the
label's manifest, so `--only fx-sheen` after a full run refreshes the sheen rows and keeps the rest.

## Fixtures

One JSON file per effect in [`fixtures/`](fixtures/). The file name is the fixture id and the start of every
sheet key: `<id>__<background>__<format>`. A fixture is **a section fragment**, not a template: the harness
lays it over a fixed stage, so a new effect needs nothing but its fixture.

The stage is one section, rendered on three backgrounds in three formats (landscape 1280×720, portrait
720×1280, square 1080×1080):

| Background | What it is                                                                                                                                                                    |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `footage`  | A `video` section playing a generated mid-grey stand-in: a slowly turning dark-slate to warm-grey ramp with static luma grain. It has shadows and highlights and needs no LFS |
| `dark`     | A `color_background` `#121826` with a light subject rect `#C9D2E0`                                                                                                            |
| `light`    | A `color_background` `#F0E8DC` with a subject rect `#CDBFA9`                                                                                                                  |

The **subject** is the rect an effect decorates: by default 60 % × 52 % of the frame, centred
(`x 0.2, y 0.24, w 0.6, h 0.52`, even pixels). On the cards it is drawn as `options.layers[0]`; on footage it is
an undrawn region of the clip (like a video rect).

```jsonc
{
  "label": "Shine sweep (legacy APNG)", // row title in the index
  "kind": "legacy", // legacy | graphic | kinetic | fx (shown in the index)
  "window": { "at": 0.3, "duration": 2.0 }, // the effect's life, in section seconds
  "section": {
    // merged into the stage section
    "inputs": [
      {
        "name": "effect",
        "type": "animation",
        "url": "/assets/animations/shine_sweep.apng",
        "options": {
          "position": "{{position}}",
          "scale": "{{scale}}",
          "fit": "contain",
          "start": "{{at}}",
          "duration": "{{duration}}",
          "opacity": 0.5,
        },
      },
    ],
  },
}
```

Optional fields:

- `moments`: six explicit moments, as section seconds or `"35%"` of the window. By default the six moments
  are 0.05 s before the window, 20/40/60/80 % through it, and 0.05 s after it, so the first and last frames show
  the stage with no effect.
- `subject`: `{ x, y, w, h, radius }` fractions overriding the default subject (`radius` is a fraction of the
  subject's short side, used by the `{{target}}` token only; the drawn card stays square).
- `backgrounds`, `formats`: render only a subset (default: all three of each).
- `hold`: seconds the section holds after the window (default 0.8; sections last at least 2 s).
- `global`: merged into the stage descriptor's `global` (for example `{ "motion": { "reduced": true } }`).
- `id`: overrides the file name.
- `next`: a second section fragment, laid over the same background as a second stage section (named
  `review-next`, same duration). Use it to review transitions: put `"transition"` in `section` and set
  `window.at` to the section length minus the transition duration (with `"hold": 0`, the section lasts
  `at + duration`, 2 s at least). See `fixtures/whip.json`.

How the fragment merges: arrays (`inputs`, `graphics`, `kinetic`, `filters`, …) are appended to the stage
section's, objects (`options`) are merged key by key, scalars replace.

### Tokens

Any string in `section` may use `{{token}}`. A string that is exactly one token takes the raw value (a number or
an object), otherwise the value is spliced into the text. Pixel values are even (4:2:0 chroma).

| Token                           | Value                                                                |
| ------------------------------- | -------------------------------------------------------------------- |
| `W`, `H`                        | Frame size in px                                                     |
| `x`, `y`, `w`, `h`              | Subject rect in px                                                   |
| `r`                             | Subject corner radius in px                                          |
| `cx`, `cy`                      | Subject centre                                                       |
| `short`                         | The subject's short side                                             |
| `position`, `scale`             | `"x:y"`, `"w:h"` of the subject (for `animation` inputs)             |
| `squarePosition`, `squareScale` | A square box of side `short` centred on the subject (for 1:1 assets) |
| `frameScale`                    | `"W:H"` (full-frame assets at position `0:0`)                        |
| `target`                        | `{ "x", "y", "w", "h", "radius" }`: the subject as an object, in px  |
| `at`, `duration`, `end`         | The window, in section seconds                                       |

### Fixtures for `graphics[].type: "fx"` effects

The procedural effects of the motion polish plan (`sheen`, `leak`, `edge-glow`, `ripple`, `glint`,
`confetti`, `bokeh`, `dust`, `bloom`, `glass`) are `graphics` entries with `type: "fx"`, an `effect`, and a
`target`. Each effect task adds **one fixture**, `fixtures/fx-<effect>.json`, whose sheet keys
(`fx-sheen__dark__portrait`, …) are the ones the plan's acceptance criteria name:

```json
{
  "label": "Sheen",
  "kind": "fx",
  "window": { "at": 0.4, "duration": 0.75 },
  "section": {
    "graphics": [
      {
        "type": "fx",
        "effect": "sheen",
        "target": "{{target}}",
        "at": "{{at}}",
        "duration": "{{duration}}"
      }
    ]
  }
}
```

- Use `"target": "{{target}}"` (the subject rect object, `{x, y, w, h, radius}` in px) so the effect is anchored
  to the subject in every format. Use `"target": "frame"` for full-frame effects (`leak`, `bloom`, `dust`), or
  `"layer:0"` to target the drawn card itself (it exists on the `dark` and `light` backgrounds only, so set
  `"backgrounds": ["dark", "light"]`).
- Set `window` to the effect's real life (the defaults of the effect), so the six moments sample it. For an
  effect with a fixed set of key moments (the sheen's start−0.05, 15/35/50/65/85 % and end+0.05), list them in
  `moments` (the sheet is 3×2, so six at most per sheet).
- Effect-specific options (`intensity`, `color`, `ease`, `variant`, …) go in the entry as usual. To review a
  variant, add a second fixture (`fx-ripple-tap.json`).
- Reduced motion: add a sibling fixture (`fx-sheen-reduced.json`) with
  `"global": { "motion": { "reduced": true } }`; the fixture's `global` is merged into the stage descriptor's.
- Until the `fx` type ships in the engine, an `fx` fixture renders as `failed` with the engine's validation
  error; in a `--before <older ref>` run that is the expected "before" state.

The legacy APNG fixtures (`legacy-*.json`) stay as the "before" side of each rebuilt effect: keep them.

## Templates

Each bundled template (`packages/leclap-creative-kit/src/templates/*.json`, taken from the engine's checkout,
so a `--before` run shows the templates as they were) renders once, at 8/25/42/58/75/92 % of the video. The
harness injects the shared partials (`src/partials/*.json`), fills every form field with its English label,
turns music off, and feeds every `project_video` section the footage stand-in. The six legacy overlay recipes
of `examples/overlay-effects/preview-template.json` render the same way, as `template__overlay-effects-preview`.

## Media without LFS

Most bundled media are Git LFS pointers in a fresh checkout. The harness builds an asset stage in
`<tmp>/leclap-motion-review-cache/assets`: real files are symlinked, and pointers are handled by kind.

- **Footage and pictures** that are pointers (and remote clips such as the logo bumper) are replaced by the
  generated stand-ins. The sheet is rendered, and its notes list each substitution.
- **APNG animations** that are pointers cannot be stood in for. Their layers are dropped. A `legacy` fixture whose
  effect was dropped is not rendered at all and shows **"pointer, not rendered"**. A template keeps rendering
  without that layer, with a `pointer, not rendered: animations/<file>` note.
- **Music** is always off.

Pass `--assets <dir>` with the real bundle (for example the extracted `web-media.tar.gz`) and the legacy rows
render for real.
