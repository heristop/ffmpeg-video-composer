# JSON title effects through LeClap

The example descriptors include `meta.creativeDirection` with their visual intent and review criteria.
See the [creative-direction guide](../../docs/creative-direction.md) for CLI and MCP authoring.

This reference project keeps creative controls in LeClap JSON. A trusted Remotion component renders the title effect; LeClap then composes it with the ordinary outro section and exports the video.

See [engine configuration](../../docs/engine-configuration.md) for the boundary between descriptor,
host `ProjectConfig` and MCP runtime settings. Native output orientation/fps can vary; this registered
backend requires opaque H.264 at landscape 1280×720, 30 fps, 300 frames. Entry, browser, catalog,
media/output roots, timeout and cache budget are startup settings, never effect props.

## Typography samples

The registered editorial composition has standalone descriptors for [masked rise](./editorial-masked-rise.json), [word stagger](./editorial-word-stagger.json) and [highlight](./editorial-highlight.json), alongside blur rise, split slide and elastic stagger examples. Each records its creative direction and bounded motion props. All use the same registered composition and strict JSON contracts.

Browse their rendered previews and JSON in the web app’s `/showcase` page. The [showcase renderer](../showcase/README.md) generates the fixture media and composes them through the same trusted MCP entry and catalog used here.

## Prepare

From the repository root, build the core and MCP packages. Install the workspace's pinned dependencies:

```sh
pnpm --filter ffmpeg-video-composer build
pnpm --filter @leclap/mcp build
pnpm install
pnpm --filter leclap-json-effects-example typecheck
node examples/llm-remotion-title/generate-media.mjs /absolute/path/to/font.ttf
```

The generic example is a private workspace package with dependencies pinned in the root lockfile; CI lints and typechecks it without the optional private companion kit.

The fixture generator needs system FFmpeg and a local TTF font you are entitled to use. It creates a ten-second background, logo and font copy under ignored `media/`; replace these with your own media while retaining duration and slot names.

Configure the MCP server with absolute paths:

```text
LECLAP_MCP_ALLOW_REMOTION=1
LECLAP_MCP_REMOTION_ENTRY=/absolute/path/examples/llm-remotion-title/remotion/index.ts
LECLAP_MCP_MEDIA_DIR=/absolute/path/examples/llm-remotion-title
LECLAP_MCP_OUTPUT_DIR=/absolute/path/examples/llm-remotion-title/build
```

If using an installed compatible Chrome instead of downloading Chromium, set `LECLAP_MCP_REMOTION_BROWSER` to its executable path.

For storyboard planning, template variety and frame review, follow the [agent authoring recipe](./AGENT-AUTHORING.md).

## Agent workflow

1. Read `get_template_schema` and `get_effect_schema` for the registered `leclap.title-reveal@1.0.0` effect.
2. Submit `template.json` (its relative assets resolve under the configured media directory) to `validate_template`; keep the returned revision.
3. Use `render_preview` with `section: "intro"` and either `frames: [0, 15, 30, 150, 299]` or `frameRange: { "from": 0, "to": 89 }` (inclusive). Pass the expected revision to reject stale requests.
4. Call `patch_template` with the JSON, expected revision and a batch of semantic prop edits.
5. Inspect the new preview, then pass the revised JSON to `compose_video`. Use `get_effect_schema` without arguments for the title catalog, or pass its exact `id` and `version`.

For effects inside partials, preview and patch by the expanded section name, including its prefix.
Patching a registered partial materializes only that reference as an inline partial; shared definitions
and other instances remain unchanged. Queue wait, asset preflight, effect worker setup/render and
final FFmpeg rendering have separate deadlines. Cancellation stops active probes before releasing
the shared queue permit; repeated real paths are probed once per preflight request.

Example edit request:

```json
{
  "template": "replace this string with the actual template object",
  "expectedRevision": "revision returned by validate_template",
  "edits": [
    {
      "section": "intro",
      "props": {
        "headlineY": 260,
        "logoDelayFrames": 27,
        "springDamping": 25
      }
    }
  ]
}
```

The illustrative `template` and `expectedRevision` values above must be replaced before making a tool call. Patches return a new JSON document; save it for subsequent calls. No server-side saved-project store is implied.

## Boundaries

The registry accepts versioned title and web app promo IDs with typed controls. Source remains in `remotion/` and is editable with normal code tools. Keep its exact source/dependency versions alongside the JSON to recreate the effect. Changing source changes the implementation identity recorded for the render.

Output is opaque H.264. Transparent effects, full mobile graphics generation and a visual editor are not supported by this example. Additional fixed-output compositions can be registered with an operator JSON catalog as described below. The persistent cache is described below. Font width and visual pacing still need inspection of actual preview artifacts.

## Initial measured baseline

Local verification on an Apple M2 Pro (12 CPU cores, 32 GB RAM), Node 24.19.0, Remotion 4.0.509, Chrome 131.0.6778.70 and system FFmpeg 8.1.1 used the generated color/logo fixtures and a local Arial TTF. Rendering used one Remotion worker at 1280×720, 30 fps, H.264. These are single-run observations, not performance budgets; OS caches were not cleared.

| Operation                                            | Wall time | Returned media bytes |
| ---------------------------------------------------- | --------: | -------------------: |
| Five PNG frames (0, 15, 30, 150, 299), first request |    4.60 s |              111,627 |
| Same five frames, repeated request                   |    3.65 s |              111,627 |
| Inclusive range 0..29                                |    3.98 s |               66,057 |
| Registered Remotion title alone, 300 frames          |   26.12 s |              502,263 |
| Mixed LeClap project, title plus two-second outro    |   35.35 s |              355,837 |

All previews, the standalone title and the mixed composition reported the same implementation/input provenance hash; repeated PNG bytes also matched. `ffprobe` measured 10.000 seconds of video for the title, 1.000 for the range, and 11.933333 for the mixed project. Container durations include AAC padding (10.048, 1.045333 and 11.954362 seconds respectively); the mixed route retains the existing engine's frame trimming. The standalone route encodes the title once; mixed composition additionally normalizes its sections through FFmpeg. At this initial baseline, persistent effect caching was not yet implemented.

The whole verification command reported a maximum resident set of about 566 MiB. This is the command's resource report, not a sampled sum of simultaneously running Chromium/FFmpeg processes. Transient job directories were checked after rendering: preview files/provenance remained, while staged media, bundles and consumed composition clips were removed.

## Persistent effect reuse

Registered previews and full title clips reuse a bounded disk cache. By default it retains up to 512 MiB and 256 entries under the MCP media directory. Set `LECLAP_MCP_EFFECT_CACHE_MAX_BYTES=0` to disable it, or choose another integer byte budget. Preview replies include `cache`; composition replies include `effectCache`, each with `hits`, `misses` and `writes`.

Cache lookup follows fresh asset/source bundling and browser identification. This preserves invalidation for imported code and exact asset contents; it still pays preparation costs. The final FFmpeg assembly runs on each composition. One registered effect worker runs per MCP process, with at most eight queued jobs.

A subsequent local check on the same M2 Pro/runtime used a separate copy of the reference scene, `CACHE WITH LECLAP`, a 2 MiB cache budget and unchanged frame/output settings. OS caches were not cleared; these are single-run observations:

| Operation                        | Cache miss | Cache hit |
| -------------------------------- | ---------: | --------: |
| Five preview frames              |     8.24 s |    1.53 s |
| Same frames after restarting MCP |          — |    1.50 s |
| Inclusive range 0..29            |     4.61 s |    2.01 s |
| Title plus two-second outro      |    27.07 s |    2.70 s |

Repeated PNGs, range clips and composed MP4s matched by SHA256 in this fixture. Headline-position changes, imported palette-code edits and a logo-file replacement each produced a miss and new provenance. Disabling caching produced no hits or writes without changing implementation identity. The measured cache held nine entries totaling 746,360 artifact/manifest bytes before the additional asset-edit check. Corrupt entries, lower budgets, metadata mismatches, eviction, cancellation and non-regular files are covered by unit regressions.

The whole verification command reported about 950 MiB maximum resident set; this is not a sampled total across concurrent subprocesses. Cached composition avoids the effect encode while retaining the existing FFmpeg assembly work. Persistent bundle caching and whole-project incremental compilation are not implemented.

## Ten-second web app promo

`promo-template.json` selects `leclap.web-app-promo@1.0.0`. The default entry `remotion/index.ts` registers both `LeclapTitle` and `LeclapWebAppPromo`, so a template can combine either effect with ordinary LeClap sections. The promo uses three local assets: `screenshot`, `logo`, and `font`. Run the fixture generator above to create all four assets, including the original title background. Its screenshot is a deterministic geometric studio illustration, not an actual app capture.

`get_effect_schema({ list: true })` lists registered effects; `get_effect_schema` without arguments returns the title contract for compatibility. Read it with `id: "leclap.web-app-promo", version: "1.0.0"` for the exact contract. Validate `promo-template.json` and retain its revision. Preview `section: "promo"` at frames `[0, 45, 90, 150, 239, 260, 299]`; inspect the exported PNGs, including text bounds. Preview a short inclusive range around `showcaseStartFrame` to assess motion. Use `patch_template` with the returned revision and `edits: [{ section: "promo", props: { headline: "Make your next story", cameraTiltDegrees: 4 } }]`. Save the returned JSON, preview again, and pass it to `compose_video`. Repeat unchanged requests to inspect `cache` / `effectCache`; source, asset, browser and prop changes invalidate reuse.

The JSON surface controls all copy, three feature labels, palette, entrance duration, spring damping, showcase/CTA boundaries and camera movement. The showcase starts at frames 60–150, CTA at 210–260, with at least 90 frames between them. This registered composition stays 1280×720, 30 fps, 300 frames. `displayUrl` is a label, never fetched. Keep asset paths local and inside the configured media directory.

For a landing-page adaptation, give the LLM the real React/SVG source, local fonts/images, and a screenshot of the intended state. First extract the time-independent layout into a trusted component. Replace scroll progress, CSS transitions, requestAnimationFrame and timers with progress derived from `useCurrentFrame`, `interpolate` and `spring`. Preserve the actual typography, spacing and SVG paths. Drive the meaningful scene boundaries from the typed JSON controls. Leave geometry and rendering logic in trusted React source; JSON never contains arbitrary code or module paths. Inspect maximum-length text and scene boundaries before composition.

A screenshot-backed browser frame animates one raster image: it cannot reproduce live app DOM interactions. To recreate a moving landing-page interface, render its actual extracted components inside the browser viewport and bind their states to frame time. Operators register additional compositions and contracts through the startup catalog; composition implementation changes still require trusted code edits. Matching an unknown page exactly requires its source and assets; this example provides a reusable choreography, not pixel parity.

## Optional private LeClap film source

The supplied companion repository remains read-only. The importer snapshots only `src/film/cinema.tsx`, `src/film/clappy.tsx` and `src/brand.ts` byte-for-byte into ignored `remotion/brand-motion-kit/`, records SHA256 source/asset hashes in its ignored manifest, and generates a separate `fonts.ts` shim. Both shim and promo use `LeclapPromoFont`, loaded from the exact supplied `public/Oswald.ttf`. It copies `public/logo.png` and extracts a screenshot at one second from the actual local `studio-gallery.mp4` capture. No audio changes or other files in the reference repository are touched.

```sh
node examples/llm-remotion-title/import-brand-motion.mjs /absolute/path/leclap-brand-motion
# Optional second argument after the source repo: a different local capture MP4.
pnpm --dir examples/llm-remotion-title exec tsc -p tsconfig.brand-motion.json
```

Set `LECLAP_MCP_REMOTION_ENTRY` to the absolute `remotion/brand-motion-index.tsx` path, retaining the same media/output configuration and promo JSON. This adapter visibly reuses original Clappy, Sparks, Shockwave, Grain and Vignette, tied to the JSON timeline. The copied source is bundled and participates in render provenance/cache identity. Its original film palette is retained; the promo copy, camera and main palette remain controlled by JSON. The default entry and `tsconfig.json` are independent of this optional kit; use `pnpm --dir examples/llm-remotion-title exec tsc -p tsconfig.json` without staging it.

This is a ten-second adaptation of selected effects from the supplied 78-second `LeClapShowcase`, not a replay of the complete film. The complete film remains trusted Remotion code that can be rendered through `render_remotion_clip` with its own entry/composition. Catalog registration supports fixed ten-second compositions; general film-duration output remains future work. Private source/assets must stay out of public commits; the ignored snapshot is deliberately reproducible from the local companion repo.

## Verified promo rendering

The supplied source adapter and the generic entry were each exercised through the built stdio MCP: schema discovery, JSON validation, seven PNG frames, a 30-frame preview, revision-checked props edits, full composition and repeated cache hits. The final source-adapter export probes as H.264, 1280×720, 30 fps, exactly 300 frames / 10 seconds. Cached PNGs matched by SHA256. Copy/palette/camera edits changed provenance and missed cache; a temporary edit to the imported source palette changed actual PNG pixels and missed cache, then the original module was restored.

On the same M2 Pro/runtime listed above, the final source adapter took 6.06 seconds for seven frames versus 2.05 seconds cached, and 20.80 seconds for composition versus 2.64 seconds cached. These are single-run observations with OS caches retained, not guarantees. Preparation and final FFmpeg assembly still run.

Maximum-length unbroken copy was inspected with both supplied Oswald and a broader local Verdana font, at maximum camera motion and latest scene boundaries. The complete hero/closing blocks and header are fitted after the exact font loads; no copy is dropped. Generic and staged typechecks, 217 MCP tests, package build/typecheck and changed-file lint/format pass. The private snapshot modules match their original SHA256 values, and the companion repository remains unchanged. This evidence covers the ten-second adaptation; it does not establish full-film or cross-platform pixel parity.

## Custom product reveal

The third generic composition, `LeclapProductReveal`, uses only deterministic geometry, system typography and frame-driven Remotion springs. It requires no generated media, local font file or private source. Its bounded headline, accent enum and entrance duration are registered as `studio.product-reveal@1.0.0` in [effect-catalog.json](./effect-catalog.json); [custom-template.json](./custom-template.json) is ready for the existing tools.

After building the MCP package, launch with your actual absolute paths:

```sh
node packages/leclap-mcp/dist/index.js --allow-remotion \
  --remotion-entry /absolute/path/examples/llm-remotion-title/remotion/index.ts \
  --effect-catalog /absolute/path/examples/llm-remotion-title/effect-catalog.json \
  --media-dir /absolute/path/examples/llm-remotion-title \
  --output-dir /absolute/path/examples/llm-remotion-title/build
```

Alternatively set `LECLAP_MCP_EFFECT_CATALOG` alongside the earlier environment settings. CLI overrides the environment. The catalog is validated once at startup and held as an immutable snapshot; restart after catalog edits. A missing, invalid or oversized catalog fails startup. The server's trusted entry remains the only executable source. Keep composition defaults synchronized with the JSON contract.

1. Call `get_effect_schema` with `{ "list": true }`, then `{ "id": "studio.product-reveal", "version": "1.0.0" }`. Inspect defaults, bounds, output and `definitionHash`. The zero-argument call still describes the builtin title; do not combine `list: true` with `id` or `version`.
2. Read the actual `custom-template.json` object and submit it to `validate_template`. Retain the revision.
3. Call `render_preview` with that object, `section: "product"`, `frames: [0, 12, 36, 150, 299]` and the revision. Inspect the exported PNGs for readable copy and complete framing. An inclusive range `{ "from": 0, "to": 59 }` shows the entrance motion.
4. Call `patch_template` with the same object, revision and `edits: [{ "section": "product", "props": { "headline": "Your next idea, in motion", "accent": "mint" } }]`. Save the returned template and revision, then preview again.
5. Submit the revised object to `compose_video`. The effect alone produces an opaque H.264 video at 1280×720, 30 fps, 300 frames / ten seconds. Repeat unchanged previews/compositions to inspect cache hits; prop, composition mapping or contract changes invalidate reuse.

This example needs compatible local Chrome or Remotion browser setup and the existing optional Remotion peers. Catalog registration uses the supported strict JSON Schema subset and resource bounds documented in the [MCP guide](../../packages/leclap-mcp/README.md#operator-custom-effect-catalogs); arbitrary schemas, inline source and custom output formats are rejected. Visual text fit remains a preview inspection step.

## Editorial typography

[editorial-template.json](./editorial-template.json) selects the asset-free `studio.editorial-type@1.0.0` effect. The same operator catalog and generic `remotion/index.ts` entry register `LeclapEditorialType`; use the startup command above and restart after catalog edits. No fixture generation is required for this example.

The effect renders an opaque 1280×720, 30 fps, 300-frame scene. It uses local system Arial typography; exact glyph appearance depends on the render host and browser. This registration does not provide transparent output or automatic square/portrait adaptation.

| Property                 | Bounds / default                                                                                    | Purpose                                                                                                          |
| ------------------------ | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `headline`               | 1..80 characters; `Make your next story`                                                            | Dominant copy, with wrapping and long-token breaks inside a safe text area                                       |
| `kicker`                 | 0..32 characters; `CREATIVE DIRECTION`                                                              | Small context label; an empty string removes it                                                                  |
| `mode`                   | `masked-rise` (default), `word-stagger`, `highlight`, `blur-rise`, `split-slide`, `elastic-stagger` | Clipped rise, scaled stagger, accent sweep, blur-to-clear rise, opposing masked word slides or a small overshoot |
| `accent`                 | `lavender`, `mint`, `orange` (default)                                                              | Frame accent and highlighted band                                                                                |
| `entranceDurationFrames` | Integer 8..40; 18                                                                                   | Duration of each eased entrance; in highlight mode, also the band sweep duration                                 |
| `staggerFrames`          | Integer 0..8; 3                                                                                     | Per-item delay in word-stagger, blur-rise, split-slide and elastic-stagger modes                                 |
| `travelPx`               | Number 0..100; 56                                                                                   | Travel distance (horizontal for split-slide); ignored by highlight mode                                          |
| `highlightWord`          | Integer 0..15; 0                                                                                    | Zero-based animation item to highlight; indexes beyond the copy select its last item                             |

Before capture, an invisible unanimated copy block measures the actual word containers and spacing. A bounded 32..104px font-size search fits that static layout to the safe area; the selected size remains fixed across the animated frames. Copy is normalized into words with ordinary wrapping; additional words after item 15 are grouped into the final item without dropping text. The slowest word-stagger settings finish by frame 160, leaving over four seconds of settled hold before the final twelve-frame fade. Highlight mode first reveals the text, then sweeps the band without changing text positions. Frame 299 contains only the opaque background after the fade.

1. Discover with `get_effect_schema({ list: true })`, then request `{ id: "studio.editorial-type", version: "1.0.0" }`.
2. Submit the actual JSON object from `editorial-template.json` to `validate_template` and retain its revision.
3. Preview `section: "editorial"` at frames `[0, 4, 9, 18, 36, 160, 240, 287, 293, 299]` with the returned revision. An inclusive `frameRange: { from: 0, to: 59 }` shows the default entrance and highlight sweep.
4. Patch the selected mode through `edits: [{ section: "editorial", props: { mode: "word-stagger", staggerFrames: 5, accent: "mint" } }]`. For emphasis, choose `mode: "highlight"` and an explicit `highlightWord`. Save the returned JSON/revision and preview again.
5. Submit the revised object to `compose_video`. Repeat unchanged requests to reuse the existing registered-effect cache.

Before export, review all six modes with maximum-length copy, an unbroken wide-glyph token and more than sixteen short words. Check frames around the last word's settling time when duration/stagger are at their maximum; the default short preview does not cover that full entrance. Whitespace-only headlines fail render preparation with a clear error. The supported catalog string subset checks length but cannot reject whitespace during validation. The pure timing, bounded fitting and real catalog contracts are tested in `packages/leclap-mcp/tests/editorial-type.test.ts`; visual fit and pacing still require actual render inspection.

Ready-to-use variants: [blur rise](./editorial-blur-rise.json), [opposing slides](./editorial-split-slide.json) and [elastic stagger](./editorial-elastic-stagger.json). Each uses the same registered contract and explicit JSON timing. Blur falls from 8px to zero; elastic travel overshoots by about 10% of its distance and scale by less than 1%. Opacity remains bounded. Use native `ease-out-back` for portable line motion; choose the Remotion modes when per-word blur, scale or opposing choreography warrants a Node worker.
