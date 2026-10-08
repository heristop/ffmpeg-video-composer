import { describe, expect, it } from 'vitest';
import { parseHtml } from '@/core/html/html-parse';
import { isSafeAssetRef, sanitiseHtml } from '@/core/html/html-sanitise';

function sanitise(html: string): ReturnType<typeof sanitiseHtml> {
  return sanitiseHtml(parseHtml(html));
}

function messages(html: string): string[] {
  return sanitise(html).findings.map((finding) => finding.message);
}

describe('sanitiseHtml', () => {
  it('keeps allowlisted tags with class and style', () => {
    const { nodes, findings } = sanitise(`<div class="a" style="color: red"><h2>T</h2><strong>b</strong></div>`);

    expect(findings).toEqual([]);
    expect(nodes).toEqual(parseHtml(`<div class="a" style="color: red"><h2>T</h2><strong>b</strong></div>`));
  });

  it('drops scripts, iframes, forms and their content, naming each', () => {
    const { nodes, findings } = sanitise(
      '<p>ok</p><script>alert(1)</script><iframe src="https://x"></iframe><form><input value="x">text</form>'
    );

    expect(nodes).toEqual(parseHtml('<p>ok</p>'));
    expect(findings.map((finding) => finding.code)).toEqual([
      'html_unsupported_markup',
      'html_unsupported_markup',
      'html_unsupported_markup',
    ]);
    expect(findings[0].message).toContain('<script>');
  });

  it('strips event handlers and unknown attributes', () => {
    const { nodes } = sanitise('<div onclick="steal()" id="x" data-a="1" class="k">a</div>');

    expect(nodes).toEqual([
      { kind: 'element', tag: 'div', attrs: { class: 'k' }, children: [{ kind: 'text', text: 'a' }] },
    ]);
    expect(messages('<div onclick="steal()">a</div>')[0]).toContain('event handler');
  });

  it('unwraps a link: its text stays, its href goes', () => {
    const { nodes, findings } = sanitise('<p>see <a href="https://evil.example">this</a></p>');

    expect(nodes).toEqual(parseHtml('<p>see this</p>'));
    expect(findings[0].message).toContain('<a>');
  });

  it('keeps template asset images and refuses remote or local-file ones', () => {
    expect(sanitise('<img src="pictures/house.jpg" alt="House">').nodes).toHaveLength(1);
    expect(sanitise('<img src="/assets/pictures/house.jpg">').nodes).toHaveLength(1);
    expect(sanitise('<img src="https://cdn.example/x.png">').nodes).toEqual([]);
    expect(sanitise('<img src="/etc/passwd">').nodes).toEqual([]);
    expect(sanitise('<img src="../secret.png">').nodes).toEqual([]);
    expect(messages('<img src="https://cdn.example/x.png">')[0]).toContain('https://cdn.example/x.png');
  });

  it('reports each distinct finding once', () => {
    expect(messages('<i onclick="a">1</i><i onclick="b">2</i>')).toHaveLength(1);
  });
});

describe('isSafeAssetRef', () => {
  it.each([
    ['pictures/a.png', true],
    ['a.jpeg', true],
    ['/assets/a.png', true],
    ['data:image/png;base64,iVBORw0KGgo=', true],
    ['data:image/svg+xml;base64,PHN2Zz4=', false],
    ['http://x/a.png', false],
    ['//x/a.png', false],
    ['file:///a.png', false],
    ['/Users/me/a.png', false],
    ['a/../../b.png', false],
    [String.raw`a\b.png`, false],
    ['', false],
  ])('%s → %s', (ref, safe) => {
    expect(isSafeAssetRef(ref)).toBe(safe);
  });
});
