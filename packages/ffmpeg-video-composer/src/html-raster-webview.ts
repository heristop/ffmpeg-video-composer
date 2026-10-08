// The page the phone draws HTML layers in: a hidden react-native-webview (Hermes has no WebAssembly) runs
// the shared Satori + resvg + HarfBuzz pipeline (core/html/satori-raster) over the WebAssembly inlined in
// this page (dist/html-rasteriser.html, assembled by tsdown.config.ts); like any page, Satori's harfbuzzjs
// import resolves to the shared shim (platform/html/harfbuzz-shaper). Messages are raster-messages.ts JSON:
// requests arrive through the WebView's postMessage, replies leave through window.ReactNativeWebView.

import { HTML_RENDERER_VERSION, type HtmlWasm } from './core/html/html-engine';
import { createRasterPage } from './core/html/raster-page';
import { createSatoriRasteriser, preloadHtmlEngines } from './core/html/satori-raster';
import type { RasterPageReply } from './core/html/raster-messages';
import { withHarfbuzzShaper } from './platform/html/harfbuzz-shaper';
import { pageWasm } from './html-raster-webview/page-wasm';

interface PageGlobals {
  ReactNativeWebView?: { postMessage(text: string): void };
}

const page = globalThis as unknown as PageGlobals & Window;

function post(text: string): void {
  if (page.ReactNativeWebView) {
    page.ReactNativeWebView.postMessage(text);

    return;
  }

  // Outside the app (a desktop browser checking the bundle): answer the opener or the parent frame.
  (page.opener ?? page.parent).postMessage(text, '*');
}

// The page's whole WASM glue: the inlined bytes, decoded once.
const loadWasm = withHarfbuzzShaper(async (): Promise<HtmlWasm> => ({
  resvg: pageWasm('resvg'),
  harfbuzz: pageWasm('subset'),
  shaper: pageWasm('shape'),
}));
const handle = createRasterPage(createSatoriRasteriser(loadWasm), post, () => performance.now());

function onMessage(event: Event): void {
  const { data } = event as MessageEvent<unknown>;

  if (typeof data !== 'string') return;

  handle(data).catch(() => null);
}

// iOS delivers the WebView's postMessage on window, Android on document.
page.addEventListener('message', onMessage);
document.addEventListener('message', onMessage);

preloadHtmlEngines(loadWasm).then(
  () => {
    post(JSON.stringify({ type: 'ready', version: HTML_RENDERER_VERSION } satisfies RasterPageReply));
  },
  (error: unknown) => {
    post(JSON.stringify({ type: 'failed', message: String(error) } satisfies RasterPageReply));
  }
);
