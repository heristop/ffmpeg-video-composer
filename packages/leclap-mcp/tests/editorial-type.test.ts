import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TemplateValidator } from 'ffmpeg-video-composer';
import { loadCustomEffectCatalog } from '../src/effects/custom-effect-catalog.js';
import { getEffectDefinition } from '../src/effects/effect-catalog.js';
import {
  editorialDefaults,
  fitEditorialFontSize,
  editorialTiming,
  editorialWords,
} from '../../../examples/llm-remotion-title/remotion/editorial-timing';

const example = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../examples/llm-remotion-title');
const definition = () =>
  getEffectDefinition(
    'studio.editorial-type',
    '1.0.0',
    loadCustomEffectCatalog(path.join(example, 'effect-catalog.json'))
  );

describe('registered editorial typography', () => {
  it('discovers the real catalog contract and materializes the component defaults', () => {
    const effect = definition();
    expect(effect.compositionId).toBe('LeclapEditorialType');
    expect(effect.output).toMatchObject({ width: 1280, height: 720, fps: 30, durationInFrames: 300 });
    expect(effect.props.parse({})).toEqual(editorialDefaults);
    expect(effect.assets.parse({})).toEqual({});
    expect(effect.assets.safeParse({ font: 'font.ttf' }).success).toBe(false);
  });

  it.each(['masked-rise', 'word-stagger', 'highlight'] as const)('accepts controls for %s', (mode) => {
    expect(
      definition().props.parse({
        headline: 'W'.repeat(80),
        kicker: 'K'.repeat(32),
        mode,
        accent: 'orange',
        entranceDurationFrames: 40,
        staggerFrames: 8,
        travelPx: 100,
        highlightWord: 15,
      })
    ).toMatchObject({ mode, travelPx: 100 });
    expect(
      definition().props.parse({ mode, entranceDurationFrames: 8, staggerFrames: 0, travelPx: 0, highlightWord: 0 })
    ).toMatchObject({ mode, travelPx: 0 });
  });

  it.each([
    { headline: '' },
    { headline: 'x'.repeat(81) },
    { headline: 10 },
    { kicker: 'x'.repeat(33) },
    { mode: 'typewriter' },
    { accent: 'coral' },
    { entranceDurationFrames: 7 },
    { entranceDurationFrames: 41 },
    { entranceDurationFrames: 8.5 },
    { staggerFrames: -1 },
    { staggerFrames: 9 },
    { staggerFrames: 1.5 },
    { travelPx: -1 },
    { travelPx: 101 },
    { travelPx: '56' },
    { highlightWord: -1 },
    { highlightWord: 16 },
    { highlightWord: 0.5 },
    { arbitraryCode: 'alert(1)' },
  ])('rejects invalid controls %j', (props) => {
    expect(definition().props.safeParse(props).success).toBe(false);
  });

  it('provides portable authoring JSON with the registered fixed composition', async () => {
    const template = JSON.parse(await fs.readFile(path.join(example, 'editorial-template.json'), 'utf8'));
    expect(new TemplateValidator().validateTemplate(template).success).toBe(true);
    expect(template.global.orientation).toBe('landscape');
    expect(template.sections[0].options.duration).toBe(10);
    expect(definition().props.parse(template.sections[0].effect.props)).toEqual(template.sections[0].effect.props);
    const root = await fs.readFile(path.join(example, 'remotion/Root.tsx'), 'utf8');
    expect(root).toContain('id="LeclapEditorialType"');
  });
});

describe('deterministic editorial frame timing', () => {
  it.each(['blur-rise', 'split-slide', 'elastic-stagger'] as const)('discovers and settles the %s mode', (mode) => {
    expect(definition().props.parse({ mode })).toMatchObject({ mode });
    const props = { ...editorialDefaults, mode, entranceDurationFrames: 40, staggerFrames: 8, travelPx: 100 };
    for (let index = 0; index < 16; index++) {
      expect(editorialTiming(160, index, props)).toMatchObject({
        opacity: 1,
        translateX: 0,
        translateY: 0,
        blurPx: 0,
        scale: 1,
      });
    }
  });

  it('separates blur, opposing travel and elastic overshoot without altering the final layout', () => {
    expect(editorialTiming(0, 0, { ...editorialDefaults, mode: 'blur-rise' })).toMatchObject({ blurPx: 8 });
    const split = { ...editorialDefaults, mode: 'split-slide' as const };
    expect(editorialTiming(0, 0, split).translateX).toBe(-56);
    expect(editorialTiming(0, 1, split).translateX).toBe(56);
    const elastic = { ...editorialDefaults, mode: 'elastic-stagger' as const, entranceDurationFrames: 20 };
    const beat = editorialTiming(10, 0, elastic);
    expect(beat.translateY).toBeLessThan(0);
    expect(beat.scale).toBeGreaterThan(1);
    expect(beat.opacity).toBe(1);
  });

  it('preserves copy while coalescing excess words into at most sixteen animation items', () => {
    expect(editorialWords('  Make   your next story  ')).toEqual(['Make', 'your', 'next', 'story']);
    const words = Array.from({ length: 25 }, (_, index) => `w${index}`);
    const result = editorialWords(words.join(' '));
    expect(result).toHaveLength(16);
    expect(result.slice(0, 15)).toEqual(words.slice(0, 15));
    expect(result[15]).toBe(words.slice(15).join(' '));
    expect(editorialWords('W'.repeat(80))).toEqual(['W'.repeat(80)]);
  });

  it('starts hidden, eases at the actual midpoint, settles and holds without drift', () => {
    const props = {
      ...editorialDefaults,
      mode: 'word-stagger' as const,
      entranceDurationFrames: 20,
      staggerFrames: 3,
      travelPx: 56,
    };
    expect(editorialTiming(2, 1, props)).toMatchObject({ progress: 0, opacity: 0, translateY: 56, scale: 0.96 });
    expect(editorialTiming(13, 1, props)).toMatchObject({
      progress: 0.875,
      opacity: 0.875,
      translateY: 7,
      scale: 0.995,
    });
    expect(editorialTiming(23, 1, props)).toMatchObject({ progress: 1, opacity: 1, translateY: 0, scale: 1 });
    expect(editorialTiming(200, 1, props)).toEqual(editorialTiming(23, 1, props));
  });

  it.each(['masked-rise', 'word-stagger', 'highlight'] as const)(
    'settles all sixteen items by frame 160 in %s',
    (mode) => {
      const props = { ...editorialDefaults, mode, entranceDurationFrames: 40, staggerFrames: 8, travelPx: 100 };
      for (let index = 0; index < 16; index++) {
        expect(editorialTiming(160, index, props)).toMatchObject({
          progress: 1,
          opacity: 1,
          translateY: 0,
          scale: 1,
          highlightProgress: 1,
          sceneOpacity: 1,
        });
      }
      expect(editorialTiming(287, 15, props).sceneOpacity).toBe(1);
      expect(editorialTiming(293, 15, props).sceneOpacity).toBe(0.5);
      expect(editorialTiming(299, 15, props).sceneOpacity).toBe(0);
    }
  );

  it('keeps highlight geometry fixed throughout the accent sweep and honors zero travel', () => {
    const props = { ...editorialDefaults, mode: 'highlight' as const, entranceDurationFrames: 20 };
    expect(editorialTiming(30, 0, props)).toMatchObject({ translateY: 0, scale: 1, highlightProgress: 0.875 });
    expect(editorialTiming(5, 0, { ...editorialDefaults, travelPx: 0 }).translateY).toBe(0);
  });
});

describe('editorial copy fit', () => {
  it('fits atomic wide-word rows instead of estimating from total character count', () => {
    // Seven ten-glyph words: above half-width, each word occupies its own line.
    const measuredHeight = (fontSize: number) => {
      const wordWidth = 10 * fontSize * 0.98 + fontSize * 0.05;
      const wordsPerLine = Math.max(1, Math.floor(1088 / (wordWidth + fontSize * 0.28)));
      return Math.ceil(7 / wordsPerLine) * fontSize * 1.24;
    };
    expect(measuredHeight(67.2)).toBeGreaterThan(420);
    const fontSize = fitEditorialFontSize((size) => measuredHeight(size) <= 416);
    expect(fontSize).toBeGreaterThanOrEqual(32);
    expect(fontSize).toBeLessThan(67.2);
    expect(measuredHeight(fontSize)).toBeLessThanOrEqual(416);
  });

  it('keeps short copy large, respects horizontal overflow and fails if bounded copy cannot fit', () => {
    expect(fitEditorialFontSize(() => true)).toBe(104);
    const fontSize = fitEditorialFontSize((size) => size <= 47.25);
    expect(fontSize).toBeLessThanOrEqual(47.25);
    expect(fontSize).toBeGreaterThan(47.2);
    expect(() => fitEditorialFontSize(() => false)).toThrow(/fit/);
  });

  it('rejects invisible headlines at render preparation without expanding catalog schema support', () => {
    expect(() => editorialWords('  \n\t ')).toThrow(/non-whitespace/);
  });
});
