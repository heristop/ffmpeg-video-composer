// The WebAssembly the HTML layer rasteriser runs on (resvg, HarfBuzz's subsetter and shaper), for the builder's live
// preview and the browser render alike. Served from this origin (scripts/stage-html-engine.ts stages it into
// public/ on dev and build) under a versioned path, so the HTTP cache and the service worker keep it.
import { HTML_WASM_VERSION, type HtmlWasm } from 'ffmpeg-video-composer/src/core/html/html-engine.ts';

const ENGINE_PATH = `/html-engine/${HTML_WASM_VERSION}`;

async function fetchWasm(file: string): Promise<ArrayBuffer> {
  const url = `${ENGINE_PATH}/${file}`;
  const response = await fetch(url);

  if (!response.ok) throw new Error(`html engine unavailable: ${url} answered ${response.status}`);

  return response.arrayBuffer();
}

export async function loadSelfHostedHtmlWasm(): Promise<HtmlWasm> {
  const [resvg, harfbuzz, shaper] = await Promise.all([
    fetchWasm('resvg.wasm'),
    fetchWasm('hb-subset.wasm'),
    fetchWasm('hb.wasm'),
  ]);

  return { resvg, harfbuzz, shaper };
}
