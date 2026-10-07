# Effects configuration

This reference covers the registered JSON effects shipped with the MCP backend and the runnable example catalog. Native motion, typography, looks, layers and overlays are documented in [template configuration](./template-configuration.md); encoder, path, concurrency and server settings belong to [engine configuration](./engine-configuration.md).

The engine accepts effect references as data. It does not execute React source itself. MCP uses an operator-configured, trusted Node/Remotion renderer and lowers each resolved effect to an ordinary clip before FFmpeg assembly. The contracts below are generated from the actual schemas; rerun `pnpm docs:effects` after changing a contract. An operator's additional effects must be discovered from that running server with `get_effect_schema`.

## Choose an effect route

| Route                    | Configuration                                                                                                                                         | Execution                                                           | Best suited to                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Native FFmpeg scene      | `caption`, `titleCard`, `lowerThird`, `reveal`, `motion`, `layers`, `look`, `grade`, `graphics` (including `type: "fx"`), `inputs`, `filters`, `maps` | Node, WASM, on-device; individual filters depend on the backend     | Portable text, footage, overlays, camera motion, grading and compositing                      |
| Registered effect        | `type: "effect"`, exact ID/version, bounded props and named assets                                                                                    | Opted-in MCP Node/Chromium backend or caller-supplied core resolver | Discoverable choreography controlled through strict JSON                                      |
| Own Remotion composition | `render_remotion_clip` with composition ID and input props                                                                                            | Opted-in Node/Chromium worker                                       | Code-driven layouts beyond registered contracts; feed the returned clip into a native section |

Procedural light and texture (a sheen across a card, a light leak, glints, a tap ripple, confetti, a frosted glass plate, a resolving title) is native: `graphics[]` entries with `type: "fx"`, documented in [light and effects](./template-configuration.md#light-and-effects-graphicstype-fx). It needs no registered effect.

A native sample named `web-app-promo` differs from the registered `leclap.web-app-promo` effect. The native sample uses captured video and FFmpeg framing/perspective stages. The registered effect takes a still `screenshot` asset, not a video asset. Sample IDs describe complete templates; effect IDs describe registered scene implementations.

## Effect section contract

```json
{
  "global": { "orientation": "landscape", "fps": 30, "musicEnabled": false },
  "sections": [
    {
      "name": "product",
      "type": "effect",
      "effect": {
        "id": "studio.product-reveal",
        "version": "1.0.0",
        "props": { "headline": "Meet your next favorite", "accent": "mint", "entranceDurationFrames": 36 },
        "assets": {}
      },
      "options": { "duration": 10 }
    }
  ]
}
```

| Field                   | Contract                                                                                                                                                                    |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                  | Required scene identity; effect names must be unique after partial expansion. Use expanded names for bindings, preview and patch tools.                                     |
| `type`                  | Exactly `effect`.                                                                                                                                                           |
| `effect.id`             | Safe registered identifier. Namespaces may use dots or slash-separated identifiers. Must match an installed catalog entry.                                                  |
| `effect.version`        | Exact semantic version, including valid prerelease/build suffixes. No ranges, tags or `latest`.                                                                             |
| `effect.props`          | Required JSON object. No functions or executable code; only concrete values for MCP, without `{{ placeholders }}`. Each effect has its own strict schema.                   |
| `effect.assets`         | Required object of named asset strings; `{}` for asset-free effects. Core references are platform-neutral, but MCP requires regular local files within its media root.      |
| `options.duration`      | Positive seconds; exactly `10` for the current MCP registered backend.                                                                                                      |
| Native finishing fields | Supported shared fields such as transitions, filters, grading, motion and captions remain on the section during lowering. See the descriptor schema for exact section keys. |

The current registered backend requires landscape 1280×720, 30 fps and 300 frames. Setting portrait, square, another fps or another duration does not adapt these compositions. The generic core resolver can support another renderer contract; it is the host's responsibility to validate its compatibility.

## Units and choreography

Native timings are seconds. Props with `Frames` in their name are integer frame counts at 30 fps: 15 frames = 0.5 seconds, 24 = 0.8 seconds, 90 = 3 seconds. Preview frames are scene-local and zero-based, from 0 to 299.

The built-in title and promo text props trim surrounding whitespace before applying their length bounds. Example catalog string bounds check raw length unless the trusted composition adds another check.

The title effect combines a muted background video, typography and a spring logo entrance. Its `springDamping` controls the spring response. Promo controls reveal timing, showcase/CTA beats and restrained camera zoom/tilt. The product reveal offers a bounded entrance duration and palette. Editorial typography provides six treatments:

| `studio.editorial-type` mode | Intended treatment                   | Controls to start with                                |
| ---------------------------- | ------------------------------------ | ----------------------------------------------------- |
| `masked-rise`                | Words emerge through a mask          | `entranceDurationFrames`, `staggerFrames`, `travelPx` |
| `word-stagger`               | Sequential word entrances            | `staggerFrames`, `travelPx`                           |
| `highlight`                  | Emphasize one selected word          | `highlightWord` (zero-based), `accent`                |
| `blur-rise`                  | Words resolve from blur while rising | `entranceDurationFrames`, `staggerFrames`, `travelPx` |
| `split-slide`                | Opposing word travel                 | `travelPx`, `staggerFrames`                           |
| `elastic-stagger`            | Spring-like word settling            | `entranceDurationFrames`, `staggerFrames`, `travelPx` |

Keep the longest headline readable, allow the last staggered word to settle, and inspect the ending. `highlightWord` is zero-based and clamped to the last rendered word when it exceeds the headline word count. The editorial headline must contain non-whitespace text. Headlines with more than 16 words keep all copy by grouping the tail into the last animated item. The example measures the unanimated layout and rejects copy that cannot fit the safe area at its minimum font size.

## Operator setup

Run from the repository root after installing workspace dependencies and building the engine/MCP. These are local example paths; replace media/output directories for your host.

```bash
pnpm --filter ffmpeg-video-composer build
pnpm --filter @leclap/mcp build
node packages/leclap-mcp/dist/index.js \
  --allow-remotion \
  --remotion-entry "$PWD/examples/llm-remotion-title/remotion/index.ts" \
  --effect-catalog "$PWD/examples/llm-remotion-title/effect-catalog.json" \
  --media-dir "$PWD/assets" \
  --output-dir "$PWD/build/mcp"
```

The example workspace supplies the optional Remotion peers. A standalone MCP install needs compatible v4 `@remotion/bundler` and `@remotion/renderer` plus the trusted project's dependencies. Chromium can be managed by Remotion or explicitly configured with `--remotion-browser`. The entry must register every selected composition. A catalog supplies contracts, not executable components, media or a browser. See [the runnable example](../examples/llm-remotion-title/README.md) for asset generation and complete setup.

`get_effect_schema`, `render_preview` and `render_remotion_clip` are opt-in. `list_samples`, `get_sample` and `patch_template` remain available with execution disabled. Direct CLI sample discovery does not add registered-effect rendering.

## Discover, validate, preview, edit, compose

1. Discover templates with `list_samples`; read a full descriptor and its requirements with `get_sample`.
2. Call `get_effect_schema` with `{ "list": true }`, then `{ "id": "studio.editorial-type", "version": "1.0.0" }`. Inspect the running operator's contract, defaults, asset slots, output and digest.
3. Author concrete props and asset paths. Preserve the sample's [creative direction](./creative-direction.md) while implementing it explicitly.
4. Call `validate_template`. Validation checks descriptor structure and reports advisory native text geometry; actual registered props/assets/backend preflight also runs before preview/composition. `render: true` is native text-contrast inspection, not an effect preview.
5. Call `render_preview` for a named effect section, using either `frames` (1..10 distinct indices in 0..299) or an inclusive `frameRange` (1..90 frames). Do not send both. Inspect entrance, overshoot, settled text and ending.
6. If needed, use `patch_template` with the returned current revision and named edits, then validate and preview again.
7. Call `compose_video` with the current `expectedRevision` and any required native clip/field bindings. Inspect the resulting video and its provenance.

```json
{
  "template": "<actual descriptor object>",
  "section": "product",
  "frames": [0, 12, 36, 90, 299],
  "expectedRevision": "<current revision>"
}
```

The strings above are explanatory placeholders; send an actual object for `template`. For a short moving preview use `"frameRange": { "from": 0, "to": 59 }` instead of `frames`.

`patch_template` takes `edits` with `{ "section": "product", "props": { "accent": "coral" } }`. It atomically updates named effect props and reports the new revision and changed sections. Use expanded names for partial instances. It preserves inline authoring and materializes only the edited registry instance. A stale `expectedRevision` rejects the request instead of silently overwriting newer JSON.

## Register another effect

The operator supplies a `schemaVersion: 1` catalog, with at most 64 effects and a 256 KiB file budget. Each entry has `id`, exact `version`, `compositionId`, optional `description`, a `propsSchema` and an `assets` object. Built-in IDs/compositions are reserved; custom ID/version pairs must be unique within the catalog. Keep executable source in the trusted Remotion project.

| Catalog property                 | Allowed contract                                                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `compositionId`                  | Letters/digits/hyphens, starts with a letter or digit; must match a composition in the trusted entry.                                            |
| `propsSchema.type`               | Root object. Types supported inside it: object, string, number, integer, boolean, array.                                                         |
| Common schema keywords           | `type`, `description`, `default`, `enum` plus the type-specific keywords below.                                                                  |
| Object keywords                  | `properties`, `required`, `additionalProperties: false`; every object is strict.                                                                 |
| String keywords                  | `minLength`, `maxLength`.                                                                                                                        |
| Number/integer keywords          | `minimum`, `maximum`.                                                                                                                            |
| Array keywords                   | `items`, `minItems`, `maxItems`.                                                                                                                 |
| Unsupported JSON Schema features | `$ref`, unions, `oneOf`, `anyOf`, patterns, formats and arbitrary extension keywords are rejected. Use the supported bounded subset.             |
| Asset slot declaration           | `extensions` (allowed non-empty list), `required` (default true), optional positive `minVideoDurationSeconds` for video-only slots.              |
| Supported extensions             | Images: `.png`, `.jpg`, `.jpeg`, `.webp`; fonts: `.ttf`, `.otf`, `.woff`, `.woff2`; video: `.mp4`, `.mov`, `.webm`, `.m4v`.                      |
| Property/asset keys              | Safe identifier keys; prototype-related keys are rejected.                                                                                       |
| Budgets                          | Prop schema depth ≤16, schema nodes ≤1024; catalog JSON depth ≤64 and nodes ≤20000; normalized defaults/data bounded to 256 KiB and 20000 nodes. |

Defaults are validated, not blindly trusted. Assets are realpath-contained, regular local files; symlink escapes, unsupported extensions and short required video inputs fail. Reference URLs in native sections follow native asset rules; they do not relax the registered asset policy.

## Cache, performance and reproducibility

The persistent registered-artifact cache defaults to 512 MiB and 256 entries under `<mediaDir>/.leclap-effects/cache-v1`. Configure `--effect-cache-max-bytes` or `LECLAP_MCP_EFFECT_CACHE_MAX_BYTES`; zero disables cache lookup/publication. Lookup follows asset staging, bundling and browser identification, so a hit saves effect rendering rather than every preparation step or final FFmpeg assembly. Source/dependency, props, asset, contract or browser changes invalidate reuse. Cache I/O failures fall back to rendering.

Workers have timeouts, cancellation and bounded queues. Preview only the changed scene before a full composition. Native cuts avoid the final transition re-encode; non-cut transitions cost another full timeline pass. Effect worker concurrency is distinct from native segment concurrency; see [engine configuration](./engine-configuration.md).

Retain JSON, exact effect source and dependencies, media/fonts, bindings, encoder settings and runtime versions. Revisions protect edits and provenance records inputs; neither is a complete replay lock or a guarantee of byte-identical video across hosts.

## Troubleshooting

| Failure                            | Check                                                                                                                                   |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `effect_backend_unavailable`       | Remotion opt-in, optional peers, trusted regular entry, or an unresolved effect passed directly to core compile.                        |
| `effect_not_registered`            | Exact ID/version and configured catalog; discover the actual running registry.                                                          |
| `effect_output_incompatible`       | Landscape 1280×720, 30 fps registered output contract.                                                                                  |
| `effect_duration_mismatch`         | Scene `options.duration` must equal 10 seconds.                                                                                         |
| `effect_placeholder_unresolved`    | Resolve `{{ variables }}` yourself in effect props/assets before sending them.                                                          |
| `effect_asset_invalid`             | Local file, allowed extension, required slot and video duration; check media-root containment.                                          |
| `effect_catalog_invalid`           | Unsupported keyword/type, unsafe key, incompatible default, duplicate/reserved identity or budget.                                      |
| Revision mismatch                  | Retrieve/revalidate the newest descriptor and use its revision for the next edit or render.                                             |
| Layout fits schema but looks wrong | Inspect actual frames with longest copy, contrast, screen crop, settling and CTA hold. Schema validation does not judge design quality. |

## Contract catalog

The following tables are generated from the built-in schemas and the committed example catalog. The example effects require explicit operator registration. Discover any other installed effect with `get_effect_schema` rather than assuming it is available.

<!-- generated-effect-contracts -->

## leclap.title-reveal@1.0.0

Built-in MCP contract. The operator must still supply a trusted Remotion entry registering the composition.

Composition: `LeclapTitle`.

### Props

| Prop                     | Type    | Required on input | Bounds / choices        | Default  | Description                                             |
| ------------------------ | ------- | ----------------- | ----------------------- | -------- | ------------------------------------------------------- |
| `headline`               | string  | no                | length ≥ 1; length ≤ 80 | "LECLAP" | Primary headline copy.                                  |
| `headlineY`              | number  | no                | ≥ 0; ≤ 720              | 320      | Top of the headline container in output pixels.         |
| `logoDelayFrames`        | integer | no                | ≥ 0; ≤ 299              | 15       | Scene-local frame when the logo spring entrance starts. |
| `entranceDurationFrames` | integer | no                | ≥ 1; ≤ 300              | 24       | Entrance window in frames at 30 fps.                    |
| `springDamping`          | number  | no                | ≥ 1; ≤ 100              | 18       | Spring damping; larger values reduce oscillation.       |

Defaults apply to omitted props. Unknown props and assets are rejected.

### Assets

| Slot         | Required | Extensions                | Minimum video seconds |
| ------------ | -------- | ------------------------- | --------------------- |
| `background` | yes      | .mp4, .mov, .webm, .m4v   | 10                    |
| `logo`       | yes      | .png, .jpg, .jpeg, .webp  | —                     |
| `font`       | yes      | .ttf, .otf, .woff, .woff2 | —                     |

### Cross-field and runtime rules

logoDelayFrames + entranceDurationFrames must be <= 300.

Absolute regular local files within mediaDir, realpath-contained. Background video (.mp4/.mov/.webm/.m4v) >=10s; logo .png/.jpg/.jpeg/.webp; font .ttf/.otf/.woff/.woff2. Extra props/assets rejected. No remote scene assets.

Output: 1280×720, 30 fps, 300 frames (10 seconds), opaque H.264.

## leclap.web-app-promo@1.0.0

Built-in MCP contract. The operator must still supply a trusted Remotion entry registering the composition.

Composition: `LeclapWebAppPromo`.

### Props

| Prop                     | Type    | Required on input | Bounds / choices                                        | Default                                                                  | Description                                                    |
| ------------------------ | ------- | ----------------- | ------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------- |
| `brand`                  | string  | no                | length ≥ 1; length ≤ 24                                 | "LeClap"                                                                 | Brand name displayed in the composition.                       |
| `eyebrow`                | string  | no                | length ≥ 1; length ≤ 40                                 | "FROM IDEA TO LAUNCH"                                                    | Short opening label above the headline.                        |
| `headline`               | string  | no                | length ≥ 1; length ≤ 56                                 | "Your next big idea. In motion."                                         | Primary headline copy.                                         |
| `subheadline`            | string  | no                | length ≥ 1; length ≤ 110                                | "Turn your product into a story worth watching."                         | Supporting opening copy.                                       |
| `cta`                    | string  | no                | length ≥ 1; length ≤ 28                                 | "Start creating"                                                         | Final invitation copy.                                         |
| `displayUrl`             | string  | no                | length ≥ 1; length ≤ 60                                 | "leclap.dev"                                                             | Display text only; no URL fetch.                               |
| `features`               | array   | no                | items ≥ 3; items ≤ 3; item length ≥ 1; item length ≤ 32 | ["Design with intent","Move with precision","Ship something remarkable"] | Exactly three feature labels; each trimmed and non-empty.      |
| `accent`                 | string  | no                | pattern ^#[0-9a-fA-F]{6}$                               | "#B9A2FF"                                                                | Accent color or named palette, according to the choices below. |
| `backgroundColor`        | string  | no                | pattern ^#[0-9a-fA-F]{6}$                               | "#111120"                                                                | Canvas background as six-digit hex.                            |
| `textColor`              | string  | no                | pattern ^#[0-9a-fA-F]{6}$                               | "#FFFFFF"                                                                | Foreground text as six-digit hex.                              |
| `showcaseStartFrame`     | integer | no                | ≥ 60; ≤ 150                                             | 90                                                                       | Scene-local frame when the product showcase begins.            |
| `ctaStartFrame`          | integer | no                | ≥ 210; ≤ 260                                            | 240                                                                      | Scene-local frame when the closing invitation begins.          |
| `entranceDurationFrames` | integer | no                | ≥ 12; ≤ 36                                              | 24                                                                       | Entrance window in frames at 30 fps.                           |
| `springDamping`          | number  | no                | ≥ 8; ≤ 40                                               | 20                                                                       | Spring damping; larger values reduce oscillation.              |
| `cameraZoom`             | number  | no                | ≥ 1; ≤ 1.15                                             | 1.06                                                                     | Camera zoom multiplier during the showcase.                    |
| `cameraTiltDegrees`      | number  | no                | ≥ 0; ≤ 12                                               | 8                                                                        | Camera tilt angle in degrees.                                  |

Defaults apply to omitted props. Unknown props and assets are rejected.

### Assets

| Slot         | Required | Extensions                | Minimum video seconds |
| ------------ | -------- | ------------------------- | --------------------- |
| `screenshot` | yes      | .png, .jpg, .jpeg, .webp  | —                     |
| `logo`       | yes      | .png, .jpg, .jpeg, .webp  | —                     |
| `font`       | yes      | .ttf, .otf, .woff, .woff2 | —                     |

### Cross-field and runtime rules

ctaStartFrame - showcaseStartFrame must be >= 90.

Absolute regular local files within mediaDir, realpath-contained. Screenshot and logo .png/.jpg/.jpeg/.webp; font .ttf/.otf/.woff/.woff2. Extra props/assets rejected. No remote scene assets. displayUrl is text only; never fetched.

Output: 1280×720, 30 fps, 300 frames (10 seconds), opaque H.264.

## studio.product-reveal@1.0.0

Example operator catalog contract. Enable the example catalog as well as the trusted Remotion entry; this effect is not registered by default.

Composition: `LeclapProductReveal`. An asset-free product reveal with bounded headline, accent and spring entrance controls.

### Props

| Prop                     | Type    | Required on input | Bounds / choices                   | Default                    | Description                                                    |
| ------------------------ | ------- | ----------------- | ---------------------------------- | -------------------------- | -------------------------------------------------------------- |
| `headline`               | string  | no                | length ≥ 1; length ≤ 80            | "Make something memorable" | Primary headline copy.                                         |
| `accent`                 | string  | no                | one of ["lavender","mint","coral"] | "lavender"                 | Accent color or named palette, according to the choices below. |
| `entranceDurationFrames` | integer | no                | ≥ 12; ≤ 90                         | 36                         | Entrance window in frames at 30 fps.                           |

Defaults apply to omitted props. Unknown props and assets are rejected.

### Assets

Asset-free: set `assets` to `{}`.

### Cross-field and runtime rules

Custom timing controls follow the declared props schema.

Regular local files within mediaDir, realpath-contained. Extra props/assets rejected. Video duration policies are explicit.

Output: 1280×720, 30 fps, 300 frames (10 seconds), opaque H.264.

## studio.editorial-type@1.0.0

Example operator catalog contract. Enable the example catalog as well as the trusted Remotion entry; this effect is not registered by default.

Composition: `LeclapEditorialType`. Asset-free masked, staggered, highlighted, blur-rise, opposing-slide or elastic editorial typography with bounded frame-time controls.

### Props

| Prop                     | Type    | Required on input | Bounds / choices                                                                              | Default                | Description                                                                                                                                  |
| ------------------------ | ------- | ----------------- | --------------------------------------------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `headline`               | string  | no                | length ≥ 1; length ≤ 80                                                                       | "Make your next story" | Headline must contain a non-whitespace character; checked during render preparation because the catalog string subset validates length only. |
| `kicker`                 | string  | no                | length ≤ 32                                                                                   | "CREATIVE DIRECTION"   | Short editorial label; an empty string is allowed.                                                                                           |
| `mode`                   | string  | no                | one of ["masked-rise","word-stagger","highlight","blur-rise","split-slide","elastic-stagger"] | "masked-rise"          | Typography choreography mode.                                                                                                                |
| `accent`                 | string  | no                | one of ["lavender","mint","orange"]                                                           | "orange"               | Accent color or named palette, according to the choices below.                                                                               |
| `entranceDurationFrames` | integer | no                | ≥ 8; ≤ 40                                                                                     | 18                     | Entrance window in frames at 30 fps.                                                                                                         |
| `staggerFrames`          | integer | no                | ≥ 0; ≤ 8                                                                                      | 3                      | Frame delay between consecutive word entrances.                                                                                              |
| `travelPx`               | number  | no                | ≥ 0; ≤ 100                                                                                    | 56                     | Word travel distance in output pixels.                                                                                                       |
| `highlightWord`          | integer | no                | ≥ 0; ≤ 15                                                                                     | 0                      | Zero-based highlighted item index; clamped to the last rendered item.                                                                        |

Defaults apply to omitted props. Unknown props and assets are rejected.

### Assets

Asset-free: set `assets` to `{}`.

### Cross-field and runtime rules

Custom timing controls follow the declared props schema.

Regular local files within mediaDir, realpath-contained. Extra props/assets rejected. Video duration policies are explicit.

Output: 1280×720, 30 fps, 300 frames (10 seconds), opaque H.264.
