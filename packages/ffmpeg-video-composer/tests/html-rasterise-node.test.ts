import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { prepareHtmlLayer, HTML_LAYER_DENSITY } from '@/core/html/html-layer';
import { sha256Hex } from '@/core/determinism/sha256';
import { isVariableFont } from '@/core/html/font-instances';
import { createNodeHtmlRasteriser, HTML_RENDERER_VERSION } from '@/services/html-node/html-rasteriser-node';
import type { RasterFont } from '@/core/html/html-rasteriser';

const here = path.dirname(fileURLToPath(import.meta.url));
const fontsDir = path.resolve(here, '../../leclap-creative-kit/src/library/fonts');

function fontsFor(faces: { family: string; file: string; weights: number[] }[]): RasterFont[] {
  return faces.map((face) => ({ ...face, data: new Uint8Array(fs.readFileSync(path.join(fontsDir, face.file))) }));
}

function pngSize(png: Uint8Array): { width: number; height: number; colorType: number } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);

  return { width: view.getUint32(16), height: view.getUint32(20), colorType: png[25] };
}

const CARD = {
  html: `<div class="card"><span class="tag">For sale</span><p>12 rue des Lilas</p><p class="city">Lyon <strong>3e</strong></p></div>`,
  css:
    '.card { display: flex; flex-direction: column; gap: 12px; padding: 28px; border-radius: 24px; background: #1E1E24 } ' +
    '.tag { color: #FF8AAE; font: 600 28px Rubik } p { margin: 0; font: 56px "Bebas Neue"; color: #F5F3F7 } ' +
    '.city { font: 400 32px Rubik; color: #9A98A6 }',
  width: 360,
  height: 240,
};

describe('Node HTML rasteriser', () => {
  it('names the engine versions it was built against', () => {
    const read = (file: string): string =>
      (JSON.parse(fs.readFileSync(path.resolve(here, '../node_modules', file), 'utf8')) as { version: string }).version;

    expect(HTML_RENDERER_VERSION).toBe(
      `satori@${read('satori/package.json')}+resvg@${read('@resvg/resvg-wasm/package.json')}+harfbuzz@${read('harfbuzzjs/package.json')}`
    );
  });

  it('tells variable faces from static ones', () => {
    expect(isVariableFont(new Uint8Array(fs.readFileSync(path.join(fontsDir, 'Rubik.ttf'))))).toBe(true);
    expect(isVariableFont(new Uint8Array(fs.readFileSync(path.join(fontsDir, 'BebasNeue.ttf'))))).toBe(false);
  });

  it('renders a transparent PNG at 2x the box, byte-identical on every run (golden)', async () => {
    const layer = prepareHtmlLayer(CARD, 'Rubik');
    const rasteriser = createNodeHtmlRasteriser();
    const request = {
      element: layer.element,
      width: CARD.width,
      height: CARD.height,
      density: HTML_LAYER_DENSITY,
      fonts: fontsFor(layer.faces),
    };

    const first = await rasteriser.render(request);
    const second = await createNodeHtmlRasteriser().render(request);

    expect(pngSize(first.png)).toEqual({ width: 720, height: 480, colorType: 6 });
    expect(sha256Hex(second.png)).toBe(sha256Hex(first.png));
    expect(sha256Hex(first.png)).toBe('891095981c5265f83ded663654059ba85d26d5f39afe3d2ec393e85164b02885');
    expect(first.contentHeight).toBeLessThanOrEqual(CARD.height);
  }, 30_000);

  it('measures content taller than the box', async () => {
    const layer = prepareHtmlLayer(
      { html: '<p>one</p><p>two</p><p>three</p>', css: 'p { font-size: 60px }', width: 200, height: 100 },
      'Rubik'
    );
    const raster = await createNodeHtmlRasteriser().render({
      element: layer.element,
      width: 200,
      height: 100,
      density: 1,
      fonts: fontsFor(layer.faces),
    });

    expect(raster.contentHeight).toBeGreaterThan(100);
    expect(pngSize(raster.png)).toMatchObject({ width: 200, height: 100 });
  }, 30_000);
});
