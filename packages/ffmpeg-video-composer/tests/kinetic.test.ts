import { describe, expect, it } from 'vitest';
import { layoutKinetic, measureBundled, wrapLines } from '@/core/kinetic/layout';
import { staggerRanks } from '@/core/kinetic/resolve';
import { kineticToFilters, MAX_KINETIC_UNITS } from '@/editor/presets/kinetic';
import { motionCatalog } from '@/core/motion/catalog';
import { KINETIC_PRESETS, KineticBlockSchema, type KineticBlock } from '@/schemas/kinetic.schemas';
import { TemplateValidator } from '@/services/TemplateValidator';
import { evaluateExpr } from '@/services/geometry/drawtext-expr';
import { buildFontAdvances } from '../scripts/generate-font-advances';
import { FONT_ADVANCES } from '@/core/font-advances.generated';
import type { Filter } from '@/core/types';

const FRAME = { width: 1280, height: 720, fps: 30, duration: 3, seed: 7, energy: 1 };

function block(overrides: Partial<KineticBlock> & Pick<KineticBlock, 'preset'>): KineticBlock {
  return KineticBlockSchema.parse({ text: { en: 'Make every word land' }, ...overrides });
}

function filters(b: KineticBlock, text = 'Make every word land', frame = FRAME): Filter[] {
  return kineticToFilters(b, { ...frame, text });
}

function texts(list: Filter[]): Array<Record<string, unknown>> {
  return list.filter((f) => f.type === 'drawtext').map((f) => f.values as Record<string, unknown>);
}

describe('bundled font advances', () => {
  it('is generated from the bundled fonts (run pnpm generate:font-advances after changing a font)', () => {
    expect(FONT_ADVANCES).toEqual(buildFontAdvances());
  });

  it('measures like the font: a word is the sum of its glyphs, unknown fonts and glyphs are null', () => {
    const word = measureBundled('BebasNeue.ttf', 'LAND', 100) as number;
    const glyphs = ['L', 'A', 'N', 'D'].reduce(
      (sum, g) => sum + (measureBundled('BebasNeue.ttf', g, 100) as number),
      0
    );

    expect(word).toBeGreaterThan(100);
    expect(word).toBeCloseTo(glyphs, 6);
    expect(measureBundled('Nope.ttf', 'A', 100)).toBeNull();
    expect(measureBundled('BebasNeue.ttf', '漢', 100)).toBeNull();
  });
});

describe('kinetic layout', () => {
  it('wraps to the width and centres each line', () => {
    const lines = wrapLines('Same JSON. Same frames. Everywhere, every time.', 'BebasNeue.ttf', 120, 700) as string[];

    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(measureBundled('BebasNeue.ttf', line, 120)).toBeLessThanOrEqual(700);

    const layout = layoutKinetic({
      text: 'Same frames',
      font: 'BebasNeue.ttf',
      size: 100,
      unit: 'word',
      align: 'center',
      x: 640,
      y: 0,
      maxWidth: 1000,
      lineHeight: 105,
    });
    const line = layout?.lines[0];

    expect((line?.x ?? 0) + (line?.width ?? 0) / 2).toBeCloseTo(640, 6);
    expect(layout?.pieces.map((p) => p.text)).toEqual(['Same', 'frames']);
  });

  it('places glyphs at their prefix advance and keeps word indices', () => {
    const layout = layoutKinetic({
      text: 'AB CD',
      font: 'BebasNeue.ttf',
      size: 100,
      unit: 'glyph',
      align: 'left',
      x: 0,
      y: 0,
      maxWidth: 2000,
      lineHeight: 100,
    });

    expect(layout?.pieces.map((p) => [p.text, p.word])).toEqual([
      ['A', 0],
      ['B', 0],
      ['C', 1],
      ['D', 1],
    ]);
    expect(layout?.pieces[1].x).toBeCloseTo(measureBundled('BebasNeue.ttf', 'A', 100) as number, 6);
    expect(layout?.pieces[2].x).toBeCloseTo(measureBundled('BebasNeue.ttf', 'AB ', 100) as number, 6);
  });
});

describe('stagger order', () => {
  const pieces = Array.from({ length: 5 }, (_, i) => ({ text: `${i}`, x: i, y: 0, width: 1, line: 0, word: i }));

  it('orders forward, reverse, from the centre and from the edges', () => {
    expect(staggerRanks(pieces, 'forward', 1)).toEqual([0, 1, 2, 3, 4]);
    expect(staggerRanks(pieces, 'reverse', 1)).toEqual([4, 3, 2, 1, 0]);
    expect(staggerRanks(pieces, 'center', 1)).toEqual([2, 1, 0, 1, 2]);
    expect(staggerRanks(pieces, 'edges', 1)).toEqual([0, 1, 2, 1, 0]);
  });

  it('shuffles deterministically from the seed', () => {
    const a = staggerRanks(pieces, 'random', 42);

    expect(staggerRanks(pieces, 'random', 42)).toEqual(a);
    expect([...a].sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 4]);
    expect(staggerRanks(pieces, 'random', 43)).not.toEqual(a);
  });
});

describe('kinetic presets', () => {
  it('lowers every preset to native filters', () => {
    for (const preset of KINETIC_PRESETS) {
      const extra = preset === 'counter' ? { counter: { from: 0, to: 42 } } : {};

      expect(filters(block({ preset, ...extra })).length, preset).toBeGreaterThan(0);
    }
  });

  it('cascade: one drawtext per word, rising from below onto a shared baseline, accent coloured', () => {
    const drawn = texts(filters(block({ preset: 'cascade', y: 300, size: 100, accent: { words: 'last' } })));
    const vars = { t: 0, max_glyph_a: 70 };

    expect(drawn.map((v) => v.text)).toEqual(['Make', 'every', 'word', 'land']);
    expect(drawn.at(-1)?.fontcolor).toBe('#FFF685');
    // Before its start the first word sits `travel` below its baseline; once landed, exactly on it.
    expect(evaluateExpr(drawn[0].y, { ...vars, t: 0 })).toBeCloseTo(300 + 80 - 70 + 55, 6);
    expect(evaluateExpr(drawn[0].y, { ...vars, t: 2 })).toBeCloseTo(300 + 80 - 70, 6);
    expect(evaluateExpr(drawn[0].alpha, { t: 0 })).toBe(0);
    expect(evaluateExpr(drawn[0].alpha, { t: 1 })).toBe(1);
  });

  it('staggers words in order', () => {
    const drawn = texts(filters(block({ preset: 'fade', delay: 0, stagger: 0.5 })));

    expect(evaluateExpr(drawn[1].alpha, { t: 0.4 })).toBe(0);
    expect(evaluateExpr(drawn[1].alpha, { t: 1.2 })).toBe(1);
  });

  it('energy 0 removes travel, keeping fades (reduced motion)', () => {
    const drawn = texts(filters(block({ preset: 'cascade', y: 300, size: 100 }), undefined, { ...FRAME, energy: 0 }));

    expect(evaluateExpr(drawn[0].y, { t: 0, max_glyph_a: 70 })).toBeCloseTo(310, 6);
  });

  it('pop and impact scale each unit around its centre', () => {
    const pop = texts(filters(block({ preset: 'pop', size: 100 })))[0];

    expect(evaluateExpr(pop.fontsize, { t: 0.2 })).toBeCloseTo(30, 6);
    expect(evaluateExpr(pop.fontsize, { t: 3 })).toBeCloseTo(100, 6);
    expect(String(pop.x)).toContain('text_w/2');
  });

  it('exits leave after holding', () => {
    const drawn = texts(
      filters(block({ preset: 'cascade', exit: { preset: 'fade', at: 2, duration: 0.3, stagger: 0 } }))
    );

    expect(evaluateExpr(drawn[0].alpha, { t: 1.9 })).toBe(1);
    expect(evaluateExpr(drawn[0].alpha, { t: 2.4 })).toBe(0);
  });

  it('highlight sweeps a marker behind the accent word, one box per frame', () => {
    const list = filters(block({ preset: 'highlight' }));
    const boxes = list.filter((f) => f.type === 'drawbox');

    expect(boxes.length).toBe(Math.ceil(0.35 * 30) + 1);
    expect(list.indexOf(boxes[0])).toBeLessThan(list.findIndex((f) => f.type === 'drawtext'));
  });

  it('typewriter adds a caret; scramble adds seeded decoys', () => {
    const typed = filters(block({ preset: 'typewriter' }), 'Hi there');
    const decoys = filters(block({ preset: 'scramble' }), 'CODE');
    const again = filters(block({ preset: 'scramble' }), 'CODE');

    expect(typed.filter((f) => f.type === 'drawbox')).toHaveLength(8);
    expect(texts(decoys)).toHaveLength(4 + 4 * 3);
    expect(JSON.stringify(decoys)).toBe(JSON.stringify(again));
  });

  it('counter rolls a number with an eif expansion and escapes literals', () => {
    // Tabular layout (editor/presets/text-counter.ts, tests/text-counter.test.ts): one drawtext per figure.
    const drawn = texts(
      filters(block({ preset: 'counter', counter: { from: 0, to: 98.6, decimals: 1, suffix: '%' } }))
    ).map((values) => String(values.textExpr));

    expect(drawn.filter((text) => /^%\{eif\\:mod\(.*\\:d\}$/.test(text))).toHaveLength(3);
    expect(drawn).toContain('.');
    expect(drawn).toContain(String.raw`\\\%`);
  });

  it('coarsens units beyond the budget instead of exploding the graph', () => {
    const long = 'word '.repeat(40).trim();
    const drawn = texts(filters(block({ preset: 'typewriter', caret: false }), long));

    expect(drawn.length).toBeLessThanOrEqual(MAX_KINETIC_UNITS);
    expect(drawn.length).toBe(40);
  });

  it('draws nothing for text the font cannot measure', () => {
    expect(filters(block({ preset: 'cascade' }), '漢字')).toEqual([]);
  });
});

describe('kinetic validation', () => {
  const validator = new TemplateValidator();

  function template(kinetic: unknown[]) {
    return {
      sections: [
        { name: 's', type: 'color_background', options: { backgroundColor: '#000000', duration: 3 }, kinetic },
      ],
    };
  }

  function codes(descriptor: unknown): string[] {
    return (validator.validateTemplate(descriptor).errors ?? []).map((error) => error.code);
  }

  it('accepts a plain block', () => {
    expect(codes(template([{ text: { en: 'Hi' }, preset: 'cascade' }]))).toEqual([]);
  });

  it('needs a bundled font for word/glyph units and counter numbers', () => {
    expect(codes(template([{ text: { en: 'Hi' }, preset: 'cascade', font: 'Comic.ttf' }]))).toEqual([
      'kinetic_font_unmeasurable',
    ]);
    expect(codes(template([{ text: { en: 'Hi' }, preset: 'cascade', font: 'Comic.ttf', unit: 'line' }]))).toEqual([]);
    expect(codes(template([{ text: { en: '' }, preset: 'counter' }]))).toEqual(['invalid_kinetic']);
  });

  it('rejects an unknown preset at the schema', () => {
    expect(codes(template([{ text: { en: 'Hi' }, preset: 'explode' }])).length).toBeGreaterThan(0);
  });
});

describe('motion catalog', () => {
  it('lists every preset with a description, and its starter validates', () => {
    const catalog = motionCatalog();

    expect(catalog.kinetic.presets.map((p) => p.preset).sort()).toEqual([...KINETIC_PRESETS].sort());
    for (const preset of catalog.kinetic.presets) expect(preset.description.length).toBeGreaterThan(20);
    expect(new TemplateValidator().validateTemplate(catalog.starter).errors ?? []).toEqual([]);
  });
});
