import { describe, expect, it } from 'vitest';
import { parseBrandPage } from '@/core/brand/html';

const page = `<!doctype html><html><head>
  <title>Acme — rockets for everyone</title>
  <meta property="og:site_name" content="Acme">
  <meta name="theme-color" content="#3CE6AC">
  <meta property="og:image" content="/og.jpg">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
  <link rel="stylesheet" href="/assets/app.css">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&family=Space+Grotesk&display=swap" rel="stylesheet">
  <style>:root { --brand: #3ce6ac }</style>
</head><body></body></html>`;

describe('parseBrandPage', () => {
  const parsed = parseBrandPage(page, 'https://acme.test/');

  it('reads the name, theme colour and inline css', () => {
    expect(parsed.name).toBe('Acme');
    expect(parsed.themeColor).toBe('#3ce6ac');
    expect(parsed.inlineCss).toContain('--brand: #3ce6ac');
  });

  it('resolves stylesheet urls, leaving Google Fonts out', () => {
    expect(parsed.stylesheets).toEqual(['https://acme.test/assets/app.css']);
    expect(parsed.googleFamilies).toEqual(['Inter', 'Space Grotesk']);
  });

  it('prefers the apple touch icon as the logo', () => {
    expect(parsed.logo).toEqual({
      url: 'https://acme.test/apple-touch-icon.png',
      type: 'png',
      source: 'apple-touch-icon',
    });
  });

  it('falls back to the title before a separator for the name', () => {
    expect(parseBrandPage('<title>Acme | Rockets</title>', 'https://acme.test/').name).toBe('Acme');
  });

  it('returns no logo when the page names none', () => {
    expect(parseBrandPage('<title>x</title>', 'https://x.test/').logo).toBeNull();
  });

  it('stops at the end of the head and ignores later markup', () => {
    const late = '<head><title>Acme</title></head><body><meta name="theme-color" content="#ff0000"></body>';

    expect(parseBrandPage(late, 'https://acme.test/').themeColor).toBeNull();
  });

  it('caps the inline css it collects', () => {
    const big = `<style>${'a{b:c}'.repeat(200_000)}</style>`;

    expect(parseBrandPage(big, 'https://acme.test/').inlineCss.length).toBeLessThanOrEqual(512 * 1024);
  });

  it('keeps a quoted > inside an attribute', () => {
    const tag = '<meta name="theme-color" content="#3ce6ac" data-x="a>b">';

    expect(parseBrandPage(tag, 'https://acme.test/').themeColor).toBe('#3ce6ac');
  });

  describe('hostile input stays linear', () => {
    const size = 2_000_000;
    const cases: Record<string, string> = {
      'repeated <meta': '<meta '.repeat(size / 6),
      'unterminated <style>': '<style>' + 'a'.repeat(size),
      'unterminated <title>': '<title>' + 'a'.repeat(size),
      'unterminated <link href=': '<link href="' + 'a'.repeat(size),
      'repeated <link rel=': '<link rel="stylesheet" href="'.repeat(size / 28),
      'one huge attribute name': '<meta ' + 'a'.repeat(size) + '>',
      'repeated <title>': '<title>'.repeat(size / 7),
    };

    for (const [label, html] of Object.entries(cases)) {
      it(`parses ${label} within 3s`, () => {
        let best = Infinity;

        for (let run = 0; run < 3; run++) {
          const start = performance.now();
          parseBrandPage(html, 'https://x.test/');
          best = Math.min(best, performance.now() - start);
        }

        expect(best).toBeLessThan(3000);
      });
    }
  });
});
