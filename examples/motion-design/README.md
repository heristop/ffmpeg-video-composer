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

## Type impact

[`type-impact.json`](./type-impact.json) is a new three-scene native typography study: opposing headline arrivals, a pink counterpoint and a stable final invitation. Its creative direction calls for fast entrances followed by readable holds. Configure `reveal` / `exit` duration, distance, easing and delay on each text filter; the final title card exposes line stagger. It uses bundled Bebas Neue and Oswald fonts and needs no footage. Watch it in the web app at `/showcase?sample=type-impact`.

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
