// Stands in for `harfbuzzjs` in every bundled page: the engine's browser build, the web app (vite alias) and
// the phone's WebView page (html-raster-webview.ts) resolve Satori's `import … from "harfbuzzjs"` here. The
// package's own entry starts HarfBuzz the moment it is imported and fetches `hb.wasm` next to the page, which
// no page serves; this one waits for the bytes the host's loader brought (withHarfbuzzShaper) and starts the
// same build from them. Node keeps the real package, which reads its hb.wasm from node_modules.
//
// The bytes wait in a page-wide slot rather than in this module: a dev server that pre-bundles Satori
// inlines its own copy of this file, and that copy must see the bytes the rasteriser hands over too.
import createHarfBuzz from 'harfbuzzjs/hb.js';
import hbjs from 'harfbuzzjs/hbjs.js';
import type { HtmlWasmLoader } from '../../core/html/html-engine';

type Slot = PromiseWithResolvers<BufferSource>;

const SLOT = Symbol.for('ffmpeg-video-composer.harfbuzz-shaper');
const scope = globalThis as typeof globalThis & { [SLOT]?: Slot };
const slot = (scope[SLOT] ??= Promise.withResolvers<BufferSource>());

/** Hands HarfBuzz's shaping build to Satori; only the first call counts. */
export function provideHarfbuzzShaper(wasm: BufferSource): void {
  slot.resolve(wasm);
}

/** A loader that also hands its `shaper` bytes to Satori: a page cannot locate hb.wasm on its own. */
export function withHarfbuzzShaper(loadWasm: HtmlWasmLoader): HtmlWasmLoader {
  return async () => {
    const wasm = await loadWasm();

    if (!wasm.shaper) throw new Error('html rasteriser unavailable: the loader brought no HarfBuzz shaper (hb.wasm)');

    provideHarfbuzzShaper(wasm.shaper);

    return wasm;
  };
}

/** What `harfbuzzjs` resolves to: the hbjs API over a started HarfBuzz. */
const shaper: Promise<ReturnType<typeof hbjs>> = slot.promise.then(async (binary) =>
  hbjs(await createHarfBuzz({ wasmBinary: binary }))
);

export default shaper;
