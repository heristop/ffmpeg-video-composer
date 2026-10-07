import { describe, expect, it } from 'vitest';
import { contrastRatio } from '@/core/color-contrast';
import { seededRandom } from '@/core/determinism/hash';
import { ThemeObjectSchema } from '@/schemas/theme.schemas';
import {
  analyzePacing,
  analyzeStyle,
  detectCuts,
  enforceContrast,
  estimateTexture,
  extractPalette,
  rgbToOklab,
  styleGuideMarkdown,
  styleGuidePromptRules,
  type StyleFrame,
} from '@/core/style';
import { hexToRgb, hue } from '@/core/style/oklab';

type Rgb = [number, number, number];

const W = 80;
const H = 60;

// A frame painted by a per-pixel function; deterministic, no randomness unless the painter seeds it.
function paint(fn: (x: number, y: number) => Rgb, time?: number, channels: 3 | 4 = 3): StyleFrame {
  const data = new Uint8Array(W * H * channels);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * channels;
      const [r, g, b] = fn(x, y);
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;

      if (channels === 4) data[o + 3] = 255;
    }
  }

  return { data, width: W, height: H, channels, ...(time === undefined ? {} : { time }) };
}

const NAVY: Rgb = [16, 24, 48];
const WHITE: Rgb = [240, 240, 236];
const ORANGE: Rgb = [250, 120, 20];
const TEAL: Rgb = [20, 180, 170];

// 80 % navy canvas, a white text band, an orange bar and a small teal dot.
function poster(x: number, y: number): Rgb {
  if (y >= 10 && y < 17) return WHITE;

  if (y >= 40 && y < 44 && x < 60) return ORANGE;

  if (x >= 70 && y >= 50) return TEAL;

  return NAVY;
}

function hueOf(hex: string): number {
  const { r, g, b } = hexToRgb(hex);

  return hue(rgbToOklab(r, g, b));
}

function ratio(a: string, b: string): number {
  return contrastRatio(hexToRgb(a), hexToRgb(b));
}

describe('extractPalette', () => {
  it('is deterministic for the same frames and seed', () => {
    const frame = paint(poster);

    expect(extractPalette([frame])).toEqual(extractPalette([frame]));
    expect(analyzeStyle({ frames: [frame] })).toEqual(analyzeStyle({ frames: [frame] }));
  });

  it('recovers each flat colour with its area share, largest first', () => {
    const palette = extractPalette([paint(poster)]);

    expect(palette).toHaveLength(4);
    expect(palette[0].hex).toBe('#101830');
    expect(palette[0].share).toBeGreaterThan(0.75);
    expect(palette.map((c) => c.hex)).toEqual(expect.arrayContaining(['#f0f0ec', '#fa7814', '#14b4aa']));
  });

  it('reads RGBA canvas frames the same as rgb24 frames', () => {
    expect(extractPalette([paint(poster, undefined, 4)])).toEqual(extractPalette([paint(poster)]));
  });
});

describe('analyzeStyle roles', () => {
  const analysis = analyzeStyle({ frames: [paint(poster)] });
  const roles = analysis.styleGuide.roles;

  it('assigns bg, fg, accent and accent2 from the reference', () => {
    expect(roles.bg).toMatchObject({ hex: '#101830', source: 'extracted' });
    expect(roles.fg).toMatchObject({ hex: '#f0f0ec', source: 'extracted' });
    expect(roles.accent.hex).toBe('#fa7814');
    expect(roles.accent2.hex).toBe('#14b4aa');
    expect(roles.brand.hex).toBe(roles.accent.hex);
  });

  it('derives surface from bg and keeps muted readable', () => {
    expect(roles.surface.source).toBe('derived');
    expect(ratio(roles.surface.hex, '#ffffff')).toBeLessThan(ratio('#101830', '#ffffff'));
    expect(ratio(roles.muted.hex, roles.bg.hex)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(roles.muted.hex, roles.bg.hex)).toBeLessThan(ratio(roles.fg.hex, roles.bg.hex));
  });

  it('emits a theme object the schema accepts, without motion for an image', () => {
    expect(ThemeObjectSchema.safeParse(analysis.theme).success).toBe(true);
    expect(analysis.theme.motion).toBeUndefined();
    expect(analysis.styleGuide.pacing).toBeNull();
    expect(analysis.styleGuide.palette.find((p) => p.hex === '#101830')?.roles).toEqual(['bg']);
  });

  it('reports contrast pairs and a confidence', () => {
    const fgBg = analysis.styleGuide.contrast.find((c) => c.pair === 'fg/bg');

    expect(fgBg?.aa).toBe(true);
    expect(analysis.confidence).toBeGreaterThan(0.8);
  });
});

describe('contrast enforcement', () => {
  it('moves a low-contrast fg until it meets WCAG AA', () => {
    const grey = paint((x, y) => (y < 8 ? [150, 150, 150] : [110, 110, 110]));
    const { roles } = analyzeStyle({ frames: [grey] }).styleGuide;

    expect(roles.fg.source).toBe('adjusted');
    expect(ratio(roles.fg.hex, roles.bg.hex)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(roles.accent.hex, roles.bg.hex)).toBeGreaterThanOrEqual(3);
  });

  it('leaves a colour that already passes untouched', () => {
    const lab = rgbToOklab(255, 255, 255);

    expect(enforceContrast(lab, { r: 0, g: 0, b: 0 }, 4.5)).toEqual({ hex: '#ffffff', adjusted: false });
  });

  it('keeps the hue while lightening a dark accent on a dark bg', () => {
    const result = enforceContrast(rgbToOklab(120, 20, 20), { r: 16, g: 16, b: 16 }, 3);

    expect(result.adjusted).toBe(true);
    expect(ratio(result.hex, '#101010')).toBeGreaterThanOrEqual(3);
    expect(Math.abs(hueOf(result.hex) - hueOf('#781414'))).toBeLessThan(15);
  });

  it('derives every role from a single flat colour', () => {
    const { roles } = analyzeStyle({ frames: [paint(() => [20, 20, 20])] }).styleGuide;

    expect(roles.fg.source).toBe('derived');
    expect(roles.accent.source).toBe('derived');
    expect(ratio(roles.fg.hex, roles.bg.hex)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('estimateTexture', () => {
  it('reads seeded noise as grain and a clean frame as none', () => {
    const random = seededRandom(7);
    const noisy = paint(() => {
      const n = Math.round((random() - 0.5) * 60);

      return [128 + n, 128 + n, 128 + n];
    });

    expect(estimateTexture([paint(poster)])).toEqual({ noise: 0, look: 'none' });
    expect(estimateTexture([noisy])).toMatchObject({ look: 'grain' });
    expect(estimateTexture([noisy]).grain).toBeGreaterThanOrEqual(0.1);
  });
});

describe('pacing', () => {
  const SHOTS: Rgb[] = [
    [200, 40, 40],
    [30, 30, 160],
    [240, 220, 60],
    [20, 120, 60],
  ];

  // 10 s at 4 fps: four shots of 2.5 s, each with a slowly drifting bar, so the steady diffs are small
  // but non-zero (motion) and the shot changes are big.
  function clip(): StyleFrame[] {
    return Array.from({ length: 40 }, (_, i) =>
      paint((x) => (Math.abs(x - (i % 10) * 3) < 4 ? [255, 255, 255] : SHOTS[Math.floor(i / 10)]), i * 0.25)
    );
  }

  it('finds the known cuts and the average shot length', () => {
    const { pacing, energy } = analyzePacing(clip(), 10);

    expect(pacing.cuts).toBe(3);
    expect(pacing.cutTimes).toEqual([2.5, 5, 7.5]);
    expect(pacing.avgShot).toBe(2.5);
    expect(pacing.cutsPerMinute).toBe(18);
    expect(energy).toBeGreaterThan(0);
  });

  it('does not count a steady pan as cuts (neighbourhood ratio test)', () => {
    const pan = Array.from({ length: 24 }, (_, i) =>
      paint((x) => {
        const v = ((x + i * 6) * 7) % 256;

        return [v, v, v];
      }, i * 0.25)
    );

    expect(analyzePacing(pan).pacing.cuts).toBe(0);
    expect(analyzePacing(pan).energy).toBeGreaterThan(0.5);
  });

  it('collapses adjacent detections to one cut', () => {
    expect(detectCuts([0.01, 0.01, 0.5, 0.4, 0.01, 0.01])).toEqual([2]);
  });

  it('maps a clip to theme motion and a doctrine genre', () => {
    const analysis = analyzeStyle({ frames: clip(), duration: 10 });

    expect(analysis.theme.motion).toMatchObject({ beat: 0.5 });
    expect(analysis.theme.motion?.energy).toBeGreaterThan(0.5);
    expect(analysis.styleGuide.genre).toBe('product-launch');
    expect(ThemeObjectSchema.safeParse(analysis.theme).success).toBe(true);
  });

  it('reads the palette from paletteFrames and the pacing from frames', () => {
    const analysis = analyzeStyle({ frames: clip(), duration: 10, paletteFrames: [paint(poster)] });

    expect(analysis.styleGuide.roles.bg.hex).toBe('#101830');
    expect(analysis.styleGuide.pacing?.cuts).toBe(3);
  });

  it('reads a still clip as a calm tutorial', () => {
    const still = Array.from({ length: 40 }, (_, i) => paint(() => [235, 240, 235], i * 0.25));

    expect(analyzeStyle({ frames: still, duration: 10 }).styleGuide.genre).toBe('calm-tutorial');
  });
});

describe('style guide text', () => {
  const analysis = analyzeStyle({ frames: [paint(poster)] });

  it('renders markdown with the scope note, the palette and the theme JSON', () => {
    const md = styleGuideMarkdown(analysis, 'Poster');

    expect(md).toContain('# Poster');
    expect(md).toContain('never copied');
    expect(md).toContain('`#101830`');
    expect(md).toContain('"theme"');
  });

  it('renders binding prompt rules', () => {
    const rules = styleGuidePromptRules(analysis);

    expect(rules).toContain('Set global.theme to exactly');
    expect(rules).toContain('Avoid:');
  });
});
