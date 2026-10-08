import { describe, expect, it } from 'vitest';
import { layerFonts, resolveFontStack } from '@/core/html/html-fonts';
import type { LayerElement } from '@/core/html/html-element';

describe('resolveFontStack', () => {
  it('names the first registry family of a stack, by family, label, id or file', () => {
    expect(resolveFontStack('"Bebas Neue", sans-serif')).toEqual({ family: 'Bebas Neue', unknown: [] });
    expect(resolveFontStack('bebas')).toEqual({ family: 'Bebas Neue', unknown: [] });
    expect(resolveFontStack('PlayfairDisplay.ttf')).toEqual({ family: 'Playfair Display', unknown: [] });
    expect(resolveFontStack("'roboto mono'")).toEqual({ family: 'Roboto Mono', unknown: [] });
  });

  it('maps generic families onto bundled faces', () => {
    expect(resolveFontStack('monospace')).toEqual({ family: 'Roboto Mono', unknown: [] });
    expect(resolveFontStack('serif')).toEqual({ family: 'Playfair Display', unknown: [] });
    expect(resolveFontStack('sans-serif')).toEqual({ family: null, unknown: [] });
  });

  it('reports families the registry does not know', () => {
    expect(resolveFontStack('Helvetica Neue, Arial')).toEqual({ family: null, unknown: ['Helvetica Neue', 'Arial'] });
    expect(resolveFontStack('Comic Sans, Anton')).toEqual({ family: 'Anton', unknown: ['Comic Sans'] });
  });
});

describe('layerFonts', () => {
  it('rewrites every font-family to its registry family and lists the faces and weights to load', () => {
    const root: LayerElement = {
      type: 'div',
      props: {
        style: { fontFamily: 'Rubik' },
        children: [
          { type: 'p', props: { style: { fontFamily: '"Bebas Neue"', fontWeight: '600' }, children: ['A'] } },
          { type: 'p', props: { style: { fontFamily: 'Nope', fontWeight: 'bold' }, children: ['B'] } },
        ],
      },
    };

    const fonts = layerFonts(root, 'Rubik');

    expect(fonts.unknown).toEqual(['Nope']);
    expect(((fonts.element.props.children ?? [])[1] as LayerElement).props.style.fontFamily).toBe('Rubik');
    expect(fonts.faces).toEqual([
      { family: 'Bebas Neue', file: 'BebasNeue.ttf', weights: [400, 600, 700] },
      { family: 'Rubik', file: 'Rubik.ttf', weights: [400, 600, 700] },
    ]);
  });
});
