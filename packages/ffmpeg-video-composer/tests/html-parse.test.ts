import { describe, expect, it } from 'vitest';
import { parseHtml } from '@/core/html/html-parse';

describe('parseHtml', () => {
  it('builds a tree of elements, attributes and text', () => {
    expect(parseHtml(`<div class='card'><span class="tag">For sale</span><p>12 rue</p></div>`)).toEqual([
      {
        kind: 'element',
        tag: 'div',
        attrs: { class: 'card' },
        children: [
          { kind: 'element', tag: 'span', attrs: { class: 'tag' }, children: [{ kind: 'text', text: 'For sale' }] },
          { kind: 'element', tag: 'p', attrs: {}, children: [{ kind: 'text', text: '12 rue' }] },
        ],
      },
    ]);
  });

  it('lowercases tag and attribute names and reads unquoted and bare attributes', () => {
    expect(parseHtml('<IMG SRC=a.png alt hidden>')).toEqual([
      { kind: 'element', tag: 'img', attrs: { src: 'a.png', alt: '', hidden: '' }, children: [] },
    ]);
  });

  it('decodes entities in text and attribute values', () => {
    expect(parseHtml('<p title="a &amp; b">5 &lt; 6 &#233;t&#xE9; &nbsp;&quot;x&quot;</p>')).toEqual([
      {
        kind: 'element',
        tag: 'p',
        attrs: { title: 'a & b' },
        children: [{ kind: 'text', text: '5 < 6 été  "x"' }],
      },
    ]);
  });

  it('treats void elements as childless and closes unclosed elements at the end', () => {
    expect(parseHtml('<p>a<br>b<div>c')).toEqual([
      {
        kind: 'element',
        tag: 'p',
        attrs: {},
        children: [
          { kind: 'text', text: 'a' },
          { kind: 'element', tag: 'br', attrs: {}, children: [] },
          { kind: 'text', text: 'b' },
          { kind: 'element', tag: 'div', attrs: {}, children: [{ kind: 'text', text: 'c' }] },
        ],
      },
    ]);
  });

  it('skips comments and keeps raw-text elements empty', () => {
    expect(parseHtml('<!-- hi --><script>alert("<b>")</script><style>p{}</style>ok')).toEqual([
      { kind: 'element', tag: 'script', attrs: {}, children: [] },
      { kind: 'element', tag: 'style', attrs: {}, children: [] },
      { kind: 'text', text: 'ok' },
    ]);
  });

  it('ignores a stray closing tag and reads a lone < as text', () => {
    expect(parseHtml('</span>1 < 2')).toEqual([{ kind: 'text', text: '1 < 2' }]);
  });

  it('closes the open elements up to the matching tag', () => {
    expect(parseHtml('<div><span>a</div>b')).toEqual([
      {
        kind: 'element',
        tag: 'div',
        attrs: {},
        children: [{ kind: 'element', tag: 'span', attrs: {}, children: [{ kind: 'text', text: 'a' }] }],
      },
      { kind: 'text', text: 'b' },
    ]);
  });

  it('stops nesting past the depth limit instead of recursing without bound', () => {
    const deep = '<div>'.repeat(200) + 'x';
    let depth = 0;
    let node = parseHtml(deep)[0];

    while (node.kind === 'element' && node.children.length > 0) {
      depth++;
      node = node.children[0];
    }

    expect(depth).toBeLessThanOrEqual(64);
  });
});
