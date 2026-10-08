// The Node rasteriser of HTML layers, in process: the shared Satori + resvg pipeline
// (core/html/satori-raster) with its WebAssembly read from the installed packages.

import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { container } from 'tsyringe';
import { HTML_RASTERISER, type HtmlRasteriser, type HtmlRasterRequest } from '@/core/html/html-rasteriser';
import { HTML_WASM_FILES, type HtmlWasm } from '@/core/html/html-engine';
import { createSatoriRasteriser, measureHtmlLayout } from '@/core/html/satori-raster';

export { HTML_RENDERER_VERSION } from '@/core/html/html-engine';

const requireModule = createRequire(import.meta.url);

function readPackageFile({ package: name, file }: { package: string; file: string }): Promise<Uint8Array<ArrayBuffer>> {
  return fs.readFile(requireModule.resolve(`${name}/${file}`));
}

async function readWasm(): Promise<HtmlWasm> {
  const [resvg, harfbuzz] = await Promise.all([
    readPackageFile(HTML_WASM_FILES.resvg),
    readPackageFile(HTML_WASM_FILES.harfbuzz),
  ]);

  return { resvg, harfbuzz };
}

/** The content's natural height in output pixels at the box width: a layout pass, nothing drawn. */
export function measureHtmlContent(request: Omit<HtmlRasterRequest, 'density'>): Promise<number> {
  return measureHtmlLayout(request, readWasm);
}

/** A rasteriser with its own cache of instanced faces; the WebAssembly engines are shared. */
export function createNodeHtmlRasteriser(): HtmlRasteriser {
  return createSatoriRasteriser(readWasm);
}

/** Registers the in-process rasteriser the asset stage draws HTML layers with (the Node compile). */
export function registerHtmlRasteriser(): void {
  if (container.isRegistered(HTML_RASTERISER)) return;

  container.registerInstance<HtmlRasteriser>(HTML_RASTERISER, createNodeHtmlRasteriser());
}
