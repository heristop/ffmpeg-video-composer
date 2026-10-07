# Effect recipes

The example descriptors include `meta.creativeDirection` with their visual intent and review criteria.
See the [creative-direction guide](../../docs/creative-direction.md) for CLI and MCP authoring.

The [engine configuration reference](../../docs/engine-configuration.md) separates descriptor orientation/fps from host paths, media bindings and encoder settings. These recipes need no MCP Remotion opt-in, no effect catalog and no asset files.

The six recipes each layer two engine primitives: `graphics[]` entries of [`type: "fx"`](../../docs/template-configuration.md#light-and-effects-graphicstype-fx) and the [strokes](../../docs/template-configuration.md#strokes-frame-corners-underline). They render through LeClap's Node, browser/WASM and native FFmpeg routes.

| Recipe              | Purpose                                      | Parts                                                                   |
| ------------------- | -------------------------------------------- | ----------------------------------------------------------------------- |
| `interface-focus`   | Draw attention to an actual interface action | `corners` closing in on the card, then an fx `ripple` tap on it         |
| `product-spotlight` | Give a product detail a brief reveal         | An fx `sheen` across the card, then two `glint` lights orbiting it      |
| `celebration-burst` | Mark a success, offer or final invitation    | An fx `confetti` burst from the card, then `glint` stars on its corners |
| `focus-lock`        | Introduce a framed detail                    | `corners` that extend together, then an fx `ripple` ring                |
| `light-pass`        | Give a scene a brief lighting beat           | An fx `leak` from one edge, then a few `glint` stars on the card        |
| `frame-reveal`      | Introduce a framed composition               | A `frame` traced around the card, then an fx `sheen` across it          |

The shared creative-kit `ANIMATION_EFFECT_PRESETS` catalog builds these recipes. Each part lands on the scene's main card (`target: "layer:<i>"`, its largest `color_background` layer) with parameters derived from it: its size and aspect, the section length, the theme tokens (`$color.accent`, `$color.fg`) and a per-placement seed. Saved templates keep the portable JSON contract: the recipe expands into ordinary `graphics[]` entries, which the author then tunes like any other pick. The app's animation library offers the same choices next to the individual primitives.

The bundled APNG animations (`animations/*.apng`) are samples. Templates that reference them keep rendering them unchanged, but new motion is composed from the engine: `validate_template` reports `library_animation_sample` and names the primitive that replaces each one.

## Placement and restraint

Each recipe keeps at most two effects in a beat and holds cleanly after them. Effects anchored to a `target` follow it in every orientation, so a recipe needs no per-format coordinates. Tune at least the look parameters (the sameness lint reports `fx_untuned` otherwise), keep light under its ceiling (`intensity` ≤ 0.6 over skin), and keep effects clear of copy and controls. Every primitive is bounded to its window, so it costs nothing outside it, and uses only filters available on device.

## Preview fixture

[`preview-template.json`](./preview-template.json) contains three six-second scenes and three four-second scenes with contrasting backgrounds and bundled fonts. Landscape is the default. It needs no user footage. The card and the target are synthetic shapes, not a captured product interface. Their positions and sizes use frame-relative expressions: the card is centred, the title and footer stay separate from it. Each scene's `graphics` were built with the recipe and then tuned (the light-pass leak is larger and reaches lower into the shadows; the glints are larger), as an author would.

The fixture renders in every orientation: set `global.orientation` and the effects follow the card. For a Node render, use `packages/leclap-creative-kit/src/library` as `ProjectConfig.assetsDir`, the fixture as the descriptor, and a separate output directory. Inspect the entrance, the strongest effect frame, completion and the clear hold after each effect, on both bright and dark backgrounds.

To adapt this fixture to actual footage, replace the colour background with a video section and target the effect at the interaction or product detail (a `{ x, y, w, h, radius }` rectangle, or a pane). Keep copy clear of the effect and important controls. Validate the final descriptor and inspect its rendered motion before export.
