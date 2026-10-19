import { describe, expect, it } from 'vitest';
import { parseHtml } from '@/core/html/html-parse';
import { parseStylesheet } from '@/core/html/css-parse';
import { sanitiseHtml } from '@/core/html/html-sanitise';
import { styleTree } from '@/core/html/html-styles';
import { buildLayerElement, type LayerElement } from '@/core/html/html-element';
import { applyMotionStates, motionTargets, REST_STATE, stripMotion } from '@/core/html/element-motion';

function layer(html: string, css = ''): LayerElement {
  const sanitised = sanitiseHtml(parseHtml(html));

  return buildLayerElement(styleTree(sanitised.nodes, parseStylesheet(css)).nodes, {
    width: 400,
    height: 200,
    fontFamily: 'Rubik',
  });
}

function tagged(element: LayerElement): LayerElement[] {
  const own = element.props.motion === undefined ? [] : [element];
  const nested = (element.props.children ?? []).flatMap((child) => (typeof child === 'string' ? [] : tagged(child)));

  return [...own, ...nested];
}

describe('data-motion markup', () => {
  it('keeps a valid data-motion name and refuses an invalid one, naming it', () => {
    const { nodes, findings } = sanitiseHtml(parseHtml('<p data-motion="title">A</p><p data-motion="Bad Name">B</p>'));

    expect(nodes).toEqual([
      { kind: 'element', tag: 'p', attrs: { 'data-motion': 'title' }, children: [{ kind: 'text', text: 'A' }] },
      { kind: 'element', tag: 'p', attrs: {}, children: [{ kind: 'text', text: 'B' }] },
    ]);
    expect(findings.map((finding) => finding.message)).toEqual([
      '<p data-motion="Bad Name">: motion name refused (lowercase letters, digits and dashes, 32 at most, starting with a letter)',
    ]);
  });

  it('drops hostile data-motion values with a finding', () => {
    const { nodes, findings } = sanitiseHtml(
      parseHtml('<p data-motion="a b">A</p><p data-motion="x&quot; onclick=1">B</p>')
    );

    expect(JSON.stringify(nodes)).not.toContain('data-motion');
    expect(findings).toHaveLength(2);
  });

  it('carries each name onto its laid-out element, in document order', () => {
    const root = layer(
      '<ul><li data-motion="item">One</li><li data-motion="item">Two</li></ul><h2 data-motion="title">T</h2>'
    );

    expect(motionTargets(root)).toEqual(['item', 'item', 'title']);
  });

  it('keeps a tagged inline element whole inside a line of text', () => {
    const words = tagged(layer('<p>Now <strong data-motion="price">€420</strong> only</p>'));

    expect(words).toHaveLength(1);
    expect(words[0].type).toBe('strong');
    expect(words[0].props.children).toEqual(['€420']);
    expect(words[0].props.style.fontWeight).toBe('700');
  });
});

describe('applyMotionStates', () => {
  const root = layer('<h2 data-motion="title" style="opacity: 0.8; transform: rotate(2deg)">T</h2><p>Body</p>');

  it('moves, turns, scales and fades a tagged element over its own style', () => {
    const moved = applyMotionStates(root, [{ x: 12, y: -8, scale: 1.5, rotate: 10, opacity: 0.5 }]);
    const title = (moved.props.children ?? [])[0] as LayerElement;

    expect(title.props.style.transform).toBe('translate(12px, -8px) rotate(10deg) scale(1.5) rotate(2deg)');
    expect(title.props.style.opacity).toBe('0.4');
    expect(title.props).not.toHaveProperty('motion');
  });

  it('leaves an element at rest exactly as authored and strips every motion name', () => {
    expect(applyMotionStates(root, [REST_STATE])).toEqual(stripMotion(root));
    expect(tagged(stripMotion(root))).toEqual([]);
    expect(JSON.stringify(stripMotion(root))).not.toContain('"motion"');
  });

  it('leaves an untagged layer unchanged', () => {
    const plain = layer('<div class="card"><p>Hi</p></div>', '.card { padding: 8px }');

    expect(stripMotion(plain)).toEqual(plain);
  });
});
