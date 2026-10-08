// The browser rasteriser of HTML layers: the shared Satori + resvg pipeline (core/html/satori-raster) with its
// WebAssembly the host's loader brings (BrowserCompileOptions.loadHtmlWasm); it fetches none itself. Loaded by the
// compile chunk and by renderHtmlLayerPreview, never by the entry a page imports: Satori, resvg and
// HarfBuzz come in on the first HTML layer.

import { container } from 'tsyringe';
import { HTML_RASTERISER, type HtmlRasteriser } from '@/core/html/html-rasteriser';
import type { HtmlWasmLoader } from '@/core/html/html-engine';
import { createSatoriRasteriser } from '@/core/html/satori-raster';
import { withHarfbuzzShaper } from './harfbuzz-shaper';
import {
  previewHtmlLayer,
  type HtmlLayerPreview,
  type HtmlLayerPreviewRequest,
} from '../../services/html-raster/html-layer-preview';

// The engine fetches no WebAssembly itself: without the host's loader there is nothing to draw with.
function requireLoader(loadWasm: HtmlWasmLoader | undefined): HtmlWasmLoader {
  if (loadWasm) return loadWasm;

  throw new Error(
    'html rasteriser unavailable: pass BrowserCompileOptions.loadHtmlWasm, a loader for the WebAssembly ' +
      '(resvg.wasm, hb-subset.wasm, hb.wasm) your host serves'
  );
}

export function createBrowserHtmlRasteriser(loadWasm: HtmlWasmLoader): HtmlRasteriser {
  return createSatoriRasteriser(withHarfbuzzShaper(loadWasm));
}

// One per page: the preview and the compile share the instanced faces (the WebAssembly is shared anyway).
let pageRasteriser: HtmlRasteriser | undefined;

function sharedRasteriser(loadWasm: HtmlWasmLoader): HtmlRasteriser {
  pageRasteriser ??= createBrowserHtmlRasteriser(loadWasm);

  return pageRasteriser;
}

/** Registers the rasteriser the asset stage draws HTML layers with (the browser compile). */
export function registerBrowserHtmlRasteriser(loadWasm: HtmlWasmLoader): void {
  if (container.isRegistered(HTML_RASTERISER)) return;

  container.registerInstance<HtmlRasteriser>(HTML_RASTERISER, sharedRasteriser(loadWasm));
}

/** Draws one layer as the render would, with what it would report. */
export async function previewHtmlLayerInBrowser(
  request: HtmlLayerPreviewRequest,
  loadWasm: HtmlWasmLoader | undefined
): Promise<HtmlLayerPreview> {
  return previewHtmlLayer(request, sharedRasteriser(requireLoader(loadWasm)));
}
