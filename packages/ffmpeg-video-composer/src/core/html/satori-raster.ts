// The HTML layer pipeline every host runs: Satori lays the element tree out (Yoga, flexbox) and writes
// text as vector paths, resvg draws that SVG to a transparent PNG at the requested density, HarfBuzz pins
// variable fonts to static weights. All three run as WebAssembly, loaded on the first layer only (dynamic
// imports), so a template without an HTML layer never pays for them. Only where the WebAssembly bytes come
// from is the host's call (HtmlWasmLoader): Node reads node_modules (services/html-node), the browser
// fetches what its host serves (platform/html), the phone's WebView page carries them inline
// (html-raster-webview.ts). Same request, same bytes, everywhere.

import type satoriFunction from 'satori';
import type * as ResvgWasm from '@resvg/resvg-wasm';
import type { HtmlRaster, HtmlRasteriser, HtmlRasterRequest, RasterFont } from './html-rasteriser';
import { HTML_RENDERER_VERSION, type HtmlWasmLoader } from './html-engine';
import type { LayerElement } from './html-element';
import { faceWeight, instanceFont, isVariableFont, type HbSubset } from './font-instances';

type Satori = typeof satoriFunction;
type SatoriFont = Parameters<Satori>[1]['fonts'][number];
type SatoriNode = Parameters<Satori>[0];
type ResvgModule = typeof ResvgWasm;

interface Engines {
  satori: Satori;
  resvg: ResvgModule;
  hb: HbSubset;
}

let engines: Promise<Engines> | undefined;

async function loadEngines(loadWasm: HtmlWasmLoader): Promise<Engines> {
  const [satori, resvg, wasm] = await Promise.all([import('satori'), import('@resvg/resvg-wasm'), loadWasm()]);

  await resvg.initWasm(wasm.resvg);
  const hb = await WebAssembly.instantiate(wasm.harfbuzz);

  return { satori: satori.default, resvg, hb: hb.instance.exports as unknown as HbSubset };
}

// The WebAssembly modules are process-wide (resvg's initWasm may only run once), so they load once and
// stay; a failed load is retried on the next layer rather than pinned.
function sharedEngines(loadWasm: HtmlWasmLoader): Promise<Engines> {
  engines ??= loadEngines(loadWasm).catch((error: unknown) => {
    engines = undefined;

    throw error;
  });

  return engines;
}

function satoriFonts(fonts: RasterFont[], hb: HbSubset, instances: Map<string, Uint8Array>): SatoriFont[] {
  return fonts.flatMap((font) => {
    if (!isVariableFont(font.data)) {
      const weight = faceWeight(font.data) as SatoriFont['weight'];

      return [{ name: font.family, data: font.data.buffer as ArrayBuffer, weight, style: 'normal' as const }];
    }

    return font.weights.map((weight) => {
      const key = `${font.file}@${weight}:${font.data.byteLength}`;
      const data = instances.get(key) ?? instanceFont(hb, font.data, weight);
      instances.set(key, data);

      return {
        name: font.family,
        data: data.buffer as ArrayBuffer,
        weight: weight as SatoriFont['weight'],
        style: 'normal' as const,
      };
    });
  });
}

function withoutHeight(element: LayerElement): LayerElement {
  const style = Object.fromEntries(Object.entries(element.props.style).filter(([key]) => key !== 'height'));

  return { ...element, props: { ...element.props, style } };
}

function svgHeight(svg: string): number {
  const match = /<svg[^>]*\sheight="([\d.]+)"/.exec(svg);

  return match ? Number(match[1]) : 0;
}

async function naturalHeight(satori: Satori, request: HtmlRasterRequest, fonts: SatoriFont[]): Promise<number> {
  const svg = await satori(withoutHeight(request.element) as unknown as SatoriNode, { width: request.width, fonts });

  return svgHeight(svg);
}

async function render(
  request: HtmlRasterRequest,
  loadWasm: HtmlWasmLoader,
  instances: Map<string, Uint8Array>
): Promise<HtmlRaster> {
  const { satori, resvg, hb } = await sharedEngines(loadWasm);
  const fonts = satoriFonts(request.fonts, hb, instances);
  const svg = await satori(request.element as unknown as SatoriNode, {
    width: request.width,
    height: request.height,
    fonts,
  });
  // Laid out again without the box height: the content's natural height, for the overflow advisory.
  const natural = await naturalHeight(satori, request, fonts);
  const image = new resvg.Resvg(svg, { fitTo: { mode: 'zoom', value: request.density } }).render();
  const png = image.asPng();

  image.free();

  return { png, contentHeight: natural };
}

/** Loads the engines ahead of the first layer (the WebView page announces itself ready once they are). */
export async function preloadHtmlEngines(loadWasm: HtmlWasmLoader): Promise<void> {
  await sharedEngines(loadWasm);
}

const MEASURE_INSTANCES = new Map<string, Uint8Array>();

/** The content's natural height in output pixels at the box width: a layout pass, nothing drawn. */
export async function measureHtmlLayout(
  request: Omit<HtmlRasterRequest, 'density'>,
  loadWasm: HtmlWasmLoader
): Promise<number> {
  const { satori, hb } = await sharedEngines(loadWasm);

  return naturalHeight(satori, { ...request, density: 1 }, satoriFonts(request.fonts, hb, MEASURE_INSTANCES));
}

/** A rasteriser with its own cache of instanced faces; the WebAssembly engines are shared. */
export function createSatoriRasteriser(loadWasm: HtmlWasmLoader): HtmlRasteriser {
  const instances = new Map<string, Uint8Array>();

  return { version: HTML_RENDERER_VERSION, render: (request) => render(request, loadWasm, instances) };
}
