# HTML layers: style a moment with HTML and CSS

> Status: phases 1 (Node), 2 (browser) and 3 (phone) done and integrated on `feat/html-layers`; see the final status · Scope: `ffmpeg-video-composer` (schema, rasteriser, asset stage), `leclap-web` (builder),
> `leclap-expo` (on-device rasteriser), `leclap-mcp` (catalog, preview)

## Why

Text in LeClap today is drawn by FFmpeg's `drawtext` (kinetic type, title cards, lower thirds, captions). It is
fast and portable, but it can't do layout: no wrapping into boxes with padding, no mixed weights or colours in a
line, no badges, price tags, address cards, tables, chips or icons next to text.

HTML plus CSS is a layout language an agent (or a designer) already knows how to write. Filled from template
fields and animated by the motion system we already have, it covers those layouts without a new vocabulary.

## Principles

1. **Deterministic, like every other layer.** Same template, same fields, same bytes on Node, the browser and the
   phone. That rules out screenshotting a real browser engine (Chromium, WebKit and Blink render text and
   anti-aliasing differently per platform and version).
2. **A still layer, animated by the engine.** HTML renders once to a transparent PNG; entrances, exits, kinetic
   motion, camera and fx come from the existing vocabulary. No CSS animations or JavaScript.
3. **A documented subset, not "any HTML".** Flexbox layout, text and font styling, colours and gradients,
   borders and radius, shadows, padding and margins, images from the library or the template's own inputs. What's
   unsupported is reported, not silently dropped.
4. **Safe input.** No scripts, no event handlers, no iframes or forms, no network: fonts come from the font
   registry, images from the template's assets.

## The template shape

An HTML layer is a new overlay input type, next to `image` and `animation` (same placement and motion options):

```jsonc
"inputs": [
  {
    "name": "address_card",
    "type": "html",
    "html": "<div class='card'><span class='tag'>For sale</span><p>{{ form_1_address }}</p></div>",
    "css": ".card { display: flex; flex-direction: column; gap: 12px; padding: 28px; border-radius: 24px; background: $color.surface } .tag { color: $color.accent; font: 600 28px $font.body } p { font: 700 56px $font.display; color: $color.fg }",
    "width": 720,
    "height": 320,
    "options": { "position": "64:560", "motion": { "type": "rise", "delay": 0.4 } }
  }
]
```

- `{{ var }}` fields and theme tokens (`$color.*`, `$font.*`) resolve before rendering, exactly as in other
  string fields; field values are HTML-escaped.
- `width`/`height` are the layer's box in output pixels (bounded, e.g. ≤ 1920×1920); the PNG is rendered at 2×
  for the 1080p presets and scaled into place.
- Reused across sections like any input; a section's maps can reference it with `@address_card`.

## How it renders

1. **Resolve** fields and tokens, sanitise the HTML (allowlist of tags and attributes), and validate the CSS
   against the supported subset (advisory `html_unsupported_css` names each dropped property).
2. **Layout + vector:** [Satori](https://github.com/vercel/satori) turns the HTML/CSS subset into SVG (Yoga flexbox
   layout, text shaped with the bundled fonts via the font registry).
3. **Raster:** [resvg](https://github.com/RazrFalcon/resvg) (`@resvg/resvg-wasm`) renders the SVG to a
   transparent PNG. Both are WebAssembly, so the bytes are identical wherever they run.
4. **Asset stage:** exposed as an `html:<hash>` URL, rendered and written to the build filesystem the way `sprite:`
   and `panel:` are (`AssetManager.fetchMedia`), cached by content hash, then composited by the existing overlay
   path (`inputs[]` → overlay with position/scale/motion).

Per platform:

| Platform                           | Where Satori + resvg run                                                                                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node (CLI, MCP, server)            | In process (WASM).                                                                                                                                                  |
| Browser (web builder, WASM render) | In the page, the same WASM bundle; also powers the builder's live preview.                                                                                          |
| Phone (Expo, Hermes)               | Hermes has no WebAssembly, so a hidden `react-native-webview` runs the same bundle and returns the PNG as bytes. The WebView is created once per render and reused. |

## Builder and agents

- **Web builder:** an HTML layer in the overlay picker with two code fields (HTML, CSS), a field chip list that
  inserts `{{ var }}`, a live preview rendered by the same rasteriser, and the existing drag-to-place and resize.
- **MCP:** documented in `get_template_schema`; `motionCatalog()` gains an `html` entry (supported subset, layout
  recipes: card, badge, price tag, two-column stat); `render_frames` already previews it in context. A compact
  description keeps the web AI prompt within its size budget.
- **Validation:** `html_unsupported_css`, `html_overflow` (content taller than the box, measured from the layout),
  `html_missing_field`, `html_font_unknown`, `html_too_large` (box over the bound).

## Phases

1. **Engine (Node):** schema, sanitiser, Satori + resvg rasteriser behind an `html:` asset, overlay compositing,
   fields and tokens, advisories. Tests: golden PNG checksums, sanitiser cases, subset validation, a real render.
2. **Browser:** load the WASM in the web app and in the browser engine entry; builder preview and editing UI.
3. **Phone:** the WebView rasteriser in Expo, wired into the RN filesystem adapter; on-device render of a template
   with an HTML layer on the Android emulator and the iOS simulator; measure time per layer.
4. **Docs and samples:** template-configuration section, gallery sheet, one sample template (a real-estate card), MCP README.

## Phase 1: what shipped, and where it differs

Done on `feat/html-layers`: the schema, the sanitiser and CSS subset, Satori + resvg on Node behind `html:<hash>`
assets, fields and tokens, the advisories, `motionCatalog().html` with the four recipes, the MCP guide, the docs
section, a gallery sheet (`html-layers`) and the `html-card` sample in the showcase.

Differences from the plan above:

- **HarfBuzz added.** Satori rejects variable fonts (`fvar`), and Rubik, Oswald, Playfair Display and Roboto Mono
  ship as variable fonts. `harfbuzzjs` (MIT) pins each to the static weights a layer uses with hb-subset, which
  is deterministic. The three WASM packages load on the first HTML layer only and stay out of the browser bundle.
- **Inline flow is rebuilt.** Satori can't lay out text mixed with inline elements, so a paragraph is rebuilt on
  flexbox word by word. Line breaks can differ from a browser's.
- **New advisory `html_unsupported_markup`** for removed tags and attributes, apart from `html_unsupported_css`.
  `html_overflow` is measured by a Satori layout pass in the Node geometry checks (CLI and MCP validate).
- **`html_unavailable`** is a hard error where the validator is built with `htmlLayers: false`: the browser and
  on-device `Template` model, until phases 2–3 register a rasteriser there.
- **The web one-shot AI prompt leaves HTML layers out** (schema fields and the `html` catalog entry), because the
  web would refuse what it generated until phase 2.
- **No capability-matrix entry.** The layer composites through the existing still-image overlay, so it adds no
  FFmpeg filter. The MCP media guard is unchanged: images must be relative or `/assets/` paths (or PNG/JPEG data
  URIs), so they stay inside the media dir.
- **Motion:** `rise` and `slide-*` only move a layer; to keep it hidden until it moves in, set `start` to the
  motion `delay` (the sample does).

Measured: about 250 ms per 360×240 layer at 2× on Node, including the WASM and font load on the first layer;
repeated layers come from the per-process cache. The browser eager bundle went from 614.51 KB to 620.88 KB
(budget 625 KB) for the schema and validation code.

## Phase 2: what shipped, and where it differs

Done on `feat/html-layers-web` (on top of phase 1): the browser engine draws HTML layers, the web builder
edits them with a live preview, and the one-shot prompt describes them again.

- **One pipeline, two loaders.** `services/html-raster/satori-rasteriser.ts` is the Satori + resvg +
  HarfBuzz pipeline both hosts share; only where the WebAssembly comes from differs (`HtmlWasmLoader`):
  Node reads `node_modules`, the browser fetches it (`platform/html/html-rasteriser-browser.ts`), from the
  host's `BrowserCompileOptions.loadHtmlWasm` (the pinned files on unpkg when omitted, dropped at integration:
  see the final status). `browser-compile` registers it and
  builds `new Template({ htmlLayers: true })`; on-device validation keeps `html_unavailable`.
- **Same bytes as Node, checked in a real browser.** The phase 1 golden card (360×240 at 2×) hashes to the
  same `891095…2885` in headless Chromium through the web app's served WebAssembly as on Node; the vitest
  browser-path test checks it too, on Node's WebAssembly with `fetch` stubbed. The `html-card` sample
  renders through the web app's compile path (ffmpeg.wasm) with both layers in place (about 70 s under
  load, `ultrafast`).
- **A third WebAssembly file.** Satori 0.33 shapes text with `harfbuzzjs` (its `hb.wasm`, 373 KiB), whose
  entry fetches `hb.wasm` next to the page as soon as it is imported. Browser bundles alias that import to
  `platform/html/harfbuzz-shaper.ts`, which starts the same build from bytes the loader hands over (kept in a
  page-wide slot, so a dev server's pre-bundled copy of Satori sees them too). The engine's browser build
  bundles Satori into its lazy chunks for that; the web app aliases it in `vite.config.ts`.
- **Lazy, and inside the budget.** The browser eager load went from 620.88 KB to 623.36 KB (the preview
  entry point and rolldown's CommonJS interop helpers for the bundled Satori). Lazy: the rasteriser chunk
  (42.5 KB), Satori and its dependencies (779 KB), the shaper shim (0.5 KB). WebAssembly: `resvg.wasm`
  2.36 MiB, `hb-subset.wasm` 582 KiB, `hb.wasm` 373 KiB, each far under Cloudflare Pages' 25 MiB, served
  as is by the web app under `/html-engine/<resvg-x_harfbuzz-y>/` (`scripts/stage-html-engine.ts`).
- **Preview.** `renderHtmlLayerPreview(request, { loadHtmlWasm })` draws one layer as the render would and
  returns every advisory its render logs (`html_unsupported_css`, `html_unsupported_markup`,
  `html_font_unknown`, `html_missing_field`, `html_overflow`), from the same code the asset stage uses
  (`html-layer-findings.ts`). In the page: about 1.4 s for the first layer (WebAssembly and fonts
  included), under 100 ms for the next.
- **Builder.** An "HTML layer" entry in the element menu (video, colour and image scenes), an inspector with
  the layer name (`@name` for maps), HTML and CSS code fields, `{{ field }}` chips (typed fields, variables,
  form fields; inserted at the caret), the box, the live preview (debounced 250 ms, cached by content) and
  the advisories. On the canvas the layer is the drawn still in the same draggable, rotatable box as images;
  the resize grip changes the layer's box, so the content lays out again rather than stretching. The model
  (`@leclap/creative-kit/editor`) round-trips `type: "html"` inputs with their name, so WebMCP's
  descriptor tools and the AI generator keep them whole.
- **Prompt.** The one-shot prompt schema keeps the html input again; the catalog entry travels compactly
  (shape and subset rules, no tag/property lists or recipes) so the prompt stays within its budget with the
  schema whole.
- **Not done here.** The service worker caches `/html-engine/` stale-while-revalidate like other assets,
  not cache-first like the ffmpeg core. Code fields are plain textareas (no syntax highlighting: the
  CodeMirror HTML/CSS languages are not installed). The browser render of `html-card` comes out 1280×810
  where Node renders 1280×720; it does the same without the HTML layers, so it is the browser path's
  `image_background` + camera, not this phase.

## Phase 3: what shipped, and where it differs

Done on `feat/html-layers-expo`. The pipeline moved into `core/html/satori-raster.ts`, shared by Node and
the phone. `dist/html-rasteriser.html` is the phone's page, built by the engine's tsdown with the WebAssembly
inlined. `raster-messages.ts` and `raster-page.ts` define the JSON protocol. The RN entry gains
`registerHtmlRasteriser`, and `Template` lifts `html_unavailable` once a rasteriser is registered. In the app,
`htmlRasterHost` and `<HtmlRasterView />` handle the page, and `leclap://ffmpeg-spike?check=html` checks it
on the device.

- **Same bytes, verified:** the html-card layers match Node's PNGs on the iOS simulator and the Android
  emulator. The page also gives the golden bytes in desktop Chromium 151, in WebKit 26.5, and in a bare V8
  context (`tests/html-raster-webview-page.test.ts`).
- **Satori needs HarfBuzz's shaper too:** satori 0.33 imports `harfbuzzjs`, which fetches `hb.wasm` from
  beside its script. The page build aliases it to a shim that hands over inlined bytes, so the page carries
  three modules (resvg, hb-subset, hb).
- **No native rebuild:** `react-native-webview` 13.16.1 was already a dependency and linked in both native
  builds. The page ships as an asset (`html` added to Metro's `assetExts`).
- **Android gotchas:** an off-screen page barely ran, so the WebView is one on-screen pixel at 0.01 opacity.
  A 5 MB `source.html` took 20–60 s to load, so the page opens from its local file.
- **Engine fix on the way:** two HTML layers of a section staged the same font concurrently, and one could
  read it half-copied ("could not instance the variable font"). Concurrent requests for a font now share one
  staging.
- **Budget:** a layer without a large shadow takes 14 ms on the iOS simulator and 73–83 ms on the Pixel 3a
  emulator. The html-card's card layer, with a 40 px `box-shadow`, takes 1.7 s (iOS sim), 7–25 s (Android
  emulator, host under load), and 2–3 s on Node. resvg's blur is the cost, on every platform.
- **Not done:** HTML editing in the phone builder. The shared editor model (`@leclap/creative-kit/editor`)
  doesn't carry html inputs, which is phase 2's work. Templates with HTML layers render from the catalog and
  the check. The app stages `image_background` photos from `/assets/backgrounds/…` only, so the CLI-style
  relative `backgrounds/…` path in the sample is rewritten by the check.

## Final status: the phases integrated

Phases 2 and 3 were built in parallel on top of phase 1 and merged back into `feat/html-layers` (`merge: html
layers in the browser`, `merge: html layers on the phone`). Where they overlapped:

- **One pipeline.** Both phases had moved the Satori + resvg + HarfBuzz pipeline out of the Node rasteriser,
  to two different places. It now lives once in `core/html/satori-raster.ts` (platform-neutral, no Node
  imports), with phase 2's shape: it takes an `HtmlWasmLoader`, imports Satori and resvg on the first layer
  and shares the instantiated engines. Per-host glue is only where the WebAssembly comes from:
  `services/html-node` reads `node_modules`, `platform/html/html-rasteriser-browser.ts` takes the host's
  `loadHtmlWasm`, and the WebView page (`html-raster-webview.ts`) decodes the bytes inlined in it.
  `font-instances.ts` sits next to it in `core/html/`.
- **One HarfBuzz shim.** `platform/html/harfbuzz-shaper.ts` (phase 2's, the bytes kept in a page-wide slot)
  stands in for `harfbuzzjs` in the engine's browser build, the web app (vite alias) and now the WebView page
  build, all through the tsdown `pre` resolve plugin; `withHarfbuzzShaper` hands it the loader's `hb.wasm`. Phase
  3's page-only shim is gone. Node keeps the real package. The page still gives the golden bytes in V8.
- **One availability rule.** `Template` (the browser and on-device validation path) reports
  `html_unavailable` only when no rasteriser is registered. Phase 2's `new Template({ htmlLayers: true })`
  is gone: the browser compile registers its rasteriser, the phone app calls `registerHtmlRasteriser`.
  Validators that only check templates (MCP, the CLI, the web AI generator and template import) keep
  `htmlLayers` at its default and accept HTML layers. The message names what each host does to lift it.
- **No CDN.** Phase 2's fallback to the pinned files on unpkg is removed: the browser rasteriser draws only
  with WebAssembly the host hands over (`BrowserCompileOptions.loadHtmlWasm`, which the web app passes for
  the compile and the live preview). Without it no rasteriser is registered, validation reports
  `html_unavailable`, and `renderHtmlLayerPreview` rejects naming the option. `HTML_WASM_CDN` is removed;
  `HTML_WASM_FILES` still names the files and versions.
- **Editor model.** Phase 2's round trip of `type: "html"` inputs in `@leclap/creative-kit/editor` also fixes
  phase 3's deferred item: the phone editor's JSON import keeps HTML layers (an Expo test imports the
  `html-card` sample through the schema and `toEditorState`). The phone builder still has no UI to edit them.
- **Builds and staging.** `tsdown.config.ts` keeps both builds: the browser build bundles Satori behind the
  shim, the `html-raster-page` build writes `dist/html-rasteriser.html`; the React Native build keeps `tslib`
  external and carries no Satori. The web app stages the three WebAssembly files under `/html-engine/<version>/`
  (`scripts/stage-html-engine.ts`); `scripts/copy-core-assets.ts` stages the page into the Expo assets.
- **Font staging.** Phase 3's fix (two HTML layers of a section staging the same font at once share one
  staging) is in `AssetManager`, which every host's compile uses, so the browser compile has it too.

Bundle after integration: browser eager load 623.58 KB (budget 625 KB), `browser.js` 35.45 KB; lazy chunks:
the browser rasteriser 40.0 KB, Satori and its dependencies 760.6 KB, the shim 0.8 KB; the WebView page
5.16 MB.

## Out of scope

- CSS animations, transitions and JavaScript (motion comes from the engine).
- Arbitrary web fonts or remote images (fonts via the registry, images via the template's assets).
- Full browser fidelity: the subset is what Satori supports, documented.

## Risks

- **Bundle size:** Satori + resvg WASM add roughly 2–3 MB; load them lazily, only when a template has an HTML layer.
- **Phone render time:** the WebView round trip adds latency; render each distinct layer once, cache by hash, and
  measure against a budget (e.g. 150 ms per layer on the Pixel 3a emulator).
- **CSS expectations:** people will try unsupported CSS. The advisory and the documented subset are the answer;
  the builder preview shows exactly what renders.
- **Licences:** Satori (MPL-2.0) and resvg (Apache-2.0/MIT) are compatible with the project; confirm against the
  LGPL on-device constraints (they don't touch FFmpeg).
