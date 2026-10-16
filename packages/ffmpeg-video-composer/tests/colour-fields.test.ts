import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import FormatterManager from '@/editor/managers/FormatterManager';
import MapManager from '@/editor/managers/MapManager';
import { templateDescriptorJsonSchema } from '@/schemas/template.schemas';
import { ChromaKeySchema } from '@/schemas/text-media.schemas';
import { TitleCardSchema } from '@/schemas/text.schemas';

// Colour fields reach filtergraphs (`colorkey=<c>`, `drawbox=…color=<c>`, `fontcolor='<c>'`): every one is a
// single colour token in the schema, and the two lowering choke points refuse anything else, so a
// template that skipped the schema cannot chain filters or close a quote through a colour.

const HOSTILE = ["black':x='", '#00FF00,drawbox=t=fill', 'red;movie=/etc/passwd', 'red[x]', 'red\\', 'a b'];
const VALID = ['black', '#141416', '#000000@0.5', '$color.bg', '$color.accent@0.6', '{{ color1 }}', '{{ color1 }}@0.6'];

// Colour-named string fields that stay open: the raw drawtext/filter values (guarded at lowering by
// formatColorValue) and the synth noise colour (white/pink/brown, never in a filtergraph).
const OPEN = new Set(['fontcolor', 'boxcolor', 'shadowcolor', 'bordercolor']);
const OPEN_DESCRIPTIONS = [/^Alternate colour parameter/, /^noise/i];

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

  it('rejects filtergraph syntax in the chroma key and title card colours', () => {
    for (const color of HOSTILE) {
      expect(ChromaKeySchema.safeParse({ color }).success, color).toBe(false);
      expect(ChromaKeySchema.safeParse({ color: '#00FF00', background: color }).success, color).toBe(false);
      expect(TitleCardSchema.safeParse({ headline: { en: 'Hi' }, background: color }).success, color).toBe(false);
    }
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
