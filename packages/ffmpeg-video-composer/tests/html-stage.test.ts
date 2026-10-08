import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { stageHtmlLayer, type HtmlStageContext } from '@/editor/html/stage-html-layer';
import type { HtmlRasteriser, HtmlRasterRequest } from '@/core/html/html-rasteriser';
import type { LayerElement } from '@/core/html/html-element';

const PNG = new Uint8Array([137, 80, 78, 71]);

function texts(element: LayerElement): string[] {
  return (element.props.children ?? []).flatMap((child) => (typeof child === 'string' ? [child] : texts(child)));
}

function context(overrides: Partial<HtmlStageContext> = {}) {
  const requests: HtmlRasterRequest[] = [];
  const rasteriser: HtmlRasteriser = {
    version: 'test',
    render: vi.fn(async (request: HtmlRasterRequest) => {
      requests.push(request);

      return { png: PNG, contentHeight: 50 };
    }),
  };
  const written = new Map<string, Uint8Array>();
  const filesystem = {
    stat: vi.fn(async (path: string) => written.has(path)),
    writeFile: vi.fn(async (path: string, bytes: Uint8Array) => {
      written.set(path, bytes);
    }),
    readFile: vi.fn(async () => new Uint8Array([1, 2, 3])),
    resolveLocalAsset: vi.fn(async (url: string) =>
      url === 'pictures/house.png' ? '/media/pictures/house.png' : null
    ),
  };
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const ctx: HtmlStageContext = {
    filesystem,
    logger,
    dir: '/panels',
    section: 'intro',
    lookup: (name) => ({ address: '<b>12</b> rue' })[name],
    defaultFamily: 'Rubik',
    loadFont: vi.fn(async () => new Uint8Array([0])),
    rasteriser,
    memory: new Map(),
    ...overrides,
  };

  return { ctx, requests, written, logger, rasteriser };
}

const INPUT = {
  name: 'card',
  type: 'html',
  html: '<div><p>{{ address }}</p><img src="pictures/house.png" width="40" height="40"></div>',
  css: 'p { color: red }',
  width: 300,
  height: 100,
};

describe('stageHtmlLayer', () => {
  it('renders the layer once to the build FS under an html:<hash> url', async () => {
    const { ctx, requests, written } = context();
    const staged = await stageHtmlLayer({ ...INPUT }, ctx);

    expect(staged.url).toMatch(/^html:[0-9a-f]{16}$/);
    expect(staged.path).toBe(`/panels/html-${staged.url.slice(5)}.png`);
    expect(written.get(staged.path)).toEqual(PNG);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ width: 300, height: 100, density: 2 });
    expect(texts(requests[0].element)).toEqual(['<b>12</b> rue']);
    expect(requests[0].fonts.map((font) => font.file)).toEqual(['Rubik.ttf']);
  });

  it('inlines template images as data URIs', async () => {
    const { ctx, requests } = context();

    await stageHtmlLayer({ ...INPUT }, ctx);

    const image = JSON.stringify(requests[0].element);

    expect(image).toContain('"src":"data:image/png;base64,AQID"');
  });

  it('reuses a staged layer with the same content instead of rendering it again', async () => {
    const { ctx, rasteriser } = context();
    const first = await stageHtmlLayer({ ...INPUT }, ctx);
    const second = await stageHtmlLayer({ ...INPUT, name: 'other' }, ctx);

    expect(second).toEqual(first);
    expect(rasteriser.render).toHaveBeenCalledTimes(1);
  });

  it('names a different layer differently', async () => {
    const { ctx } = context();
    const first = await stageHtmlLayer({ ...INPUT }, ctx);
    const second = await stageHtmlLayer({ ...INPUT, width: 301 }, ctx);

    expect(second.url).not.toBe(first.url);
  });

  it('warns about content taller than its box', async () => {
    const { ctx, logger } = context();

    await stageHtmlLayer({ ...INPUT, html: '<p>x</p>', height: 20 }, ctx);

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('html_overflow'));
  });

  it('refuses to render without a rasteriser', async () => {
    const { ctx } = context({ rasteriser: null });

    await expect(stageHtmlLayer({ ...INPUT }, ctx)).rejects.toThrow(/html_unavailable/);
  });
});
