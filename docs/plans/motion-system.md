# Motion system: deterministic, expressive, native

> Status: P0, P1 (branch `feat/motion-p0-p1`), P2 kinetic typography (`feat/motion-p2-kinetic`) and the camera/graphics/designed-transition effects (`feat/motion-effects`) delivered; `meta.motionVersion` removed (pre-release, no versioning needed); P3+ proposed · Owner: motion/engine · Scope: `ffmpeg-video-composer`, `leclap-creative-kit`, `leclap-mcp`,
> `leclap-web`, `leclap-expo`, with `leclap-brand-motion` as the quality reference.

## 0. The brief

LeClap's promise is simple: the same JSON always renders the same film, on the phone and in the browser. The
motion vocabulary is the weak part today. We have four reveal types, four easing curves, Ken Burns, shake, pulse
and 56 stock `xfade` presets. Everything with real choreography (per-word type, springs, camera moves, impact
hits) lives in the Remotion route. That route is landscape-only, 1280×720, 300 frames, Node/Chromium only, so it
never ships on device.

The goal of the motion system is to close that gap without giving up determinism. Choreography should be native, expressed as
data, compiled into pure FFmpeg expression math, and identical for a given template, seed and platform.

The bar is our own films. The primitives in `leclap-brand-motion/src/film/cinema.tsx` (`KineticWords`,
`TrackingTitle`, `ImpactCamera`, `Shockwave`, `Flash`, `AnamorphicFlare`, `WarpLines`, `SceneShell`
enter/exit) define the quality target. Phase 6 rebuilds the showcase title sequence in pure template JSON and
compares it side by side with the Remotion original.

### Design principles (the Cupertino rules)

1. **Motion has a purpose.** Each animation directs attention, explains a change of state or sets a rhythm.
   The engine provides tools for this, and the motion lint (§6) flags motion that serves none of these goals.
2. **Physics over timing.** Springs are the default curve. Durations are derived from stiffness and damping,
   so arrivals feel weighted rather than scheduled.
3. **One system, many intensities.** A single `energy` control scales distance, overshoot and stagger across
   the film. Calm tutorials and launch hype come from the same tokens.
4. **Hold the frame.** Each entrance earns a readable hold. The engine enforces a minimum readable hold, and
   no template has to remember to.
5. **Time is a pure input.** Every animated value is `f(template, seed, n)`. Wall-clock time, unseeded noise and
   "whatever the decoder gives us" are never inputs.

---

## 1. Determinism contract (enforce first, then expand)

All later phases depend on this one, so it ships first.

| #   | Rule                                                                                                                                                                                                                           | Enforcement                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| D1  | **Compile is pure.** `compile(template, assetsDigest, platformProfile) → filtergraph` with no clocks, no `Math.random`, no environment reads beyond the declared profile.                                                      | Lint rule banning `Date`, `Math.random`, `performance.now` under `src/editor/**`, `src/schemas/**`                       |
| D2  | **Frame-grid time.** Every section chain starts with a CFR `fps` conform, so `t` in each animated expression is an exact frame time and variable-frame-rate phone footage can't drift a keyframe.                              | `editor/presets/motion-chain.ts`; the render tests assert the conform                                                    |
| D3  | **Seeded procedurality.** New `global.seed` (uint32, default `0`). Every procedural element derives `seed = hash32(global.seed, elementPath)` (FNV-1a). Shake paths, particle positions, scramble glyphs and grain all use it. | Schema: procedural effects reject a missing derived seed; `noise` always emits `all_seed=`                               |
| D4  | **Raw-filter hygiene.** User `filters[]` that contain `random(`, `%{localtime`, `%{gmtime` or `time(` render, but not reproducibly.                                                                                            | `TemplateValidator.getMotionWarnings` advisory `nondeterministic_expression` (no opt-out flag; it never blocks a render) |
| D5  | **Bit-exact muxing.** Add `-fflags +bitexact -flags:v +bitexact -flags:a +bitexact -map_metadata -1` and fixed `-threads` for libx264 in the deterministic encoder tier.                                                       | Encoder tier `deterministic` in `encoding.ts`; this tier is the default for the CLI and MCP                              |
| D6  | **No motion versioning (dropped).** The library is unreleased, so the motion system is simply the behaviour; there is no `meta.motionVersion`. Once published, a retune that changes output ships as a semver-major change.    | Golden filtergraph snapshots catch every output change                                                                   |
| D7  | **Render manifest.** Each render emits `render.manifest.json` with template hash (canonical JSON), asset hashes, seed, engine version, FFmpeg build ID, filtergraph hash and output hash.                                      | Extends existing MCP provenance and adds a `leclap verify manifest.json` command                                         |

**Test pyramid for determinism**

- _Filtergraph goldens_ (platform-independent): snapshot the compiled graph for every kit template and every
  motion preset. These are fast, run on every PR and catch 90% of regressions.
- _Frame goldens_ (per platform): decode frames at semantic timestamps (entrance start, peak overshoot,
  settle, exit) and compare with an SSIM threshold of 0.995 per platform profile (`node-x264`, `wasm`,
  `android-openh264`, `ios-vt`).
- _Twice-render check_: render each kit template twice in CI on Node and assert byte-identical MP4 under D5.

**Payoff:** time is a pure input, so any frame renders independently (`-ss` + one frame). That gives instant
scrubbing in the builder and agent previews of native sections at the cost of a single frame (§7).

---

## 2. Motion tokens: one design system for time

Add `global.motion` with named tokens that every animated field can reference using `$name`.

```jsonc
"global": {
  "seed": 7,
  "motion": {
    "energy": 0.8,                       // 0..1.5 → scales distance, overshoot, stagger, camera travel
    "springs": {
      "snappy":  { "stiffness": 420, "damping": 30, "mass": 1 },
      "gentle":  { "stiffness": 170, "damping": 26 },
      "bouncy":  { "stiffness": 300, "damping": 14 }
    },
    "curves": {
      "apple":   "cubic-bezier(0.25, 0.1, 0.25, 1)",
      "expo":    "cubic-bezier(0.16, 1, 0.3, 1)",
      "anticip": "cubic-bezier(0.68, -0.6, 0.32, 1.6)"
    },
    "durations": { "micro": 0.18, "short": 0.35, "base": 0.6, "long": 1.1 },
    "stagger":   { "tight": 0.04, "base": 0.08, "loose": 0.14 }
  }
}
```

Built-in tokens ship by default (`$snappy`, `$gentle`, `$bouncy`, `$expo`, `$apple`, `$base`…) and match
the web tokens in `DESIGN.md` (`--ease-spring`, `--ease-out-expo`), so the product UI and the videos move
alike.

### 2.1 Easing engine (all compile-time, all pure expressions)

| Curve                                                                                                               | Lowering                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing 4 + `ease-in`, `ease-in-out-cubic`, `ease-out-expo`, `ease-out-quart`, `ease-in-out-sine`, `ease-out-circ` | Closed form in FFmpeg expression grammar (`pow`, `exp`, `sin`, `sqrt`).                                                                                                                         |
| `spring(k, c, m, v0)`                                                                                               | Analytical damped harmonic oscillator. The solver picks under-, critically- or over-damped form at compile time and emits `1-exp(-ζω·τ)·(cos(ωd·τ)+…)`. The settle time (`                      | x-1                                                   | < 0.001`) becomes the derived duration. |
| `cubic-bezier(x1,y1,x2,y2)`                                                                                         | Solved at compile time with Newton–Raphson plus bisection fallback. The curve is sampled into a 16-segment piecewise **cubic Hermite** emitted as nested `if(lt(p,…))`, with max error < 0.002. |
| `steps(n, start                                                                                                     | end)`                                                                                                                                                                                           | `floor(p*n)/n`, for stop-motion and typewriter beats. |
| `keyframed`                                                                                                         | Arbitrary user curve (`[[0,0],[0.4,1.08],[1,1]]`) → monotone cubic interpolation, same Hermite emitter.                                                                                         |

Guardrails: expression length budget per filter (FFmpeg's parser handles roughly 10 k chars comfortably; we
cap at 4 k and fold shared sub-terms into `st()/ld()` registers). Overshoot is clamped so the element's
bounding box never exits the title-safe area (computed with `font-metrics.ts`).

---

## 3. Universal keyframe tracks

Today each feature has its own small timing schema (`reveal`, `exit`, `motion`, `options.motion`). The motion system adds
one generic track model that every animatable target accepts. The existing sugar stays and lowers into tracks,
so legacy output is unchanged under `motionVersion: 1`.

```jsonc
"animate": {
  "y":       [{ "t": 0.2, "v": "+80" }, { "t": "+$base", "v": 0, "ease": "$snappy" }],
  "opacity": [{ "t": 0.2, "v": 0 },     { "t": "+$short", "v": 1 }],
  "scale":   [{ "t": 0.2, "v": 0.86 },  { "t": "+$base", "v": 1, "ease": "$bouncy" }],
  "tracking":[{ "t": 0.2, "v": 24 },    { "t": "+$long", "v": 2, "ease": "$expo" }]
}
```

| Target                       | Animatable properties (→ FFmpeg)                                                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Text (`drawtext`)            | `x`, `y`, `opacity` (alpha), `scale` (fontsize expr), `tracking` (per-glyph x when split), `color` (2-stop via split layers), `borderw`                                  |
| Overlay (`inputs[]`, layers) | `x`, `y`, `opacity` (via `colorchannelmixer` + `enable` windows or pre-baked alpha), `scale` (per-frame `scale` with `eval=frame`), `rotation` (`rotate` with `a=` expr) |
| Shapes (`drawbox`, new §4.4) | `x`, `y`, `w`, `h`, `opacity`, `thickness`                                                                                                                               |
| Camera (§4.2)                | `zoom`, `panX`, `panY`, `rotate`, `shake`                                                                                                                                |
| Look (§4.5)                  | `vignette.angle`, `grade.brightness` (via `eq` eval=frame on Node, `lutyuv` approximation on device), `grain`                                                            |

Time grammar: absolute seconds, `"+0.3"` relative to the previous key, `"@beat:4"` (§5), or anchors
`"after:headline.settle+0.1"`. Anchors resolve at compile time into a single static timeline. They are
never evaluated at runtime.

---

## 4. The effect library (the "awesome" layer)

Each family is a **versioned preset** (`"preset": "kinetic.cascade@1"`) that expands into §3 tracks, with
exhaustive, bounded configuration. Every preset is documented with a generated contact sheet.

### 4.1 Kinetic typography (native per-word and per-glyph). Highest impact.

The text splitter uses `font-metrics.ts` (HarfBuzz-compatible advances for the 12 bundled fonts) to break a
line into words or graphemes. Each piece becomes its own `drawtext` at a precomputed x. That gives Remotion-class
choreography on device.

| Preset                | Look                                                        | Key options                                                                                  |
| --------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `kinetic.cascade`     | Words rise in sequence on a spring                          | `unit: word                                                                                  | glyph`, `stagger`, `order: forward | reverse | center-out | random(seed)`, `distance`, `spring` |
| `kinetic.tracking-in` | Wide tracking collapses to tight (Apple keynote title)      | `from`, `to`, `ease`, `blurIn` (alpha ghost trail)                                           |
| `kinetic.mask-rise`   | Words emerge from behind a baseline                         | Lowered as a `crop`ped text layer composited per line (overlay of a pre-rendered text plane) |
| `kinetic.highlight`   | Marker sweep behind a word                                  | `word`, `color`, `sweepDuration`, `skew`, `radius`                                           |
| `kinetic.scramble`    | Decode/cipher effect, seeded glyph sets settling L→R        | `charset`, `settleStagger`, `seed`                                                           |
| `kinetic.typewriter`  | Glyph-by-glyph with optional caret blink                    | `cps`, `caret`, `jitter(seed)`                                                               |
| `kinetic.counter`     | Number rolls to a value (`%{eif:…}`)                        | `from`, `to`, `ease`, `format`, `prefix/suffix`                                              |
| `kinetic.split-slide` | Halves travel in opposition and lock                        | `axis`, `distance`, `spring`                                                                 |
| `kinetic.impact`      | Scale punch with overshoot plus camera hit (pairs with 4.2) | `peak`, `hitFrames`                                                                          |
| `kinetic.wave`        | Continuous sine bob across glyphs (idle life during holds)  | `amplitude`, `wavelength`, `speed` — capped by motion lint                                   |

Budget: at most 48 `drawtext` instances per section on device (enforced, measured in the perf bench). Above
that, the splitter degrades from glyph to word granularity with a warning.

### 4.2 Virtual camera

`camera` replaces the ad-hoc `kenburns` / `pulse` / `shake` trio with one keyframed rig (the old types become
sugar). It lowers to a single `zoompan` (stills) or `scale+crop` with `eval=frame` (footage) after a 2× upscale,
which keeps one resample per section.

- **Moves:** `push-in`, `pull-out`, `dolly-left/right`, `crane-up/down`, `orbit` (zoom plus drifting pan),
  `rack` (zoom snap between two framings), `follow` (keyframed focal point, i.e. manual tracking data).
- **Impacts:** `hit` at times or beats produces a short scale punch plus a decaying seeded shake (the native
  version of `ImpactCamera` / `impactAt`).
- **Handheld:** seeded 1/f noise path (sum of 3 sines with seeded phases), not jitter. Controls are
  `amplitude`, `frequency`, `rotation`.
- **Whip:** high-velocity pan into the cut with an `xfade` handoff (4.3). Motion blur is approximated by a
  3-tap temporal echo (`tmix` on Node/WASM). On device it falls back to directional smear (`gblur` on the
  `enable` window).

### 4.3 Transitions that feel designed

`xfade` is already on every backend, including its `transition=custom:expr=…` mode, so we can ship a library
of **custom pure-expression transitions** with easing applied to `P`. No filter rebuild is needed.

| Preset         | Description                                                                                        |
| -------------- | -------------------------------------------------------------------------------------------------- |
| `push.{dir}`   | iOS-style push. Both plates move with a spring, and the outgoing plate dims 20%.                   |
| `zoom-through` | Outgoing scales up and fades while incoming settles from 1.08 (the "Apple Event" cut).             |
| `iris.soft`    | Circular reveal with feathered edge (`feather` px), centre configurable or anchored on an element. |
| `luma-wipe`    | Wipe driven by a bundled grayscale map (`gradients` or PNG: radial, clock, brush, noise(seed)).    |
| `slice.{n}`    | N staggered bands (seeded order) for editorial montages.                                           |
| `glitch`       | Seeded block displacement plus RGB split on the boundary frames.                                   |
| `light-flash`  | Brightness bloom to white with exposure curve, the native `Flash`.                                 |
| `match-scale`  | Scale-matched cut on a shared anchor (logo, product) for match cuts.                               |
| `whip.{dir}`   | Pairs with camera whip; smear plus offset.                                                         |

Every transition accepts `easing` (any token), `duration`, and `audio: "crossfade"|"cut"|"swoosh"` (swoosh
uses bundled SFX, chosen deterministically).

### 4.4 Shapes, light and texture (graphic layer)

- **Animated shapes:** `rect`, `bar`, `frame`, `corner-marks`, `underline`, `progress` via `drawbox` with
  expression geometry, and `circle`/`ring` via pre-rendered APNG atlases scaled per frame.
- **Brand gradients:** animated mesh-like backgrounds via the `gradients` source (already in the device
  build), with `speed`, `angle`, 2–8 brand stops, and seeded drift.
- **Light:** `light-leak` (bundled plates plus seeded selection and drift), `anamorphic-flare`, `shockwave`
  (APNG ring scaled on spring), `sparks` (seeded particle sprite sheet), `glow` (Node/WASM: `split+gblur+blend`;
  device: pre-baked halo plate).
- **Texture:** `grain` (seeded, luminance-weighted), `scanlines`, `vignette` with animated angle
  (`vignette eval=frame`), `chromatic` (`rgbashift`, gated to `enable` windows), `halation`.

### 4.5 Rhythm and grading in motion

- Grade keyframes (exposure pump on hits, saturation bloom on the reveal, "lights up" on the finale).
- `letterbox` animates in and out (bars drive in on the title, then release). This is the `Letterbox amount`
  primitive from the film kit.

### 4.6 Scene choreography presets ("recipes")

These are one-line, high-level, versioned recipes built from 4.1–4.5. They are the fastest path to a dynamic
video and the main vocabulary for agents.

| Recipe               | What it composes                                                                         |
| -------------------- | ---------------------------------------------------------------------------------------- |
| `keynote-title@1`    | Ink canvas, tracking-in headline, gradient underline sweep, slow push-in, soft flash out |
| `impact-statement@1` | Word cascade on `$bouncy`, camera hit on the last word, shockwave, grade pump            |
| `product-hero@1`     | Device plate with orbit camera, light pass, kicker plus counter stat, zoom-through exit  |
| `feature-triplet@1`  | Three beats on a rhythm grid, each with `push` transition and alternating layouts        |
| `stat-burst@1`       | Counter roll, highlight sweep, sparks on completion                                      |
| `outro-lockup@1`     | Logo spring, wordmark tracking, CTA hold ≥ 2.5 s, letterbox release                      |

Recipes are data (JSON partials with typed parameters), not code, so the MCP catalog, builder, CLI and Expo
all read the same source.

---

## 5. Rhythm: cut to the music, deterministically

- `global.rhythm: { "bpm": 120, "offset": 0.12, "signature": [4,4] }` makes every time field accept
  `"@beat:8"`, `"@bar:2"` or `"@beat:8+0.05"`.
- **Beat analysis happens at authoring time, never at render time.** `leclap analyze music.mp3` writes
  `{ bpm, offset, downbeats[], energy[] }` into the template, or into a sidecar referenced by hash. The
  render only reads the stored data, so the same template always produces the same cuts.
- `"snap": "beat"` on sections quantizes durations to the grid. Cameras accept `hits: "@every-bar"`.
- Bundled kit tracks ship with pre-analyzed grids.

---

## 6. Motion lint: taste, encoded

`leclap validate` gains a `motion` category with machine-readable findings for humans, the builder and agents.

| Rule                  | Default                                                                               |
| --------------------- | ------------------------------------------------------------------------------------- |
| `readable_hold`       | Text must be settled for at least `0.4 s + words/3.5 s` before exit or cut            |
| `concurrent_motion`   | At most 3 independently moving elements in any 200 ms window (scaled by `energy`)     |
| `easing_consistency`  | Warn when one section mixes more than 2 curve families                                |
| `overshoot_safe_area` | Spring overshoot and travel must remain inside title-safe (error)                     |
| `transition_density`  | Warn when more than 50% of boundaries are non-cut (cost on device and visual fatigue) |
| `photosensitivity`    | Error on flashes > 3 Hz or full-frame luminance swings > 20% at > 3 Hz (WCAG 2.3.1)   |
| `device_budget`       | `drawtext` count, expression length, overlay count against the platform profile       |
| `reduced_motion`      | Every template gets a free `energy: 0` variant (fades only) for accessibility exports |

---

## 7. UI / UX

### Web builder (`apps/leclap-web`)

- **Timeline with tracks.** Section lanes, then element lanes, then property tracks with keyframe diamonds.
  Drag to retime, and snap to beats and anchors.
- **Curve editor.** Spring presets with a live graph (the overshoot visibly decays), bezier handles, and a
  token picker. Changing `$snappy` updates every use.
- **Frame-exact scrubbing.** Pure time means a single-frame WASM render (`-ss` seek, 1 frame) for any
  position, cached by `hash(section, frame)`.
- **Preset gallery.** Looping contact-sheet thumbnails per preset and recipe, with an "apply to selection" action.
- **Energy dial.** One global slider that previews calm↔hype across the whole film.
- **Lint inspector.** Findings show inline on the timeline (the red hatch marks an unreadable hold).

### Expo app (`apps/leclap-expo`)

- Recipe-first: pick a recipe per scene and set an energy slider. No keyframe UI on phone.
- Device budget badge per template, so the user knows before rendering that it fits the phone.
- Haptic tick on beat-snap while trimming (matches the rhythm grid).

### MCP / agents (Opus 5.5 authoring loop)

- `get_motion_catalog` lists presets, recipes and tokens with JSON schemas plus contact-sheet URLs.
- `render_preview` is extended to **native** sections (single frames or a short range), not just registered
  effects.
- `lint_motion` returns §6 findings as structured patches the agent can apply.
- **Director loop** in the `compose-video` prompt: storyboard → recipes → validate → frame contact sheet
  (entrance / peak / settle / exit per beat) → self-critique against `meta.creativeDirection` → `patch_template`.
  The model only ever writes JSON. Determinism holds because nothing generative sits in the render path.

---

## 8. Platform matrix

| Capability                      | Node | WASM | Device | Notes                                                                     |
| ------------------------------- | :--: | :--: | :----: | ------------------------------------------------------------------------- |
| Tokens, springs, bezier, tracks |  ✅  |  ✅  |   ✅   | Pure expressions                                                          |
| Kinetic type (word/glyph)       |  ✅  |  ✅  |   ✅   | Budgeted drawtext count                                                   |
| Camera rig                      |  ✅  |  ✅  |   ✅   | `zoompan` / `scale eval=frame` + `crop`                                   |
| Custom xfade transitions        |  ✅  |  ✅  |   ✅   | `xfade custom` already compiled in                                        |
| Glow / motion-blur echo         |  ✅  |  ✅  |   ⚠️   | Needs `blend`, `tmix`; device uses pre-baked plates until Phase 5 rebuild |
| Perspective device plates       |  ✅  |  ✅  |   ⚠️   | `perspective` not in device build; flat fallback                          |

**Phase 5 device build:** evaluate adding `blend`, `tmix`, `perspective`, `geq`-free `displace` (all LGPL) to
`scripts/ffmpeg/common.sh`. Gate on binary size (+ < 400 KB per ABI) and `verify-filters.sh`.

---

## 9. Roadmap

| Phase  | Deliverable                                                                                                     | Exit criteria                                                                                    |
| ------ | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **P0** | Determinism contract D1–D7, filtergraph goldens for all kit templates, `render.manifest.json`, `leclap verify`  | Twice-render byte-identical on Node for all 10 kit templates; CI goldens green                   |
| **P1** | Motion tokens, easing engine (spring/bezier/steps), `animate` tracks, sugar lowered to tracks (v1 parity)       | `motionVersion: 1` goldens unchanged; spring vs reference ODE error < 0.002                      |
| **P2** | Kinetic typography (10 presets) + text splitter + device budget                                                 | Native `kinetic.cascade` frame-matches the Remotion `elastic-stagger` within SSIM 0.97 on device |
| **P3** | Camera rig + custom-expression transition library + shapes/light/texture                                        | All presets have contact sheets; perf bench ≤ 1.3× current per-section render time on device     |
| **P4** | Rhythm grid + `leclap analyze` + recipes (6) + motion lint                                                      | Each kit template re-authored with recipes; lint clean; reduced-motion variant renders           |
| **P5** | Builder timeline/curve editor/scrub, Expo recipe UI, MCP catalog/preview/lint, optional device filter additions | Agent produces a lint-clean, recipe-based 30 s promo from a brief in ≤ 3 patch rounds            |
| **P6** | **Hero proof:** rebuild the `LeClapShowcase` title + finale beats in pure template JSON                         | Side-by-side with Remotion original on the landing page; renders on an iPhone and a mid Android  |

Each phase is additive: every new field is optional, so existing templates need no migration (golden
filtergraphs record every output change).

---

## 10. Risks

- **Expression size and eval cost.** Many glyph-level `drawtext` instances with long expressions can slow device
  renders. Mitigation: register folding (`st/ld`), the 48-instance budget, per-preset perf bench entries.
- **Cross-platform pixels.** Encoders differ (x264 / openh264 / VideoToolbox). Determinism is
  _per platform profile_ (as the README already states). Filtergraph equality is the cross-platform invariant.
- **Font metrics drift.** Splitter positions must match HarfBuzz shaping. Mitigation: metric goldens per bundled
  font and kerning-pair tests. Unknown fonts fall back to line-level animation.
- **Taste regressions.** A larger library makes bad combinations possible. Recipes and motion lint are the
  safety rails, and the energy dial keeps the system coherent.
