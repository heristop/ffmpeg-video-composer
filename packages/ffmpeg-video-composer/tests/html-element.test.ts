import { describe, expect, it } from 'vitest';
import { parseHtml } from '@/core/html/html-parse';
import { parseStylesheet } from '@/core/html/css-parse';
import { styleTree } from '@/core/html/html-styles';
import { buildLayerElement, type LayerElement } from '@/core/html/html-element';

function build(html: string, css = ''): LayerElement {
  const styled = styleTree(parseHtml(html), parseStylesheet(css));

  return buildLayerElement(styled.nodes, { width: 400, height: 200, fontFamily: 'Rubik' });
}

function childAt(element: LayerElement, index: number): LayerElement {
  return (element.props.children ?? [])[index] as LayerElement;
}

function only(root: LayerElement): LayerElement {
  return childAt(root, 0);
}

describe('buildLayerElement', () => {
  it('wraps the layer in a box-sized flex column carrying the default font', () => {
    const root = build('<p>hi</p>');

    expect(root.type).toBe('div');
    expect(root.props.style).toEqual({
      display: 'flex',
      flexDirection: 'column',
      width: '400px',
      height: '200px',
      fontFamily: 'Rubik',
    });
  });

  it('collapses the whitespace of a text-only element into one string', () => {
    expect(only(build('<p>  Hello \n  world </p>'))).toEqual({
      type: 'p',
      props: { style: {}, children: ['Hello world'] },
    });
  });

  it('makes a text-only div a flex box, as Satori requires of a div whose text it splits into words', () => {
    expect(only(build('<div class="cta">Shop the collection</div>', '.cta { padding: 8px }'))).toEqual({
      type: 'div',
      props: { style: { display: 'flex', padding: '8px' }, children: ['Shop the collection'] },
    });
    expect(only(build('<div style="display: none">x y</div>')).props.style).toEqual({ display: 'none' });
  });

  it('applies matched rules and the inline style, inline last', () => {
    const p = only(
      build('<p class="a" style="color: blue">x</p>', 'p { color: red; margin: 0 } .a { font-size: 20px }')
    );

    expect(p.props.style).toEqual({ color: 'blue', margin: '0', fontSize: '20px' });
  });

  it('stacks the elements of a block container as a flex column, dropping blank text', () => {
    const div = only(build('<div>\n  <p>a</p>\n  <p>b</p>\n</div>'));

    expect(div.props.style).toEqual({ display: 'flex', flexDirection: 'column' });
    expect(div.props.children?.map((child) => (child as LayerElement).type)).toEqual(['p', 'p']);
  });

  it('keeps an authored display and its children as flex items', () => {
    const div = only(build('<div class="row"><span>a</span> <span>b</span></div>', '.row { display: flex; gap: 8px }'));

    expect(div.props.style).toEqual({ display: 'flex', gap: '8px' });
    expect(div.props.children).toHaveLength(2);
  });

  it('flows mixed text and inline elements word by word', () => {
    const p = only(build('<p>Hello <strong>big</strong> world</p>'));

    expect(p.props.style).toEqual({ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline' });
    expect(p.props.children).toEqual([
      { type: 'span', props: { style: { whiteSpace: 'pre' }, children: ['Hello '] } },
      { type: 'span', props: { style: { fontWeight: '700', whiteSpace: 'pre' }, children: ['big '] } },
      { type: 'span', props: { style: { whiteSpace: 'pre' }, children: ['world'] } },
    ]);
  });

  it('aligns a centred flow and breaks lines at <br>', () => {
    const p = only(build('<p style="text-align: center">a <b>b</b><br>c</p>'));

    expect(p.props.style.justifyContent).toBe('center');
    expect(childAt(p, 2)).toEqual({ type: 'div', props: { style: { flexBasis: '100%', height: '0px' } } });
  });

  it('keeps a styled inline element whole inside a flow', () => {
    const p = only(
      build('<p>Price <span class="badge">€ 420 000</span></p>', '.badge { background: red; padding: 4px }')
    );

    expect(childAt(p, 1)).toEqual({
      type: 'span',
      props: { style: { background: 'red', padding: '4px' }, children: ['€ 420 000'] },
    });
  });

  it('marks list items', () => {
    const ul = only(build('<ul><li>one</li><li>two</li></ul>'));
    const ol = only(build('<ol><li>one</li></ol>'));

    expect(childAt(ul, 1).props.children).toEqual(['• two']);
    expect(childAt(ol, 0).props.children).toEqual(['1. one']);
  });

  it('passes an image with its source and size', () => {
    expect(only(build('<img src="a.png" width="120" height="80" alt="A">'))).toEqual({
      type: 'img',
      props: { style: {}, src: 'a.png', width: 120, height: 80 },
    });
  });
});
