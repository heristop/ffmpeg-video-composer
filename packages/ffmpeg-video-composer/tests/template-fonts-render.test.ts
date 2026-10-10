import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { prepareHtmlLayer } from '@/core/html/html-layer';
import { sha256Hex } from '@/core/determinism/sha256';
import type { RasterFont } from '@/core/html/html-rasteriser';
import { type TemplateFontFace } from '@/core/html/template-fonts';
import { loadTemplateFonts } from '@/core/html/template-font-load';
import { createNodeHtmlRasteriser } from '@/services/html-node/html-rasteriser-node';
import { stageHtmlLayer, type HtmlStageContext } from '@/editor/html/stage-html-layer';
import { ttfToWoff } from './fixtures/woff';

// A template's own font drawn by the real pipeline (Satori + HarfBuzz + resvg): Pacifico (OFL) stands in for a
// brand face under a family name of the template's choosing.
const here = path.dirname(fileURLToPath(import.meta.url));
const fontsDir = path.resolve(here, '../../leclap-creative-kit/src/library/fonts');
const read = (file: string): Uint8Array => new Uint8Array(fs.readFileSync(path.join(fontsDir, file)));
const PACIFICO = read('Pacifico.ttf');

const LAYER = {
  html: '<p>Bonjour Ubuntu</p>',
  css: 'p { margin: 0; font: 56px "Brand"; color: #ffffff }',
  width: 640,
  height: 120,
};

async function draw(spec: typeof LAYER, custom: TemplateFontFace[]): Promise<{ hash: string; ink: number }> {
  const layer = prepareHtmlLayer(spec, 'Rubik', custom);
  const fonts: RasterFont[] = layer.faces.map((face) => ({
    ...face,
    data: custom.find((font) => font.file === face.file)?.data ?? read(face.file),
  }));
  const raster = await createNodeHtmlRasteriser().render({
    element: layer.element,
    width: spec.width,
    height: spec.height,
    density: 1,
    fonts,
  });

  return { hash: sha256Hex(raster.png), ink: raster.png.byteLength };
}

function brand(data: Uint8Array, family = 'Brand'): Promise<TemplateFontFace[]> {
  return loadTemplateFonts([{ family, src: 'Brand.ttf' }], async () => data);
}

describe('template fonts, drawn', () => {
  it('draws the text in the template face, not the fallback, the same on every run', async () => {
    const custom = await brand(PACIFICO);
    const first = await draw(LAYER, custom);
    const again = await draw(LAYER, await brand(PACIFICO.slice()));
    const fallback = await draw(LAYER, []);

    expect(again.hash).toBe(first.hash);
    expect(first.hash).not.toBe(fallback.hash);
  }, 30_000);

  it('draws a WOFF face exactly as the TrueType face it wraps', async () => {
    const ttf = await draw(LAYER, await brand(PACIFICO));
    const woff = await draw(LAYER, await brand(ttfToWoff(PACIFICO)));

    expect(woff.hash).toBe(ttf.hash);
  }, 30_000);

  it('lets a template face win over a bundled family of the same name', async () => {
    const spec = { ...LAYER, css: 'p { margin: 0; font: 56px Oswald; color: #ffffff }' };
    const bundled = await draw(spec, []);
    const overridden = await draw(spec, await brand(PACIFICO, 'Oswald'));
    const pacifico = await draw(LAYER, await brand(PACIFICO));

    expect(overridden.hash).not.toBe(bundled.hash);
    expect(overridden.hash).toBe(pacifico.hash);
  }, 30_000);
});

describe('stageHtmlLayer with template fonts', () => {
  function context(templateFonts: TemplateFontFace[]) {
    const fonts: RasterFont[][] = [];
    const ctx: HtmlStageContext = {
      filesystem: {
        stat: vi.fn(async () => false),
        writeFile: vi.fn(async () => undefined),
        readFile: vi.fn(async () => new Uint8Array()),
        resolveLocalAsset: vi.fn(async () => null),
      },
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as HtmlStageContext['logger'],
      dir: '/panels',
      section: 'intro',
      lookup: () => undefined,
      defaultFamily: 'Rubik',
      loadFont: vi.fn(async () => new Uint8Array([0])),
      templateFonts,
      rasteriser: {
        version: 'test',
        render: vi.fn(async (request) => {
          fonts.push(request.fonts);

          return { png: new Uint8Array([1]), contentHeight: 10 };
        }),
      },
      memory: new Map(),
    };

    return { ctx, fonts };
  }

  const INPUT = { name: 'card', ...LAYER };

  it('hands the rasteriser the template face, without asking the registry for it', async () => {
    const custom = await brand(PACIFICO);
    const { ctx, fonts } = context(custom);

    await stageHtmlLayer({ ...INPUT }, ctx);

    const brandFace = fonts[0].find((font) => font.family === 'Brand');

    expect(brandFace?.data).toBe(custom[0].data);
    expect(ctx.loadFont).toHaveBeenCalledWith('Rubik.ttf');
    expect(ctx.loadFont).not.toHaveBeenCalledWith(custom[0].file);
  });

  it('names the layer after the font bytes: another file under the same family is another layer', async () => {
    const first = await stageHtmlLayer({ ...INPUT }, context(await brand(PACIFICO)).ctx);
    const same = await stageHtmlLayer({ ...INPUT }, context(await brand(PACIFICO.slice())).ctx);
    const other = await stageHtmlLayer({ ...INPUT }, context(await brand(read('Lobster.ttf'))).ctx);

    expect(same.url).toBe(first.url);
    expect(other.url).not.toBe(first.url);
  });
});
