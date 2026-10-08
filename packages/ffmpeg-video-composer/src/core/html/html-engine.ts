// The engines HTML layers are drawn with, pinned once for every host: Satori lays out (its Yoga build is
// inlined in its JS) and shapes text with HarfBuzz, resvg rasterises and HarfBuzz's subsetter instances
// variable fonts. Their WebAssembly files are loaded the host's way (Node reads them from node_modules, a
// browser host serves them itself through BrowserCompileOptions.loadHtmlWasm, the phone's WebView page carries
// them inline): the engine never fetches them from a third party. Checked against the installed packages by
// the rasteriser tests.

const SATORI_VERSION = '0.33.5';
const RESVG_WASM_VERSION = '2.6.2';
const HARFBUZZJS_VERSION = '0.10.0';

/** The engines a layer is drawn with; part of every layer's cache key. */
export const HTML_RENDERER_VERSION = `satori@${SATORI_VERSION}+resvg@${RESVG_WASM_VERSION}+harfbuzz@${HARFBUZZJS_VERSION}`;

/** The WebAssembly files of the HTML rasteriser, as package-relative paths. */
export const HTML_WASM_FILES = {
  resvg: { package: '@resvg/resvg-wasm', version: RESVG_WASM_VERSION, file: 'index_bg.wasm' },
  harfbuzz: { package: 'harfbuzzjs', version: HARFBUZZJS_VERSION, file: 'hb-subset.wasm' },
  // Satori's text shaper: on Node harfbuzzjs reads it itself, a browser has to be handed it.
  shaper: { package: 'harfbuzzjs', version: HARFBUZZJS_VERSION, file: 'hb.wasm' },
} as const;

export type HtmlWasmName = keyof typeof HTML_WASM_FILES;

/** Names the pair of WebAssembly builds: the directory a host serves them under changes with either. */
export const HTML_WASM_VERSION = `resvg-${RESVG_WASM_VERSION}_harfbuzz-${HARFBUZZJS_VERSION}`;

/** The bytes of the WebAssembly modules; `shaper` is required in a browser, Node's harfbuzzjs reads its own. */
export type HtmlWasm = Record<'resvg' | 'harfbuzz', BufferSource> & { shaper?: BufferSource };

/** Loads the rasteriser's WebAssembly: where it comes from is the host's call. */
export type HtmlWasmLoader = () => Promise<HtmlWasm>;
