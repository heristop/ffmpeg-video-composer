// packages/ffmpeg-video-composer/tests/brand-css.test.ts
import { describe, expect, it } from 'vitest';
import { cssColors, cssFonts, normalizeColor } from '@/core/brand/css';

describe('normalizeColor', () => {
  it('reads hex, rgb(), rgba() and hsl()', () => {
    expect(normalizeColor('#3ce')).toBe('#33ccee');
    expect(normalizeColor('#3CE6AC')).toBe('#3ce6ac');
    expect(normalizeColor('rgb(124, 131, 253)')).toBe('#7c83fd');
    expect(normalizeColor('rgba(0 0 0 / 0.8)')).toBe('#000000');
    expect(normalizeColor('hsl(0, 100%, 50%)')).toBe('#ff0000');
  });

  it('drops mostly transparent colours, keywords and variables', () => {
    expect(normalizeColor('rgba(0,0,0,0.1)')).toBeNull();
    expect(normalizeColor('transparent')).toBeNull();
    expect(normalizeColor('currentColor')).toBeNull();
    expect(normalizeColor('var(--brand)')).toBeNull();
  });

  it('keeps black and white keywords', () => {
    expect(normalizeColor('white')).toBe('#ffffff');
    expect(normalizeColor('black')).toBe('#000000');
  });
});

describe('cssColors', () => {
  const css = `
    :root { --brand-primary: #3ce6ac; --surface: #f4f1ea; --gap: 12px; }
    body { background: #f4f1ea; color: #111111; }
    .button { background-color: #3ce6ac; }
    .button:hover { background-color: rgb(60, 230, 172); }
    @media (prefers-color-scheme: dark) { body { background: #0b0a14; } }
  `;

  it('weighs brand-named custom properties above plain declarations', () => {
    const colors = cssColors(css);

    // #3ce6ac: --brand-primary 5 + .button background 2 + :hover background (same colour as rgb()) 2.
    expect(colors[0]).toEqual({ hex: '#3ce6ac', weight: 9, source: 'custom-property' });
    // #f4f1ea: --surface 2 + body background 2; #0b0a14: a background 2; #111111: a text colour 1.
    expect(colors.map((c) => c.hex)).toEqual(['#3ce6ac', '#f4f1ea', '#0b0a14', '#111111']);
  });
});

describe('cssFonts', () => {
  it('reads display, body and mono families from their selectors', () => {
    const fonts = cssFonts(`
      body { font-family: "Inter", system-ui, sans-serif; }
      h1, h2 { font-family: 'ABC Solar Display', Inter, sans-serif; }
      code, pre { font-family: "JetBrains Mono", monospace; }
      .nav { font-family: Inter; }
    `);

    expect(fonts).toEqual({
      display: 'ABC Solar Display',
      body: 'Inter',
      mono: 'JetBrains Mono',
      families: ['Inter', 'ABC Solar Display', 'JetBrains Mono'],
    });
  });

  it('ignores generic families and CSS variables', () => {
    expect(cssFonts('body { font-family: var(--font-sans); } h1 { font-family: serif; }')).toEqual({
      display: null,
      body: null,
      mono: null,
      families: [],
    });
  });
});
