# Editorial motion, with deterministic controls

The example descriptors include `meta.creativeDirection` with their visual intent and review criteria.
See the [creative-direction guide](../../docs/creative-direction.md) for CLI and MCP authoring.

See [engine configuration](../../docs/engine-configuration.md) for descriptor orientation/fps, host media and encoder settings, and the separate MCP settings for trusted registered effects. Native recipes use the cross-platform FFmpeg route; registered effects use the fixed landscape Node contract described below.

This study applies motion design principles to LeClap's existing native JSON and registered Remotion paths. It accompanies the distinct tutorial, square promo, product launch, web app promo and story reel templates in the creative kit.

## Reference video analysis

[Supplied reference by Veee](https://x.com/vikktorrrre/status/2105698053386563592/video/1). Review used browser playback and timeline samples; it is not an exhaustive edit or audio analysis, and does not identify the tools used to make the video.

| Observed moment | Visual treatment                                                                 | Engine integration                                                                                                                                                               |
| --------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~0:20           | Persistent fine frame, corner marks, small labels and orange accent over footage | Native `drawbox`/`drawtext` or reusable overlay inputs. Keep text large enough for the export size; do not automatically add micro labels to every template.                     |
| ~0:49 and ~0:52 | Large condensed headlines, including NEW TOOLS, over strongly composed scenes    | Native positioned `drawtext` for simple arrivals/departures. Registered Remotion for clipping, word sequencing and emphasis with strict JSON props.                              |
| ~1:09           | A short headline arranged around the subject, with small secondary label         | Author text hierarchy and negative space with the footage in view. Motion controls do not replace good source composition.                                                       |
| ~1:35           | UI-like panels inset over a scene                                                | Existing image/animation inputs for pre-rendered panels; registered Remotion for live layout with trusted asset slots. Keep screen content readable.                             |
| ~2:19           | Orange highlighted headline fragment and caption emphasis                        | Timed text blocks or the registered `highlight` typography mode. Speech-synchronized words require explicit timestamps; guessing timing from a transcript is insufficient.       |
| ~3:19           | Multi-panel montage with KEEP GOING across a central strip                       | A future registered Remotion composition using synchronized video tiles. Bound panel count and measure concurrent decoding memory; no need to add a native video-layout runtime. |
| ~3:59           | Face-framing bracket and small technical labels                                  | A static bracket is possible now. Actual tracking needs authored/derived position keyframes; sparse sampled frames cannot prove how tracking was performed.                      |

The underlying people, locations and physical props are source footage. LeClap can compose that footage with typography and overlays; these motion controls do not generate it.

## Effects tour

[`effects-tour.json`](./effects-tour.json) is a six-minute product demo of the whole motion vocabulary, in ten chapters. Every beat names its effect in a small mono label (top left) and its chapter (top right):

| Chapter                                                        | What it shows                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [01 Type](./effects-tour/01-type.json)                         | The 14 kinetic presets, exits, glyph units in random order, gradient / texture / shimmer fills, an echo trail, greedy vs balanced wrap, colour emoji                                                                                                                                               |
| [02 Camera & graphics](./effects-tour/02-camera-graphics.json) | The 8 camera moves over photographs, hits, seeded shake, keyframed zoom and roll, Ken Burns and pulse motion, letterbox, and the 12 graphics (flash, bars, underline, frame, corners, panel, wipe, glitch, focus, progress, ticker, chart; underline, frame and corners with their stroke options) |
| [03 Transitions](./effects-tour/03-transitions.json)           | cut, fade, fadeblack, dissolve, the 12 designed transitions (push, swipe, zoom-through, iris, whips) and two xfade names, each beat naming the transition that ends it, so the name is on screen as it plays                                                                                       |
| [04 Captions](./effects-tour/04-captions.json)                 | Title cards, the six lower-third looks, the caption styles with balanced wrapping, and word-timed subtitles in all six caption DNAs (word / fill / pop karaoke, an SRT cue, a crowned line)                                                                                                        |
| [05 Compositing & light](./effects-tour/05-compositing.json)   | A horizontal three-pane split, a vertical split with a divider, a before/after wipe, then the 13 `fx` primitives: sheen, edge-glow, leak, bloom, ripple, glint, confetti, bokeh, dust, vignette-breathe, grain, glass and resolve                                                                  |
| [06 Themes](./effects-tour/)                                   | One template per built-in theme (`06-theme-*.json`: leclap, midnight, editorial, bold at energy 1.5, neon, paper at energy 0, sunset, ocean, mono, candy, retro, corporate), styled only with `$color.*` / `$font.*` tokens, plus a beat showing each motion role                                  |
| [07 Looks & grade](./effects-tour/07-looks.json)               | The 17 look presets, a LUT look at strength 1 and 0.35, a hand grade, a user `.cube` LUT                                                                                                                                                                                                           |
| [08 Footage](./effects-tour/08-footage.json)                   | Fit blur / letterbox / cover with a focus anchor, a keyframed focus pan, a clip range, the five speed-ramp presets, a freeze with a flash, a B-roll cutaway                                                                                                                                        |
| [09 Sound](./effects-tour/09-sound.json)                       | A 120 BPM `global.beats` grid with a click track of placed sounds, automatic hits and whooshes, every bundled sound effect on its event, a preset, the same preset varied and a sound composed from layers, the five voice presets with a volume fade-up                                           |
| [10 Music](./effects-tour/10-music.json)                       | A music bed fading in with `audio.automation`, per-section `musicVolume`, a volume swell, `audio.ducking` under a voice, and cuts on the beat of the analysed track (`global.beats: { analyze: "music" }`)                                                                                         |

`global.theme` is template-wide, so each chapter is its own standalone template and `effects-tour.json` strings their renders together as `video` sections, between ink chapter cards, with designed transitions and automatic whooshes. [`effects-tour.sh`](./effects-tour.sh) stages the bundled assets, generates the footage clips (the bundled photographs set in motion under a running clock, with lavfi audio), renders every chapter with the CLI and then the tour:

```bash
pnpm --filter ffmpeg-video-composer build && pnpm --filter @leclap/cli build
bash examples/motion-design/effects-tour.sh          # chapters, then the tour
bash examples/motion-design/effects-tour.sh 04 07    # re-render two chapters, then the tour
```

The delivery encode lands in `build/effects-tour/effects-tour.mp4`. Watch it in the web app at `/showcase?sample=effects-tour`.

## Type impact

[`type-impact.json`](./type-impact.json) is a new three-scene native typography study: opposing headline arrivals, a pink counterpoint and a stable final invitation. Its creative direction calls for fast entrances followed by readable holds. Configure `reveal` / `exit` duration, distance, easing and delay on each text filter; the final title card exposes line stagger. It uses bundled Bebas Neue and Oswald fonts and needs no footage. Watch it in the web app at `/showcase?sample=type-impact`.

## Spring kinetics

[`spring-kinetics.json`](./spring-kinetics.json) is a two-scene study of the motion system. The headline lands on an authored `$land` spring while its `scale` track settles on `$bouncy`. The support line slides in on `$snappy` with no duration authored, so the spring's own settle time sets it. The counterpoint enters on the app's `$expo` curve and leaves with `ease-in-back` anticipation. `global.motion` defines the tokens and the energy dial, and `global.seed` fixes the grain. It is asset-free (bundled Bebas Neue) and renders byte-identically on a given platform:

```bash
leclap render examples/motion-design/spring-kinetics.json \
  --assets packages/leclap-creative-kit/src/library --output spring-kinetics.mp4 --manifest
leclap verify spring-kinetics.mp4.manifest.json --rerender --assets packages/leclap-creative-kit/src/library
```

Set `global.motion.energy` to `0` for the reduced-motion cut (fades only) or `1.5` for more travel. See [motion system](../../docs/template-configuration.md#motion-system).

## Kinetic type

[`kinetic-type.json`](./kinetic-type.json) runs every kinetic preset across five beats:

- A cascade headline with an accent word, over a highlight marker sweep.
- A tracking-in brand title over a typewriter line.
- A counter rolling to 98.6% under a fade label.
- impact, pop, scramble and wave.
- A split statement and a drop with an accented first word.

It is asset-free (bundled fonts), deterministic, and renders on every backend. See [kinetic typography](../../docs/template-configuration.md#kinetic-typography).

## Word captions

[`word-captions.json`](./word-captions.json) turns speech-to-text word timings into designed captions, in two scenes:

- `clean`: white Rubik with a soft shadow; the spoken word lights up in yellow (`word` karaoke). Phrases break on sentence ends, commas followed by a pause, and pauses.
- `loud`: Anton capitals with a thick outline; each word pops in pink (`pop` karaoke), at most three words per phrase, and the closing exclamation is crowned larger (`"crown": "auto"`).

Each phrase is fitted to at most two balanced lines, held for at least a second, and drawn with plain `drawtext` / `drawbox` filters gated by `enable` windows. It needs no footage, and the same JSON renders the same bytes on every run.

## Motion FX pack

[`fx-pack.json`](./fx-pack.json) strings five beats together with whip transitions: a glitch hook whose punch word smears in on a kinetic `trail`, a rack-focus title framed by corners, a bar chart that grows and counts up under a progress bar, a looping ticker, and a close that shows the lower-third styles (`side-rule`, `clean-bar`, `kicker`, `stack-bars`, `pill`). Asset-free. Watch it at `/showcase?sample=fx-pack`.

## One story, three formats

[`formats.json`](./formats.json) is one launch story composed for 16:9, 9:16 and 1:1. `$format` markers set per-format sizes, positions and holds; `formats.portrait` / `formats.square` patch sections by element id (the square cut drops the proof beat). Render every format with `leclap render formats.json --formats all` (one file per format); the showcase previews the landscape cut.

```bash
leclap render examples/motion-design/formats.json --formats all \
  --assets packages/leclap-creative-kit/src/library -o formats.mp4
```

## Filled type

[`kinetic-fills.json`](./kinetic-fills.json) fills kinetic letters instead of colouring them: a two-colour `gradient`, the bundled golden-hour photograph as a `texture`, and a brand word with a three-stop gradient and a repeating shimmer `sweep`. Each block keeps a solid `color` as the fallback for engines without `alphamerge`.

## Split screens and wipes

[`split-layouts.json`](./split-layouts.json) uses `sections[].layout` with bundled photos: three panes side by side with a gap, two stacked panes with a divider, and a `before-after` wipe whose BEFORE and AFTER labels sit on either side of the moving edge.

## Right-to-left type

[`rtl-type.json`](./rtl-type.json) animates Arabic (`noto-arabic`) and Hebrew (`noto-hebrew`) headlines a line at a time (`unit: "line"`), so letters stay joined and shaped (`text_shaping` on FFmpeg builds with libfribidi). Each beat carries a small Latin gloss; the close sets both scripts side by side.

## Emoji in type

[`emoji-type.json`](./emoji-type.json) puts colour emoji in a kinetic headline, in an emoji-only row that pops one by one, and in a title card. Each emoji is composited as a bundled image in the measured gap of its line and animates with its word.

## On the beat

[`beat-grid.json`](./beat-grid.json) declares `global.beats` (120 BPM, 4/4). Sections last `{ "bars": 1 }` or `{ "bars": 2 }`, entrances use `beat:n` / `bar:n` references, the drop punches the camera on every beat and flashes on each downbeat, and `global.sfx` lays a click track (tick on beats, hit on downbeats, a riser and a boom into the drop) on the same grid. It needs no music file.

## Theme, roles and safe zones

[`theme-roles.json`](./theme-roles.json) is a portrait promo for `global.platform: "tiktok"` on the `neon` theme. Colours and fonts are `$color.*` / `$font.*` tokens; every animated element declares a motion `role` (headline, accent, panel, micro, camera, mascot) instead of an ease, and sections declare their narrative `role` and `purpose`. All copy stays inside TikTok's safe zones, so validation reports no `platform_ui_overlap`.

## Footage editing

[`footage-edit.json`](./footage-edit.json) shows one footage control per recorded scene: `fit: "blur"` for a vertical clip in a landscape frame, a keyframed `focus` pan with a user LUT (`grade.lut`), a `clip` range on the `bullet` speed ramp, a `freeze` with a flash and a shutter sound, and a B-roll `cutaways` entry under a LUT look at `strength: 0.6`. The B-roll and LUT are `{{ broll }}` / `{{ lut }}` variables: point them at your own clip and `.cube` file. The showcase preview records the scenes with generated clips (see the [showcase README](../showcase/README.md#effects--editing)).

## Sound design

[`sound-design.json`](./sound-design.json) scores an edit from JSON: `global.audio.sfx: "auto"` adds a hit on the impact landing and whooshes on the designed transitions, a `drop` cue gets an automatic riser plus an authored boom and flash, the recorded line uses the `clean` voice preset and `audioAutomation` to fade in and out, and the close rings once. Every sound comes from the bundled library.

[`composed-sounds.json`](./composed-sounds.json) composes every sound in the template instead (`sfx[].sound`): a glide-and-noise impact, a varied `whoosh` preset, a riser built from a swept tone and air that ends on the drop with a varied `boom`, and two bell strikes a fifth apart. Check each with the MCP `analyze_sound` tool before placing it; see [Composed sounds](../../docs/template-configuration.md#composed-sounds).

## HTML layers

HTML and CSS (`inputs[].type: "html"`) lay out what positioned `drawtext` can't: cards, badges, chips, tables and text with mixed weights. Each layer is drawn once into a transparent PNG, then moves like any image overlay (`rise`, `slide-*`, `fade`, under a camera move). The copy comes from typed `global.fields`, the colours and faces from `$color.*` / `$font.*` tokens. HTML layers render on Node, in the browser and in the LeClap app, byte for byte alike; see [HTML layers](../../docs/template-configuration.md#html-layers).

| Sample                                             | Format    | What it shows                                                                                                                                                                            |
| -------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`html-card.json`](./html-card.json)               | landscape | A three-scene listing reel: address card and price tag, a stat row with feature chips, an agent card with a portrait                                                                     |
| [`html-brand-font.json`](./html-brand-font.json)   | landscape | An offer card in the template's own fonts (`global.fonts`): a display face and a script, selected by `font-family`. Render with `--fonts packages/leclap-creative-kit/src/library/fonts` |
| [`html-testimonial.json`](./html-testimonial.json) | portrait  | A Reels quote with bold accent words inside one sentence, a round portrait, star chips cut with `clip-path`                                                                              |
| [`html-speaker.json`](./html-speaker.json)         | landscape | A conference opener and lower third: a text wordmark, a talk title that wraps in its box, time and room badges                                                                           |
| [`html-stats.json`](./html-stats.json)             | square    | Stat tiles that land in reading order and a spec list with values aligned right; a landscape cut via `$format`                                                                           |

Images inside a layer (`<img src>`, CSS `url()`) name bundled backgrounds by their `/assets/backgrounds/…` path, like the sections' `pictureUrl`, so the CLI, the web app and the phone all stage them.

## Native controls

[`native-timing.json`](./native-timing.json) is a landscape, asset-free demonstration with bundled fonts. It includes a broadcast-inspired frame, a title card with configurable line stagger, and coordinated exits on positioned text.

```json
{
  "titleCard": {
    "kicker": { "en": "MOTION / STUDY" },
    "headline": { "en": "Designed to move" },
    "subtitle": { "en": "Arrive. Settle. Hold." },
    "stagger": 0.07,
    "reveal": { "type": "rise", "delay": 0.12, "duration": 0.28, "distance": 36, "easing": "ease-out" },
    "fade": { "in": false, "out": false }
  }
}
```

`stagger` is seconds between non-empty lines, 0..1, default 0.15. It changes the cadence, not the scene length. Budget the scene for the last line's arrival and a readable hold. Detaching a card into positioned text preserves the emitted line delays. The existing live title-card preview shows the resting layout; render a preview to inspect stagger timing.

A positioned `drawtext` filter can use:

```json
{
  "exit": { "type": "slide-left", "after": 2.7, "duration": 0.24, "distance": 32, "easing": "ease-out" }
}
```

Exit timing is seconds from the section start. Its easing supports `linear`, `ease-out` and `ease-in-out`; omitted easing keeps the existing linear renderer behavior. `caption.exit` and `titleCard.exit` are not part of this contract. These controls lower to existing FFmpeg expression math, with no additional filter or dependency.

## Registered Remotion controls

The companion [`studio.editorial-type` effect](../llm-remotion-title/editorial-template.json) adds `masked-rise`, `word-stagger` and `highlight` modes. Discovery exposes the strict props schema; the LLM selects a mode, timing, travel and accent through JSON. Trusted operator code supplies the composition. Use the existing effect catalog and render/preview tools described in the [example README](../llm-remotion-title/README.md).

The registered output remains an opaque 1280×720, 30fps, 10-second scene. It is not a transparent overlay or an automatic portrait adaptation. Every animation uses frame time; there are no CSS animation timelines, timers or unseeded random values.

## Template choreography

| Template       | Motion personality                                                  | Review priority                                                              |
| -------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| App Tutorial   | Quiet numbered cues, short lifts, stable screen walkthrough         | Preserve UI pixels and readable captions                                     |
| Square Promo   | Opposing editorial arrivals and restrained fixed-word overshoot     | Settle rapidly, then hold the final statement                                |
| Product Launch | Centered vertical reveal and offer-first finish                     | Keep the optical axis stable and avoid decorative lateral movement           |
| Web App Promo  | Directional headline, floating perspective capture, held final CTA  | Preserve the full capture and keep its caption outside the perspective plane |
| Story Reel     | Alternating caption anchors, brief chapter cues, held final chapter | Maintain continuity through cuts and keep faces clear                        |

Review entrance frames at 15fps or denser, a settled hold, the last 0.3 seconds before a cut, and the final frame. Validate maximum form-copy lengths with the actual bundled fonts. Contact sheets prove composition and timing states; playback or dense sequences are needed to assess motion feel. Audio level measurements do not replace listening.

## Next engine integrations

- Timestamped caption words with explicit `{text, start, end, emphasis}` values and validated locale timing.
- A native HUD recipe with scale-relative safe areas and authored labels/data rather than fabricated metrics.
- Tracking keyframes in normalized coordinates with explicit interpolation and association to a source clip.
- A bounded multi-video Remotion montage registered through the current trusted catalog, with decoding/memory measurements and source timing checks.

Keep native motion small and portable; use Remotion where its layout and typography capabilities avoid rebuilding a browser compositor.

## Floating screen capture

The shared [Web App Promo template](../../packages/leclap-creative-kit/src/templates/web-app-promo.json) frames the uploaded recording as a floating screen. Native JSON filters contain the full input, add a thin border/window header and a hard depth edge, and animate a shallow perspective sweep over six seconds. The real cursor and UI animations stay in the recorded footage; no simulated clicks or highlights are added. The recording is conformed to 30fps before perspective so a 25fps source retains its six-second timing.

The `perspective` filter uses destination corner expressions, evaluated per frame. Its `0.055` vertical corner travel and `0.025` top inset are the advanced JSON controls for this recipe. The feature caption is drawn afterwards on a level band. A final `scale` with `value: "output"` conforms the completed layout to the actual export dimensions without stretching; the authored composition is landscape, with letterboxing if exported in another orientation. The recording step defaults to screen capture and also allows upload.

The template works with desktop FFmpeg and the app's pinned WASM core. FFmpeg's perspective filter is GPL; the existing mobile LGPL compatibility path drops that filter with a warning and retains the flat framed recording and caption. This recipe is a perspective projection of a recorded plane, not a mesh/lighting engine. No Three.js dependency or intermediate video is needed.

The shared editor preserves advanced video filter stages around editable text. Opening, editing and saving the sample keeps its framing, projection and output conformance. Retained filters can be edited through the JSON view; the lightweight live canvas does not simulate the projection, so use a rendered preview to judge the result.
