import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import FormatterManager from '@/editor/managers/FormatterManager';
import MapManager from '@/editor/managers/MapManager';
import { templateDescriptorJsonSchema } from '@/schemas/template.schemas';
import { ChromaKeySchema } from '@/schemas/text-media.schemas';
import { SubtitlesSchema } from '@/schemas/subtitles.schemas';
import { TitleCardSchema } from '@/schemas/text.schemas';
import { BackgroundLayerSchema } from '@/schemas/effects-visual.schemas';
import { buildGradientSource } from '@/editor/utils/input-sources';

// Colour fields reach filtergraphs (`colorkey=<c>`, `drawbox=…color=<c>`, `fontcolor='<c>'`): every one is a
// single colour token in the schema, and the two lowering choke points refuse anything else, so a
// template that skipped the schema cannot chain filters or close a quote through a colour.

const HOSTILE = ["black':x='", '#00FF00,drawbox=t=fill', 'red;movie=/etc/passwd', 'red[x]', 'red\\', 'a b'];
const VALID = ['black', '#141416', '#000000@0.5', '$color.bg', '$color.accent@0.6', '{{ color1 }}', '{{ color1 }}@0.6'];

// Colour-named string fields that stay open: the raw drawtext/filter values (guarded at lowering by
// formatColorValue) and the synth noise colour (white/pink/brown, never in a filtergraph).
const OPEN = new Set(['fontcolor', 'boxcolor', 'shadowcolor', 'bordercolor']);
const OPEN_DESCRIPTIONS = [/^Alternate colour parameter/, /^noise/i];

// Fields whose description mentions colour without being one (enums, free text, CSS), plus the raw
// filter colour values and colorsList (which takes rgb() the formatter converts).
const NOT_COLOUR_TOKENS = new Set(['c', 'colorsList', 'contrast', 'crown', 'css', 'emoji', 'type']);

// Every string (or string-list) property whose DESCRIPTION speaks of a colour, whatever its key: a
// gradient's `from`/`to` or a progress `track` reach filtergraphs as much as a `color` does.
function describedColourFields(): string[] {
  const missing: string[] = [];

  (function walk(node: unknown, at: string): void {
    if (Array.isArray(node)) {
      for (const [i, child] of node.entries()) walk(child, `${at}[${i}]`);

      return;
    }

    if (!node || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    const properties = record.properties as Record<string, Record<string, unknown>> | undefined;

    for (const [key, schema] of Object.entries(properties ?? {})) {
      const description = typeof schema.description === 'string' ? schema.description : '';
      const items = (schema.items ?? {}) as Record<string, unknown>;
      const bare =
        (schema.type === 'string' && !schema.pattern) ||
        (schema.type === 'array' && items.type === 'string' && !items.pattern);
      const open = OPEN.has(key) || NOT_COLOUR_TOKENS.has(key) || OPEN_DESCRIPTIONS.some((re) => re.test(description));

      if (/colou?r/i.test(description) && bare && !open) missing.push(`${at}.${key}`);
    }

    for (const [key, child] of Object.entries(record)) walk(child, `${at}.${key}`);
  })(templateDescriptorJsonSchema, '');

  return missing;
}

function colourStringFields(): string[] {
  const missing: string[] = [];

  (function walk(node: unknown, at: string): void {
    if (Array.isArray(node)) {
      for (const [i, child] of node.entries()) walk(child, `${at}[${i}]`);

      return;
    }

    if (!node || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    const properties = record.properties as Record<string, Record<string, unknown>> | undefined;

    for (const [key, schema] of Object.entries(properties ?? {})) {
      const colourKey = /(colou?r|^background|^accent)$/i.test(key);
      const description = typeof schema.description === 'string' ? schema.description : '';
      const open = OPEN.has(key) || OPEN_DESCRIPTIONS.some((re) => re.test(description));

      if (colourKey && !open && schema.type === 'string' && !schema.pattern) missing.push(`${at}.${key}`);
    }

    for (const [key, child] of Object.entries(record)) walk(child, `${at}.${key}`);
  })(templateDescriptorJsonSchema, '');

  return missing;
}

describe('colour fields: schema', () => {
  it('constrains every colour string that reaches a filtergraph', () => {
    expect(colourStringFields()).toEqual([]);
  });

  it('constrains colour fields named otherwise (gradient stops, tracks, markers, palettes)', () => {
    expect(describedColourFields()).toEqual([]);
  });

  it('rejects filtergraph syntax in the chroma key and title card colours', () => {
    for (const color of HOSTILE) {
      expect(ChromaKeySchema.safeParse({ color }).success, color).toBe(false);
      expect(ChromaKeySchema.safeParse({ color: '#00FF00', background: color }).success, color).toBe(false);
      expect(TitleCardSchema.safeParse({ headline: { en: 'Hi' }, background: color }).success, color).toBe(false);
    }
  });

  it('rejects filtergraph and CSS syntax in the subtitle colours of either renderer', () => {
    const cues = [{ text: 'Hi', at: 0, end: 1 }];

    for (const color of [...HOSTILE, 'red;background-image:url(http://x/y.png)']) {
      for (const renderer of ['drawbox', 'html']) {
        expect(SubtitlesSchema.safeParse({ cues, renderer, color }).success, color).toBe(false);
        expect(SubtitlesSchema.safeParse({ cues, renderer, activeColor: color }).success, color).toBe(false);
      }
    }

    expect(
      SubtitlesSchema.safeParse({ cues, renderer: 'html', color: '#fff', activeColor: '$color.accent' }).success
    ).toBe(true);
  });

  it('keeps hex, names, @alpha, theme tokens and colour variables', () => {
    for (const color of VALID) {
      expect(ChromaKeySchema.safeParse({ color, background: color }).success, color).toBe(true);
      expect(TitleCardSchema.safeParse({ headline: { en: 'Hi' }, background: color }).success, color).toBe(true);
    }
  });
});

function formatter(): FormatterManager {
  const template = { descriptor: {}, assets: { fonts: {}, musics: {}, inputs: {} } };
  const project = { config: { currentLocale: 'en', videoConfig: {} } };
  const vm = { mapVariables: vi.fn((value: string) => value) };
  const segment = { currentSection: { name: 's', type: 'video', options: {} } };
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  return new FormatterManager(project as never, template as never, vm as never, segment as never, logger as never);
}

describe('gradient background layers', () => {
  it('rejects filtergraph syntax in the gradient stops', () => {
    for (const color of HOSTILE) {
      expect(BackgroundLayerSchema.safeParse({ gradient: { from: color, to: '#000000' } }).success, color).toBe(false);
      expect(BackgroundLayerSchema.safeParse({ gradient: { from: '#000000', to: color } }).success, color).toBe(false);
    }

    expect(BackgroundLayerSchema.safeParse({ gradient: { from: '$color.bg', to: '#7C83FD@0.5' } }).success).toBe(true);
  });

  it('refuses a gradient stop that is not a colour token at lowering', () => {
    for (const color of HOSTILE.filter((value) => !/\s/.test(value))) {
      expect(() => buildGradientSource({ gradient: { from: color, to: '#000000' } }, '1280:720', 4), color).toThrow(
        /gradient from/
      );
      expect(() => buildGradientSource({ gradient: { from: '#000000', to: color } }, '1280:720', 4), color).toThrow(
        /gradient to/
      );
    }
  });
});

describe('colour fields: lowering choke points', () => {
  it('refuses a drawtext/drawbox colour value that is not a colour token', () => {
    for (const color of HOSTILE) {
      expect(
        () => formatter().formatMultipleTypesValues({ type: 'drawbox', values: { color } } as never),
        color
      ).toThrow(/color/);
      expect(() =>
        formatter().formatMultipleTypesValues({ type: 'drawtext', values: { fontcolor: color } } as never)
      ).toThrow(/fontcolor/);
    }
  });

  it('keeps colour tokens', () => {
    expect(formatter().formatMultipleTypesValues({ type: 'drawbox', values: { color: '#000000@0.5' } } as never)).toBe(
      "drawbox=color='#000000@0.5'"
    );
  });

  it('refuses a chroma key colour or background that is not a colour token', () => {
    for (const color of HOSTILE) {
      const segment = { currentSection: { name: 's', type: 'video', options: {} }, mapsList: [], filtersMapList: [] };
      const manager = new MapManager({ formatColor: (c: string) => c } as never, {} as never, segment as never);

      expect(() => manager.addChromakeyComposite({ color }, 0), color).toThrow(/chromaKey/);
      expect(() => manager.addChromakeyComposite({ color: '#00FF00', background: color }, 0), color).toThrow(
        /chromaKey/
      );
    }
  });
});
