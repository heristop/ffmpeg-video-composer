import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { assertSafeArgToken, assertSafeColorToken } from '@/core/arg-guard';
import { ColorBackgroundSectionSchema, SectionSchema } from '@/schemas/section.schemas';
import SegmentBuilder from '@/editor/SegmentBuilder';
import type { Section } from '@/core/types';

describe('assertSafeArgToken', () => {
  it('returns normal single-token values unchanged', () => {
    expect(assertSafeArgToken('red', 'backgroundColor')).toBe('red');
    expect(assertSafeArgToken('#000000', 'backgroundColor')).toBe('#000000');
    expect(assertSafeArgToken('red@0.5', 'backgroundColor')).toBe('red@0.5');
    expect(assertSafeArgToken('white@0.0', 'backgroundColor')).toBe('white@0.0');
    expect(assertSafeArgToken('/tmp/assets/intro.mp4', 'source')).toBe('/tmp/assets/intro.mp4');
    expect(assertSafeArgToken('https://cdn.example.com/clip.mp4', 'source')).toBe('https://cdn.example.com/clip.mp4');
  });

  it('throws when the value contains a space (argv-injection)', () => {
    expect(() => assertSafeArgToken('red -map 0:a /tmp/evil.mp4', 'backgroundColor')).toThrow(/backgroundColor/);
  });

  it('throws on tab, newline, carriage return, form-feed and vertical-tab', () => {
    expect(() => assertSafeArgToken('a\tb', 'f')).toThrow();
    expect(() => assertSafeArgToken('a\nb', 'f')).toThrow();
    expect(() => assertSafeArgToken('a\rb', 'f')).toThrow();
    expect(() => assertSafeArgToken('a\fb', 'f')).toThrow();
    expect(() => assertSafeArgToken(`a${String.fromCodePoint(11)}b`, 'f')).toThrow();
  });

  it('throws on a NUL byte', () => {
    expect(() => assertSafeArgToken(`a${String.fromCodePoint(0)}b`, 'f')).toThrow();
  });
});

function makeManagers() {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  return {
    assetManager: { segment: undefined },
    variableManager: {},
    mapManager: { segment: undefined },
    filterManager: { segment: undefined },
    formattersManager: { segment: undefined, formatColor: vi.fn((c: string) => c) },
    logger,
    filesystemAdapter: {
      getSource: vi.fn(() => '/source/in.mp4'),
      getDestination: vi.fn(() => '/build/out.mp4'),
      setSegment: vi.fn(),
    },
  };
}

function makeBuilder() {
  const project = { config: { videoConfig: { scale: '1280:720', setsar: '1/1' } } };
  const template = { descriptor: {}, assets: { fonts: {}, musics: {}, inputs: [] } };
  const segment = {
    currentSection: undefined,
    filtersList: [],
    filtersMapList: [],
    mapsList: [],
    tempFonts: [],
    inputsAsset: {} as unknown,
    inputsMapCount: 0,
  };

  return new SegmentBuilder(project as never, template as never, segment as never, makeManagers() as never);
}

describe('SegmentBuilder argv-injection guard (builder level)', () => {
  it('throws when a resolved backgroundColor smuggles extra ffmpeg arguments', () => {
    const builder = makeBuilder();
    builder.hydrate({ name: 'bg', type: 'color_background' });
    // hasAssets must be true for the configured color (not the white@0.0 fallback) to reach the sink.
    (builder as unknown as { segment: { inputsAsset: unknown } }).segment.inputsAsset = {
      asset_logo: '/cache/logo.png',
    };
    (builder as unknown as { section: Section }).section = {
      name: 'bg',
      type: 'color_background',
      options: { backgroundColor: 'red -map 0:a /tmp/evil.mp4', duration: 3 },
    } as never;

    expect(() => builder.buildInputs()).toThrow(/backgroundColor/);
  });

  it('accepts a normal background color', () => {
    const builder = makeBuilder();
    builder.hydrate({ name: 'bg', type: 'color_background' });
    (builder as unknown as { section: Section }).section = {
      name: 'bg',
      type: 'color_background',
      options: { backgroundColor: 'red@0.5', duration: 3 },
    } as never;

    expect(() => builder.buildInputs()).not.toThrow();
  });
});

// backgroundColor lands unquoted in a `-f lavfi -i color=c=<colour>` input graph: whitespace is not the
// only escape, filtergraph syntax (`,` `;` `[` `]` `=` `:` `/`) is too.
const HOSTILE_COLORS = ['red,nullsink;movie=/x[out0]', 'red:s=2x2', 'black;amovie=/etc/passwd', "red'", 'rgb(1,2,3)'];

describe('assertSafeColorToken', () => {
  it('returns colours of the engine grammar unchanged', () => {
    for (const color of ['black', '#141416', '#000', 'red@0.5', '0x112233', 'white@0.0']) {
      expect(assertSafeColorToken(color, 'backgroundColor')).toBe(color);
    }
  });

  it('throws on filtergraph syntax', () => {
    for (const color of HOSTILE_COLORS) {
      expect(() => assertSafeColorToken(color, 'backgroundColor'), color).toThrow(/backgroundColor/);
    }
  });
});

describe('backgroundColor schema', () => {
  const section = (backgroundColor: string) => ({
    name: 'bg',
    type: 'color_background',
    options: { backgroundColor, duration: 3 },
  });

  it('rejects filtergraph syntax on every section type', () => {
    for (const color of HOSTILE_COLORS) {
      expect(ColorBackgroundSectionSchema.safeParse(section(color)).success, color).toBe(false);
      expect(SectionSchema.safeParse({ ...section(color), type: 'video' }).success, color).toBe(false);
    }
  });

  it('accepts names, hex, theme tokens and variables', () => {
    for (const color of ['black', '#141416', '$color.bg', '{{ color1 }}', '{{ ACCENT }}', 'red@0.5']) {
      expect(ColorBackgroundSectionSchema.safeParse(section(color)).success, color).toBe(true);
    }
  });
});

describe('SegmentBuilder filtergraph guard on backgroundColor', () => {
  it('throws when a resolved backgroundColor carries filtergraph syntax', () => {
    const builder = makeBuilder();
    builder.hydrate({ name: 'bg', type: 'color_background' });
    (builder as unknown as { section: Section }).section = {
      name: 'bg',
      type: 'color_background',
      options: { backgroundColor: 'red,nullsink;movie=/x[out0]', duration: 3 },
    } as never;

    expect(() => builder.buildInputs()).toThrow(/backgroundColor/);
  });
});
