// @vitest-environment node
// "Match a reference": the browser analyzer path on synthetic RGBA frames (the same pure engine code
// the CLI and MCP run), the panel's pure helpers, and the static markup of the swatch preview.
import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';
import { analyzeStyle, styleGuidePromptRules } from 'ffmpeg-video-composer/src/core/style/index.ts';
import type { StyleFrame } from 'ffmpeg-video-composer/src/core/style/types.ts';
import { ThemeObjectSchema } from 'ffmpeg-video-composer/src/schemas/theme.schemas.ts';
import admin from '@/i18n/locales/en/admin.json';
import ai from '@/i18n/locales/en/ai.json';
import { analyzerInput } from '@/infrastructure/style/analyze-reference';
import { analysisSize, MAX_REFERENCE_FRAMES, referenceSampleTimes } from '@/infrastructure/style/reference-frames';
import { ReferenceStyleSection } from '../ai-generate/ReferenceStyleSection';
import { ReferenceStylePanel } from './ReferenceStylePanel';
import { StyleSwatches } from './StyleSwatches';
import { contrastLevel, swatchesOf, withReferenceTheme } from './reference-style.logic';

beforeAll(async () => {
  await i18n.init({
    lng: 'en',
    fallbackLng: 'en',
    ns: ['admin', 'ai'],
    defaultNS: 'admin',
    resources: { en: { admin, ai } },
  });
});

const noop = () => {};

function render(node: React.ReactNode): string {
  return renderToStaticMarkup(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>);
}

function pixel(x: number, y: number, shift: number): number[] {
  if (y >= 6 && y < 10) return [28, 24, 20];

  if (y >= 26 && y < 29 && x >= shift && x < shift + 30) return [0, 150, 140];

  return [244, 236, 220];
}

// An RGBA canvas frame: a warm cream canvas, a dark text band and a teal bar.
function canvasFrame(shift = 0, time?: number): StyleFrame {
  const width = 64;
  const height = 36;
  const data = new Uint8ClampedArray(width * height * 4);

  for (let p = 0; p < width * height; p++) {
    const y = Math.floor(p / width);
    const x = p % width;
    data.set([...pixel(x, y, shift), 255], p * 4);
  }

  return { data, width, height, channels: 4, ...(time === undefined ? {} : { time }) };
}

describe('reference sampling', () => {
  it('samples every 0.25 s, evenly beyond the frame budget, deterministically', () => {
    expect(referenceSampleTimes(2)).toEqual([0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75]);
    expect(referenceSampleTimes(60)).toHaveLength(MAX_REFERENCE_FRAMES);
    expect(referenceSampleTimes(60).at(1)).toBe(0.5);
    expect(referenceSampleTimes(Number.NaN)).toEqual([0]);
  });

  it('scales to the 160 px analysis width with an even height', () => {
    expect(analysisSize(1920, 1080)).toEqual({ width: 160, height: 90 });
    expect(analysisSize(1080, 1920)).toEqual({ width: 160, height: 284 });
  });

  it('reads the palette from the still and the pacing from the clip', () => {
    const still = canvasFrame();
    const clip = { frames: [canvasFrame(0, 0), canvasFrame(4, 0.25)], duration: 0.5 };

    expect(analyzerInput(still, null)).toEqual({ frames: [still] });
    expect(analyzerInput(still, clip)).toEqual({ frames: clip.frames, duration: 0.5, paletteFrames: [still] });
    expect(() => analyzerInput(null, null)).toThrow(/reference/);
  });
});

describe('browser analyzer', () => {
  const analysis = analyzeStyle({ frames: [canvasFrame()] });

  it('derives a light theme with readable text from canvas pixels', () => {
    const { roles, contrast } = analysis.styleGuide;

    expect(roles.bg.hex).toBe('#f4ecdc');
    expect(roles.fg.hex).toBe('#1c1814');
    expect(contrast.find((c) => c.pair === 'fg/bg')?.aa).toBe(true);
    expect(ThemeObjectSchema.safeParse(analysis.theme).success).toBe(true);
    expect(analyzeStyle({ frames: [canvasFrame()] })).toEqual(analysis);
  });

  it('builds swatches in token order with contrast levels', () => {
    const swatches = swatchesOf(analysis);

    expect(swatches.map((s) => s.role)).toEqual(['bg', 'fg', 'muted', 'surface', 'brand', 'accent', 'accent2']);
    expect(swatches[0].contrast).toBeUndefined();
    expect(swatches[1].contrast?.level).toBe('aa');
    expect(contrastLevel(false, true)).toBe('aaLarge');
    expect(contrastLevel(false, false)).toBe('fail');
  });

  it('applies the theme as global.theme object form, keeping seed and tokens', () => {
    const motion = withReferenceTheme({ seed: 7, theme: 'bold' }, analysis);

    expect(motion.seed).toBe(7);
    expect(motion.theme).toEqual(analysis.theme);
    expect(motion.theme).not.toBe(analysis.theme);
  });

  it('turns the analysis into binding prompt rules', () => {
    expect(styleGuidePromptRules(analysis)).toContain('"bg":"#f4ecdc"');
  });
});

describe('reference markup', () => {
  it('previews each swatch with an accessible contrast badge', () => {
    const html = render(<StyleSwatches analysis={analyzeStyle({ frames: [canvasFrame()] })} />);

    expect(html).toContain('aria-label="Derived theme colours"');
    expect(html).toContain('#f4ecdc');
    expect(html).toMatch(/aria-label="Contrast on background [\d.]+ to 1, passes WCAG AA"/);
  });

  it('starts with labelled pickers, the scope note and a disabled analyse button', () => {
    const html = render(<ReferenceStylePanel applyLabel="Apply" onApply={noop} />);

    expect(html).toContain(admin.styleReference.hint);
    expect(html).toContain(admin.styleReference.image);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Analyse reference/);
  });

  it('shows the attached style guide state in the AI dialog', () => {
    const html = render(<ReferenceStyleSection attached onAttach={noop} onDetach={noop} disabled={false} />);

    expect(html).toContain(ai.reference.attached);
    expect(html).toContain(ai.reference.detach);
  });
});
