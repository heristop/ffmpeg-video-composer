import { describe, expect, it } from 'vitest';
import {
  fillHtmlPlaceholders,
  htmlLayerKey,
  inlineImages,
  layerImageRefs,
  prepareHtmlLayer,
} from '@/core/html/html-layer';
import type { LayerElement } from '@/core/html/html-element';

describe('fillHtmlPlaceholders', () => {
  it('fills placeholders with HTML-escaped values and lists the ones it cannot fill', () => {
    const values: Record<string, string> = { address: '<b>12</b> rue "A" & Co' };

    expect(fillHtmlPlaceholders('<p>{{ address }}</p><p>{{price}}</p>', (name) => values[name])).toEqual({
      html: '<p>&lt;b&gt;12&lt;/b&gt; rue &quot;A&quot; &amp; Co</p><p>{{price}}</p>',
      missing: ['price'],
    });
  });
});

describe('prepareHtmlLayer', () => {
  it('sanitises, styles, lays out and lists fonts, images and findings', () => {
    const prepared = prepareHtmlLayer(
      {
        html: `<div class="card" onclick="x()"><img src="pictures/house.jpg"><p>Hi</p></div>`,
        css: '.card { display: flex; z-index: 3; font: 700 40px "Bebas Neue"; background-image: url(textures/grain.png) }',
        width: 600,
        height: 300,
      },
      'Rubik'
    );

    expect(prepared.imageRefs).toEqual(['textures/grain.png', 'pictures/house.jpg']);
    expect(prepared.faces.map((face) => face.family)).toEqual(['Bebas Neue', 'Rubik']);
    expect(prepared.findings.map((finding) => finding.code)).toEqual([
      'html_unsupported_markup',
      'html_unsupported_css',
    ]);
    expect(prepared.unknownFonts).toEqual([]);
  });
});

describe('inlineImages', () => {
  it('swaps image references for their bytes and drops images it could not read', () => {
    const element: LayerElement = {
      type: 'div',
      props: {
        style: { backgroundImage: 'url("a.png")' },
        children: [
          { type: 'img', props: { style: {}, src: 'a.png' } },
          { type: 'img', props: { style: {}, src: 'missing.png' } },
        ],
      },
    };
    const images = new Map([['a.png', 'data:image/png;base64,AAAA']]);

    expect(inlineImages(element, images)).toEqual({
      type: 'div',
      props: {
        style: { backgroundImage: 'url("data:image/png;base64,AAAA")' },
        children: [{ type: 'img', props: { style: {}, src: 'data:image/png;base64,AAAA' } }],
      },
    });
    expect(layerImageRefs(element)).toEqual(['a.png', 'missing.png']);
  });
});

describe('htmlLayerKey', () => {
  it('is stable for equal content and changes with any part', () => {
    const base = { element: { type: 'div', props: { style: {} } }, fonts: ['Rubik.ttf@400'], width: 10, height: 10 };

    expect(htmlLayerKey(base)).toBe(htmlLayerKey({ ...base }));
    expect(htmlLayerKey(base)).toMatch(/^[0-9a-f]{16}$/);
    expect(htmlLayerKey({ ...base, width: 11 })).not.toBe(htmlLayerKey(base));
    expect(htmlLayerKey({ ...base, fonts: ['Rubik.ttf@700'] })).not.toBe(htmlLayerKey(base));
  });
});
