import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { previewHtmlLayer } from '@/services/html-raster/html-layer-preview';
import type { HtmlRasteriser, HtmlRasterRequest } from '@/core/html/html-rasteriser';
import type { LayerElement } from '@/core/html/html-element';

const PNG = new Uint8Array([137, 80, 78, 71]);

function texts(element: LayerElement): string[] {
  return (element.props.children ?? []).flatMap((child) => (typeof child === 'string' ? [child] : texts(child)));
}

function rasteriser(contentHeight = 50) {
  const requests: HtmlRasterRequest[] = [];
  const raster: HtmlRasteriser = {
    version: 'test',
    render: vi.fn(async (request: HtmlRasterRequest) => {
      requests.push(request);

      return { png: PNG, contentHeight };
    }),
  };

  return { raster, requests };
}

const BASE = {
  html: '<div class="card"><p>{{ address }}</p></div>',
  css: '.card { padding: 12px }',
  width: 300,
  height: 100,
  loadFont: vi.fn(async () => new Uint8Array([0])),
};

describe('previewHtmlLayer', () => {
  it('draws the layer at 2x with its placeholders filled, HTML-escaped', async () => {
    const { raster, requests } = rasteriser();

    const preview = await previewHtmlLayer({ ...BASE, values: { address: '<b>12</b> rue' } }, raster);

    expect(preview).toMatchObject({ png: PNG, width: 600, height: 200, findings: [] });
    expect(requests[0]).toMatchObject({ width: 300, height: 100, density: 2 });
    expect(texts(requests[0].element).join(' ')).toContain('<b>12</b>');
  });

  it('resolves theme tokens from global.theme and falls back to its body font', async () => {
    const { raster, requests } = rasteriser();

    await previewHtmlLayer(
      { ...BASE, css: '.card { background: $color.surface; font-family: $font.display }', global: { theme: 'leclap' } },
      raster
    );

    const style = requests[0].element.props.style;

    expect(JSON.stringify(style)).not.toContain('$color');
    expect(requests[0].fonts.length).toBeGreaterThan(0);
  });

  it('reports every advisory a render would log', async () => {
    const { raster } = rasteriser(180);

    const preview = await previewHtmlLayer(
      {
        ...BASE,
        html: '<div onclick="x()"><p>{{ address }}</p></div>',
        css: 'p { z-index: 2; font-family: "Comic Sans MS" }',
      },
      raster
    );

    expect(preview.findings.map((finding) => finding.code)).toEqual([
      'html_unsupported_markup',
      'html_unsupported_css',
      'html_font_unknown',
      'html_missing_field',
      'html_overflow',
    ]);
    expect(preview.findings.at(-1)?.message).toContain('180');
  });

  it('inlines the images the host can read and drops the rest', async () => {
    const { raster, requests } = rasteriser();
    const readImage = vi.fn(async (ref: string) => (ref === 'logo.png' ? 'data:image/png;base64,AAAA' : null));

    await previewHtmlLayer(
      { ...BASE, html: '<div><img src="logo.png" width="10" height="10"><img src="gone.png"></div>', readImage },
      raster
    );

    expect(readImage).toHaveBeenCalledWith('logo.png');
    expect(JSON.stringify(requests[0].element)).toContain('data:image/png;base64,AAAA');
    expect(JSON.stringify(requests[0].element)).not.toContain('gone.png');
  });
});
