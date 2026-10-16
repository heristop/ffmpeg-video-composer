// packages/ffmpeg-video-composer/tests/brand-css.test.ts
import { describe, expect, it } from 'vitest';
import { cssColors, cssFonts, normalizeColor, withThemeColor } from '@/core/brand/css';

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

describe('brand css hardening', () => {
  it('reads 4 and 8 digit hex with alpha', () => {
    expect(normalizeColor('#3ce6acff')).toBe('#3ce6ac');
    expect(normalizeColor('#3ce6ac40')).toBeNull();
    expect(normalizeColor('#abcd')).toBe('#aabbcc');
    expect(normalizeColor('#abc0')).toBeNull();
  });

  it('reads rgb() percentages and hsl() hue units', () => {
    expect(normalizeColor('rgb(10% 20% 30%)')).toBe('#1a334d');
    expect(normalizeColor('hsl(0.5turn 50% 40%)')).toBe(normalizeColor('hsl(180 50% 40%)'));
    expect(normalizeColor('hsl(180deg 50% 40%)')).toBe(normalizeColor('hsl(180 50% 40%)'));
    expect(normalizeColor('hsl(200grad 50% 40%)')).toBe(normalizeColor('hsl(180 50% 40%)'));
    expect(normalizeColor('hsl(3.14159265rad 50% 40%)')).toBe(normalizeColor('hsl(180 50% 40%)'));
  });

  it('strips !important from families and still counts important colours', () => {
    expect(cssFonts('h1{font-family:"A B"!important}').display).toBe('A B');
    expect(cssFonts('h1{font-family:Inter ! IMPORTANT}').display).toBe('Inter');
    expect(cssColors('a{color:#3ce6ac !important}')).toEqual([{ hex: '#3ce6ac', weight: 1, source: 'declaration' }]);
  });

  it('ignores comments', () => {
    expect(cssColors('/* color: #ff0000; */ a{color:#00ff00}').map((c) => c.hex)).toEqual(['#00ff00']);
    expect(cssFonts('/* note */ h1{font-family:Inter} /* x').display).toBe('Inter');
  });

  it('parses hostile 2 MB input in linear time', () => {
    const inputs = [
      'a'.repeat(2_000_000),
      '{'.repeat(2_000_000),
      ':'.repeat(2_000_000),
      'rgb('.repeat(400_000),
      'color:' + ' '.repeat(2_000_000),
      'x{font-family' + ' '.repeat(2_000_000),
      '/*'.repeat(1_000_000),
      '"/*'.repeat(600_000),
      '"' + String.raw`\\`.repeat(1_000_000),
      'x{font-family:' + 'var(--a,'.repeat(250_000),
      ':root{' + '--a:var(--b);--b:var(--a);'.repeat(80_000) + '}body{font-family:var(--a)}',
      'x{font-family:var(--a)}'.repeat(80_000) + ':root{--a:' + 'var(--a, '.repeat(100) + '}',
    ];

    // Best of three and a 3 s ceiling: quadratic parsing takes minutes here, a loaded host only adds noise.
    for (const input of inputs) {
      const runs = [0, 1, 2].map(() => {
        const start = performance.now();

        cssColors(input);
        cssFonts(input);

        return performance.now() - start;
      });

      expect(Math.min(...runs)).toBeLessThan(3000);
    }
  }, 60_000);
});

describe('withThemeColor', () => {
  // A site whose CSS uses white 200 times declares white as its theme-color too (a light marketing page).
  const site = [
    { hex: '#000000', weight: 300, source: 'declaration' as const },
    { hex: '#ffffff', weight: 200, source: 'declaration' as const },
    { hex: '#ff385c', weight: 100, source: 'custom-property' as const },
  ];

  it('adds the theme-color to the weight the CSS already gives that colour', () => {
    const colors = withThemeColor(site, '#ffffff');
    const white = colors.find((c) => c.hex === '#ffffff');

    expect(white?.source).toBe('theme-color');
    expect(white?.weight).toBeGreaterThan(200);
    expect(colors.map((c) => c.hex)).toEqual(['#000000', '#ffffff', '#ff385c']);
  });

  it('weighs a theme-color the CSS never uses as a share of the palette, not a fixed few points', () => {
    const colors = withThemeColor(site, '#5e6ad2');
    const total = colors.reduce((sum, c) => sum + c.weight, 0);
    const declared = colors.find((c) => c.hex === '#5e6ad2');

    expect(declared?.source).toBe('theme-color');
    expect((declared?.weight ?? 0) / total).toBeGreaterThanOrEqual(0.04);
  });

  it('keeps a small fixed weight on a tiny palette and leaves the colours alone without a theme-color', () => {
    expect(withThemeColor([], '#3ce6ac')).toEqual([{ hex: '#3ce6ac', weight: 6, source: 'theme-color' }]);
    expect(withThemeColor(site, null)).toEqual(site);
  });
});

describe('cssFonts through custom properties', () => {
  it('follows var() chains, with their fallbacks, to the family a token names', () => {
    const fonts = cssFonts(`
      :root { --font-acme-sans: "Acme Sans", "Acme Sans Fallback", system-ui; --font-sans: var(--font-acme-sans); }
      html { font-family: var(--default-font-family, var(--font-sans, ui-sans-serif)); }
      :root { --default-font-family: var(--font-sans); }
      .heading { font-family: var(--missing, "Acme Display", serif); }
      code { font-family: var(--font-code, ui-monospace); }
    `);

    expect(fonts.body).toBe('Acme Sans');
    expect(fonts.display).toBe('Acme Display');
    expect(fonts.mono).toBeNull();
  });

  it('reads roles from utility classes and from family tokens named for the role', () => {
    const fonts = cssFonts(`
      @font-face { font-family: "Acme Title"; src: url(/t.woff2); }
      :root {
        --ds-font-size-title: 2.5rem;
        --ds-title-font-stack: "Acme Title", sans-serif;
        --ds-bodyMono-font-stack: "Acme Mono", monospace;
        --ds-body-font-stack: "Acme Text", sans-serif;
      }
      body { font-family: var(--ds-body-font-stack); }
      .font-display { font-family: "Acme Poster"; }
    `);

    expect(fonts).toEqual({
      display: 'Acme Poster',
      body: 'Acme Text',
      mono: 'Acme Mono',
      families: ['Acme Title', 'Acme Text', 'Acme Poster', 'Acme Mono'],
    });
  });

  it('never takes a fallback face, a size or a system stack for a family', () => {
    const fonts = cssFonts(`
      :root { --font-size-heading: 3rem; --font-sans: -apple-system, "Segoe UI", sans-serif; }
      @font-face { font-family: "Acme Fallback"; src: local(Arial); }
      body { font-family: var(--font-sans); }
    `);

    expect(fonts).toEqual({ display: null, body: null, mono: null, families: [] });
  });

  it('tries every definition of a token, not only the first (a reset stack, then the site’s own face)', () => {
    const fonts = cssFonts(`
      :root { --font-mono: ui-monospace, Menlo, monospace; }
      code, pre { font-family: var(--font-mono); }
      .theme { --font-mono: var(--acme-2); }
      .fonts { --acme-2: "Acme Mono", ui-monospace; }
    `);

    expect(fonts.mono).toBe('Acme Mono');
  });

  it('resolves self-referencing and deeply chained variables in bounded time', () => {
    const chain = Array.from({ length: 50 }, (_, i) => `--f${i}: var(--f${i + 1});`).join('');

    expect(
      cssFonts(
        `:root{--loop: var(--loop); ${chain} --f50: Acme} body{font-family:var(--loop)} h1{font-family:var(--f0)}`
      )
    ).toMatchObject({
      body: null,
    });
  });
});

describe('brand css strings and hues', () => {
  it('keeps reading after a comment opener inside a quoted string', () => {
    const css = `.a{background:url("/img/*.png")} .b{color:#3ce6ac} h1{font-family:"Acme */ Display"} /* c */ .c{color:#ff0000}`;

    expect(cssColors(css).map((c) => c.hex)).toEqual(['#3ce6ac', '#ff0000']);
    expect(cssFonts(css).display).toBe('Acme */ Display');
  });

  it('wraps negative and large hsl hues', () => {
    expect(normalizeColor('hsl(-120 100% 50%)')).toBe(normalizeColor('hsl(240 100% 50%)'));
    expect(normalizeColor('hsl(-30deg, 100%, 50%)')).toBe(normalizeColor('hsl(330, 100%, 50%)'));
    expect(normalizeColor('hsl(480 100% 50%)')).toBe(normalizeColor('hsl(120 100% 50%)'));
  });
});

describe('brand-named custom properties', () => {
  it('weighs brand, primary and theme tokens, not properties that merely contain the word', () => {
    const colors = cssColors(`
      :root { --color-brand-500: #5e6ad2; --colorPrimary: #533afd; --theme: #3ce6ac; }
      .badge-amber { --themed-bg: #f59e0b; }
      .footer { --domain-tint: #bd5200; }
    `);

    expect(Object.fromEntries(colors.map((c) => [c.hex, c.weight]))).toEqual({
      '#5e6ad2': 5,
      '#533afd': 5,
      '#3ce6ac': 5,
      '#f59e0b': 2,
      '#bd5200': 2,
    });
  });
});

describe('brand-named custom properties in any case', () => {
  it('weighs whole brand words written in capitals as brand tokens', () => {
    const colors = cssColors(':root { --Brand-500: #5e6ad2; --PRIMARY: #533afd; --THEMED-BG: #f59e0b; }');

    expect(Object.fromEntries(colors.map((c) => [c.hex, c.weight]))).toEqual({
      '#5e6ad2': 5,
      '#533afd': 5,
      '#f59e0b': 2,
    });
  });
});

describe('cssFonts and emoji faces', () => {
  it('never takes an emoji or symbol face for a family', () => {
    expect(
      cssFonts(`
        @font-face { font-family: "Apple Color Emoji"; src: local("Apple Color Emoji"); }
        body { font-family: "Noto Color Emoji", "Acme Sans", sans-serif; }
        .icons { font-family: "Segoe UI Symbol"; }
      `)
    ).toEqual({ display: null, body: null, mono: null, families: [] });
  });
});
