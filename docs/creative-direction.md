# Creative direction for video templates

Write the visual intention before choosing effects. Store it in `meta.creativeDirection` so a human
or agent can keep that intention while editing the same descriptor. It is optional plain text,
trimmed, with 1–4000 characters. Existing templates work without it. The editor preserves it on save.

```json
{
  "meta": {
    "name": "Product demo",
    "creativeDirection": "Audience: new users. Direction: a confident editorial demo. Make the real interface the hero; use dark ink, white condensed type and lavender. Vary the hook, demo and invitation layouts. Use short eased entrances and a stable CTA hold. Avoid invented interactions, repetitive cards and motion over controls. Review entrance, settling, screen crop, longest copy and ending."
  }
}
```

This partial descriptor illustrates metadata. Add explicit `global` and `sections` settings to render
a video. The engine does **not** interpret the brief, select effects, generate code or change timing.
Writing “use 3D” here alone produces no 3D effect. A human or LLM must implement the direction through
validated JSON or the props of a trusted registered Remotion component. Keep actual copy, product
facts and assets separate from stylistic intent.

## A useful brief

Include audience and desired action, the dominant element of each scene, typography and palette,
motion character, pacing, things to avoid and concrete review criteria. Use the actual product's
assets and approved facts. Choose a treatment that serves the scene; do not reuse the same card
layout with different colors for every template.

| Direction                 | Explicit implementation                                                           | Review                                                           |
| ------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Bold editorial invitation | Contrasting type, deliberate anchors, a short `reveal`, readable section duration | Longest copy, travel bounds, settled CTA and final hold          |
| Screen-first tutorial     | `project_video`, restrained captions and a contained recording                    | Cursor, controls, caption obstruction and crop                   |
| Floating product screen   | Web App Promo's native frame and perspective filter stages                        | Actual interaction, projection settling and flat mobile fallback |
| Per-word choreography     | Discover an effect with `get_effect_schema`; set supported props                  | `render_preview` at entrance, peak travel, settling and ending   |

Prefer native JSON for existing footage, text, layers, audio and motion primitives. Choose Remotion
when the storyboard needs choreography or components beyond those primitives. Registered effects
use the configured Node/Chromium backend; their output contract currently fixes landscape 1280×720,
30 fps and 300 frames. Check the effect schema rather than assuming orientation or prop support.

Keep the brief and motion settings in template JSON, media/field bindings and encoder choices in
host `ProjectConfig`, and Remotion entry/catalog/browser/deadline/cache settings in MCP startup
configuration. See [engine configuration](./engine-configuration.md) for precedence and defaults.

Direction metadata adds no rendering work. Native cuts avoid the full-timeline re-encode required by
non-cut transitions. Reuse unchanged registered-effect requests through the existing cache, and
preview the changed beat before rendering the whole video. Pin source, props, assets and runtime for
repeatability; different encoders/backends can produce different bytes.

## CLI

```bash
leclap init product-demo --no-mcp --no-remotion \
  --creative-direction "Editorial product demo. Screen first, short type entrances, readable CTA."
```

`init` embeds the supplied brief in `template.json` and explains it in the generated README. Without
the flag, the starter includes direction describing its existing composition. The flag does not
redesign the starter. Edit its settings, run `leclap validate template.json`, then render and inspect
the actual entrance, settled frame and ending. Empty or overlong supplied briefs are rejected.

For a full production, `leclap init --studio <dir>` scaffolds a brief, a style guide, a shot list and a
`template.json` whose sections carry a `purpose` and a `role`, with `meta.brief` set so a section without
a purpose is flagged. `leclap studio status` and `leclap studio pass <gate>` track the review gates. A
reference look becomes a theme with `leclap style <image|clip>`; see
[Match a reference](./template-configuration.md#match-a-reference).

## MCP

The `compose-video` prompt accepts `goal`, `orientation` and optional `creativeDirection`. Pass the
brief as text; for an existing descriptor, read its metadata first and preserve or intentionally
revise that direction. `get_template_schema` includes the field and authoring guidance.

```json
{
  "goal": "A short promotion using our actual app capture",
  "orientation": "landscape",
  "creativeDirection": "Bold editorial. Make the interface the hero; dark ink and lavender, short eased type entrances, different hook/demo/CTA layouts and a long readable ending."
}
```

These are **prompt arguments**, not `compose_video` tool arguments. Author the descriptor, discover
exact effect contracts when needed, and validate. For registered effect scenes inspect selected
frames or a short range with `render_preview`; for native scenes render through the engine and
extract frames. Check both against the brief, fix concrete problems, and compose the final video.
Validation checks the descriptor and geometry; it does not grade whether the design fulfills prose.

## Discover an installed sample

Start with `leclap samples list --category app-demos --backend native`, then
`leclap samples show web-app-promo`. In MCP, call `list_samples` with those filters and
`get_sample` with `{ "id": "web-app-promo" }`. Both expose the same 47 showcase entries, their authored
creative direction and actual input requirements. Use `--query` / `query` to search direction as well as
ID, title and description.

Export with `leclap samples export web-app-promo --output app-demo.json` (creates a new file without
overwriting), or take the MCP result's `template`. Partials are embedded. Adapt the brief and explicit
settings together, replace sample copy, supply named clips and fields, then validate and render.
Preview media is not packaged; provide or replace listed media and font references. Effective font
requirements from presets are marked `source: "preset"` and retain family metadata when available.

For the CLI, bind native inputs with repeatable `--video section=path` and `--field key=value` flags.
Use the effective section name, including any partial prefix. MCP accepts the corresponding
`userVideoPaths` and `fields` objects in `compose_video`.

Native samples use existing FFmpeg backends. Registered Remotion samples remain discoverable with
execution disabled, but rendering requires the opted-in MCP Node/Chromium backend, peers and a trusted
configured entry. An effect marked `customCatalog: true` additionally requires operator registration
through `--effect-catalog`; sample JSON includes no executable source. Inspect `requirements.setup`
and the configured `get_effect_schema` contract before choosing supported props. The CLI discovery
commands do not add direct registered-effect rendering.

## Examples to adapt

- [Web App Promo](../packages/leclap-creative-kit/src/templates/web-app-promo.json): editorial hook,
  floating actual capture and contrasting invitation.
- [Product Launch](../packages/leclap-creative-kit/src/templates/product-launch.json): minimal vertical
  product reveal and an offer-led ending.
- [App Tutorial](../packages/leclap-creative-kit/src/templates/app-tutorial.json): calm square instruction.
- [Square Promo](../packages/leclap-creative-kit/src/templates/square-promo.json): graphic contrasting panels.
- [Story Reel](../packages/leclap-creative-kit/src/templates/story-reel.json): full-bleed chapters and captions.
- [Native timing study](../examples/motion-design/native-timing.json) and
  [registered editorial effect](../examples/llm-remotion-title/editorial-template.json): two rendering
  routes for deliberate typography.

The [Remotion authoring recipe](../examples/llm-remotion-title/AGENT-AUTHORING.md) describes storyboard
and preview selection. Synthetic reference assets remain illustrations; use verified product media
before presenting an example as an actual promotion.

## Choosing the new motion treatments

Use `reveal.easing: "ease-out-back"` for a small overshoot on native headlines, captions and positioned text. Keep travel modest, leave room beyond the resting position and reserve the effect for a dominant beat. Calm instructional captions can keep `ease-out`. The easing uses ordinary FFmpeg expression math and needs no additional filter or worker.

The shared animation library includes `focus-lock`, `light-pass` and `frame-reveal`. Their finite JSON layers expose position, size, start, duration and opacity for adjustment. See the [recipe fixture](../examples/overlay-effects/README.md) before placing an accent on real footage.

For per-word choreography on Node, discover `studio.editorial-type` through MCP and choose `blur-rise`, `split-slide` or `elastic-stagger` with explicit bounded props. See the [registered variants](../examples/llm-remotion-title/README.md#editorial-typography). These Remotion treatments require the configured worker; portable app samples use native text easing and bundled APNG inputs.
