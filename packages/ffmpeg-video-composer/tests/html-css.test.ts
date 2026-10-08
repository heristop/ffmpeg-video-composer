import { describe, expect, it } from 'vitest';
import { parseDeclarations, parseStylesheet } from '@/core/html/css-parse';
import { toLayerStyle } from '@/core/html/css-properties';

describe('parseStylesheet', () => {
  it('reads tag, class and descendant selectors with their declarations', () => {
    const { rules, findings } = parseStylesheet(
      '.card { display: flex; gap: 12px } .card p, h1 { color: red !important; } /* note */ span.tag{color:blue}'
    );

    expect(findings).toEqual([]);
    expect(rules.map((rule) => [rule.selector.source, rule.selector.specificity, rule.declarations])).toEqual([
      [
        '.card',
        10,
        [
          { property: 'display', value: 'flex' },
          { property: 'gap', value: '12px' },
        ],
      ],
      ['.card p', 11, [{ property: 'color', value: 'red' }]],
      ['h1', 1, [{ property: 'color', value: 'red' }]],
      ['span.tag', 11, [{ property: 'color', value: 'blue' }]],
    ]);
  });

  it('drops at-rules and unsupported selectors, naming them', () => {
    const { rules, findings } = parseStylesheet(
      '@import url(x.css); @media (min-width: 1px) { p { color: red } } #id { color: red } a:hover { color: red } p { color: blue }'
    );

    expect(rules.map((rule) => rule.selector.source)).toEqual(['p']);
    expect(findings.map((finding) => finding.message)).toEqual([
      'css @import: at-rules are not supported',
      'css @media: at-rules are not supported',
      'css selector "#id": only tag, .class and descendant selectors are supported',
      'css selector "a:hover": only tag, .class and descendant selectors are supported',
    ]);
    expect(findings.every((finding) => finding.code === 'html_unsupported_css')).toBe(true);
  });

  it('keeps semicolons inside parentheses and quotes', () => {
    expect(parseDeclarations('background: url("a;b.png"); font-family: "A;B", serif')).toEqual([
      { property: 'background', value: 'url("a;b.png")' },
      { property: 'font-family', value: '"A;B", serif' },
    ]);
  });
});

describe('toLayerStyle', () => {
  function style(css: string): ReturnType<typeof toLayerStyle> {
    return toLayerStyle(parseDeclarations(css));
  }

  it('camel-cases supported properties', () => {
    expect(style('border-radius: 24px; background-color: #fff; -webkit-text-stroke-width: 2px').style).toEqual({
      borderRadius: '24px',
      backgroundColor: '#fff',
      WebkitTextStrokeWidth: '2px',
    });
  });

  it('expands the font shorthand', () => {
    expect(style('font: italic 600 28px/1.2 "Bebas Neue", sans-serif').style).toEqual({
      fontStyle: 'italic',
      fontWeight: '600',
      fontSize: '28px',
      lineHeight: '1.2',
      fontFamily: '"Bebas Neue", sans-serif',
    });
    expect(style('font: 700 56px Rubik').style).toEqual({ fontWeight: '700', fontSize: '56px', fontFamily: 'Rubik' });
  });

  it('drops and reports unsupported properties and values', () => {
    const { style: kept, findings } = style(
      'z-index: 2; display: grid; position: fixed; width: calc(100% - 2px); animation: spin 1s; color: red'
    );

    expect(kept).toEqual({ color: 'red' });
    expect(findings.map((finding) => finding.message)).toEqual([
      'css z-index: not supported in HTML layers',
      'css display: grid: not supported (use flex, block, contents or none)',
      'css position: fixed: not supported (use relative, absolute or static)',
      'css width: calc(100% - 2px): calc() is not supported',
      'css animation: not supported in HTML layers',
    ]);
  });

  it('keeps url() to a template asset and refuses any other', () => {
    expect(style('background-image: url("pictures/a.png")').style).toEqual({
      backgroundImage: 'url("pictures/a.png")',
    });

    const remote = style('background-image: url(https://x/a.png)');

    expect(remote.style).toEqual({});
    expect(remote.findings[0].message).toContain('https://x/a.png');
  });

  it('keeps custom properties', () => {
    expect(style('--accent: #f0f; color: var(--accent)').style).toEqual({ '--accent': '#f0f', color: 'var(--accent)' });
  });
});
