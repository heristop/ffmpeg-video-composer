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

  it('decodes html entities in attribute values and the title', () => {
    const html = `<title>Ben &amp; Jerry&#39;s &#x41;&bogus; &#99999999;</title>
      <link rel="stylesheet" href="/a.css?a=1&amp;b=2">
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400&amp;family=Space+Grotesk&amp;display=swap">`;
    const parsed = parseBrandPage(html, 'https://acme.test/');

    expect(parsed.name).toBe("Ben & Jerry's A&bogus; &#99999999;");
    expect(parsed.stylesheets).toEqual(['https://acme.test/a.css?a=1&b=2']);
    expect(parsed.googleFamilies).toEqual(['Inter', 'Space Grotesk']);
  });

  it('only keeps http and https urls', () => {
    for (const bad of [['java', 'script:alert(1)'].join(''), 'data:image/png;base64,AAAA', 'file:///etc/x.png']) {
      const html = `<link rel="stylesheet" href="${bad}"><link rel="icon" href="${bad}"><meta property="og:image" content="${bad}">`;
      const parsed = parseBrandPage(html, 'https://acme.test/');

      expect(parsed.stylesheets).toEqual([]);
      expect(parsed.logo).toBeNull();
    }
  });

  it('treats script bodies as raw text', () => {
    const html = `<script>var s = '</head><body><link rel="icon" href="/evil.png">';</script><meta name="theme-color" content="#3ce6ac"></head>`;
    const parsed = parseBrandPage(html, 'https://acme.test/');

    expect(parsed.themeColor).toBe('#3ce6ac');
    expect(parsed.logo).toBeNull();
  });

  it('ignores alternate stylesheets and accepts precomposed apple icons', () => {
    const html = `<link rel="alternate stylesheet" href="/alt.css"><link rel="apple-touch-icon-precomposed" href="/p.png">`;
    const parsed = parseBrandPage(html, 'https://acme.test/');

    expect(parsed.stylesheets).toEqual([]);
    expect(parsed.logo).toEqual({ url: 'https://acme.test/p.png', type: 'png', source: 'apple-touch-icon' });
  });

  it('lists the site-wide stylesheets first and colour-scheme variants last', () => {
    // A bundler's hashed component sheets come before the layout sheet holding the tokens; a design system
    // ships every colour scheme as its own sheet ahead of the site's.
    const html = [
      '<link rel="stylesheet" href="/dark-1a2b.css">',
      '<link rel="stylesheet" href="/light_high_contrast-3c4d.css">',
      '<link rel="stylesheet" href="/_next/static/css/Tpxbzi3N.css">',
      '<link rel="stylesheet" href="/_next/static/css/BNNY1qpD.css">',
      '<link rel="stylesheet" href="/print.css" media="print">',
      '<link rel="stylesheet" href="/_next/static/css/layout.TfwOB7lY.css">',
      '<link rel="stylesheet" href="/assets/global-58d1.css">',
    ].join('');

    expect(parseBrandPage(html, 'https://acme.test/').stylesheets).toEqual([
      'https://acme.test/_next/static/css/layout.TfwOB7lY.css',
      'https://acme.test/assets/global-58d1.css',
      'https://acme.test/_next/static/css/Tpxbzi3N.css',
      'https://acme.test/_next/static/css/BNNY1qpD.css',
      'https://acme.test/dark-1a2b.css',
      'https://acme.test/light_high_contrast-3c4d.css',
      'https://acme.test/print.css',
    ]);
  });

  it('takes the largest icon, by its sizes, over a small first one', () => {
    const html = [
      '<link rel="icon" sizes="32x32" href="/favicon32.png">',
      '<link rel="apple-touch-icon" href="/touch.png">',
      '<link rel="apple-touch-icon" sizes="57x57" href="/touch-57.png">',
      '<link rel="apple-touch-icon" sizes="180x180" href="/touch-180.png">',
      '<link rel="icon" sizes="16x16 256x256" href="/icon-256.png">',
    ].join('');

    expect(parseBrandPage(html, 'https://acme.test/').logo?.url).toBe('https://acme.test/icon-256.png');
    expect(parseBrandPage(html.replace(/<link rel="icon" sizes="16x16[^>]*>/, ''), 'https://acme.test/').logo).toEqual({
      url: 'https://acme.test/touch-180.png',
      type: 'png',
      source: 'apple-touch-icon',
    });
  });

  it('keeps a touch icon without sizes above small favicons', () => {
    const html = '<link rel="icon" sizes="32x32" href="/f32.png"><link rel="apple-touch-icon" href="/apple.png">';

    expect(parseBrandPage(html, 'https://acme.test/').logo?.url).toBe('https://acme.test/apple.png');
  });

  it('tries the next link of the same kind when one is unusable', () => {
    const html = [
      '<link rel="apple-touch-icon" href="javascript:alert(1)">',
      '<link rel="apple-touch-icon" href="/touch">',
      '<link rel="apple-touch-icon" href="/touch.png">',
      '<meta property="og:image" content="/og.png">',
    ].join('');

    expect(parseBrandPage(html, 'https://acme.test/').logo).toEqual({
      url: 'https://acme.test/touch.png',
      type: 'png',
      source: 'apple-touch-icon',
    });
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
