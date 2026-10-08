import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { container } from 'tsyringe';
import { prepareHtmlLayer, HTML_LAYER_DENSITY } from '@/core/html/html-layer';
import { sha256Hex } from '@/core/determinism/sha256';
import { HTML_RASTERISER, type HtmlRasteriser, type RasterFont } from '@/core/html/html-rasteriser';
import * as htmlEngine from '@/core/html/html-engine';
import { HTML_RENDERER_VERSION, HTML_WASM_FILES, type HtmlWasm } from '@/core/html/html-engine';
import {
  createBrowserHtmlRasteriser,
  previewHtmlLayerInBrowser,
  registerBrowserHtmlRasteriser,
} from '@/platform/html/html-rasteriser-browser';

// The browser path runs here on Node's WebAssembly, handed over by a host loader that reads the installed WASM
// files: the same Satori, resvg and HarfBuzz builds, so the bytes must match the Node golden
// (tests/html-rasterise-node.test.ts). A real page renders it too (the web app's live preview). The engine
// itself never fetches the WebAssembly: `fetch` is stubbed to catch any request that is not a data: URL.

const here = path.dirname(fileURLToPath(import.meta.url));
const modules = path.resolve(here, '../node_modules');
const fontsDir = path.resolve(here, '../../leclap-creative-kit/src/library/fonts');

const NODE_GOLDEN = '891095981c5265f83ded663654059ba85d26d5f39afe3d2ec393e85164b02885';

const CARD = {
  html: `<div class="card"><span class="tag">For sale</span><p>12 rue des Lilas</p><p class="city">Lyon <strong>3e</strong></p></div>`,
  css:
    '.card { display: flex; flex-direction: column; gap: 12px; padding: 28px; border-radius: 24px; background: #1E1E24 } ' +
    '.tag { color: #FF8AAE; font: 600 28px Rubik } p { margin: 0; font: 56px "Bebas Neue"; color: #F5F3F7 } ' +
    '.city { font: 400 32px Rubik; color: #9A98A6 }',
  width: 360,
  height: 240,
};

function fontsFor(faces: { family: string; file: string; weights: number[] }[]): RasterFont[] {
  return faces.map((face) => ({ ...face, data: new Uint8Array(fs.readFileSync(path.join(fontsDir, face.file))) }));
}

const realFetch = globalThis.fetch;

// Satori reads its inlined Yoga build through fetch (a data: URL): that one goes through, anything else is
// recorded and refused.
function guardedFetch(requested: string[]) {
  return vi.fn(async (url: string) => {
    if (url.startsWith('data:')) return realFetch(url);

    requested.push(url);

    return new Response(null, { status: 404 });
  });
}

function readInstalled({ package: name, file }: { package: string; file: string }): Uint8Array<ArrayBuffer> {
  return new Uint8Array(fs.readFileSync(path.join(modules, name, file)));
}

// What a host such as the web app does: hand over the WebAssembly it serves itself.
async function hostLoader(): Promise<HtmlWasm> {
  return {
    resvg: readInstalled(HTML_WASM_FILES.resvg),
    harfbuzz: readInstalled(HTML_WASM_FILES.harfbuzz),
    shaper: readInstalled(HTML_WASM_FILES.shaper),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  container.reset();
});

describe('browser HTML rasteriser', () => {
  it('names the WebAssembly files with the versions the renderer names, and no third-party URL', () => {
    expect(HTML_WASM_FILES.resvg).toMatchObject({ package: '@resvg/resvg-wasm', version: '2.6.2' });
    expect(HTML_WASM_FILES.shaper).toMatchObject({ package: 'harfbuzzjs', version: '0.10.0', file: 'hb.wasm' });
    expect(HTML_RENDERER_VERSION).toContain('resvg@2.6.2');
    expect(HTML_RENDERER_VERSION).toContain('harfbuzz@0.10.0');
    expect(JSON.stringify(htmlEngine)).not.toMatch(/https?:\/\//);
  });

  it('draws the same bytes as Node (golden) from the WASM the host hands over, fetching nothing', async () => {
    const requested: string[] = [];
    vi.stubGlobal('fetch', guardedFetch(requested));
    const layer = prepareHtmlLayer(CARD, 'Rubik');
    const rasteriser = createBrowserHtmlRasteriser(hostLoader);

    const raster = await rasteriser.render({
      element: layer.element,
      width: CARD.width,
      height: CARD.height,
      density: HTML_LAYER_DENSITY,
      fonts: fontsFor(layer.faces),
    });

    expect(rasteriser.version).toBe(HTML_RENDERER_VERSION);
    expect(sha256Hex(raster.png)).toBe(NODE_GOLDEN);
    expect(requested).toEqual([]);
    // Satori's text shaper (harfbuzzjs, aliased to the shim in browser bundles) got its WebAssembly too.
    const shaper = await (await import('@/platform/html/harfbuzz-shaper')).default;

    expect(typeof shaper.createBlob).toBe('function');
  }, 30_000);

  it('refuses to preview without a host loader, naming loadHtmlWasm, and fetches nothing', async () => {
    const requested: string[] = [];
    vi.stubGlobal('fetch', guardedFetch(requested));
    const request = { html: CARD.html, css: CARD.css, width: CARD.width, height: CARD.height, loadFont: vi.fn() };

    await expect(previewHtmlLayerInBrowser(request, undefined)).rejects.toThrow(/loadHtmlWasm/);
    expect(requested).toEqual([]);
  });

  it('registers once for the compile, with the host loader', () => {
    const loader = vi.fn();

    registerBrowserHtmlRasteriser(loader);
    const first = container.resolve<HtmlRasteriser>(HTML_RASTERISER);
    registerBrowserHtmlRasteriser(loader);

    expect(container.resolve<HtmlRasteriser>(HTML_RASTERISER)).toBe(first);
    expect(first.version).toBe(HTML_RENDERER_VERSION);
    // Nothing loads until a layer is drawn.
    expect(loader).not.toHaveBeenCalled();
  });
});
