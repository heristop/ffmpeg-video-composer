import { describe, expect, it } from 'vitest';
import { kineticToFilters } from '@/editor/presets/kinetic';
import { resolveKinetic } from '@/core/kinetic/resolve';
import { measureBundled } from '@/core/kinetic/layout';
import { KineticBlockSchema, type KineticBlock } from '@/schemas/kinetic.schemas';
import { CounterSchema } from '@/schemas/text.schemas';
import { evaluateExpr } from '@/services/geometry/drawtext-expr';
import { DEVICE_FILTERS } from '@/editor/utils/device-filters.generated';
import type { Filter } from '@/core/types';

const FRAME = { width: 1280, height: 720, fps: 30, duration: 4, seed: 7, energy: 1 };
const FONT = 'BebasNeue.ttf';

type Values = Record<string, unknown>;

function counter(fields: Record<string, unknown>, extra: Partial<KineticBlock> = {}): KineticBlock {
  return KineticBlockSchema.parse({
    text: { en: '' },
    preset: 'counter',
    delay: 0.5,
    duration: 1,
    counter: fields,
    ...extra,
  });
}

function lower(block: KineticBlock, locale = 'en'): Values[] {
  return kineticToFilters(block, { ...FRAME, text: locale }).map((f: Filter) => f.values as Values);
}

function unquote(expr: unknown): string {
  return String(expr).replace(/^'(.*)'$/s, '$1');
}

// What FFmpeg draws for one drawtext at time t: its expanded text, or null when it is gated off.
function expand(values: Values, t: number): string | null {
  if (values.enable !== undefined && evaluateExpr(unquote(values.enable), { t }) === 0) return null;

  return String(values.textExpr)
    .replace(/%\{eif\\:(.*?)\\:d(?:\\:(\d+))?\}/g, (_m, expr: string, width?: string) =>
      String(evaluateExpr(expr, { t })).padStart(Number(width ?? 0), '0')
    )
    .replace(/\\(.)/g, '$1')
    .replace(/\\(.)/g, '$1');
}

interface Drawn {
  text: string;
  x: number;
  width: number;
}

function drawn(list: Values[], t: number): Drawn[] {
  return list
    .flatMap((values) => {
      const text = expand(values, t);

      if (text === null) return [];

      const width = measureBundled(FONT, text, Number(values.fontsize)) ?? 0;
      const x = evaluateExpr(unquote(values.x), { t, text_w: width }) as number;

      return [{ text, x, width }];
    })
    .sort((a, b) => a.x - b.x);
}

function shown(list: Values[], t: number): string {
  return drawn(list, t)
    .map((piece) => piece.text)
    .join('');
}

describe('counter: value', () => {
  it('lands exactly on the final value at the end of the roll and holds there', () => {
    const list = lower(counter({ from: 0, to: 12500, prefix: '$' }));

    expect(shown(list, 0)).toBe('$0');
    for (const t of [1.5, 1.6, 2.5, 3.9]) expect(shown(list, t)).toBe('$12,500');
    expect(shown(list, 1.4)).not.toBe('$12,500');
  });

  it('rolls monotonically without overshoot, and passes the target then settles with it', () => {
    const plain = lower(counter({ from: 0, to: 500 }));
    const values = Array.from({ length: 40 }, (_, f) => Number(shown(plain, 0.5 + f / 30)));

    for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);

    const bouncy = lower(counter({ from: 0, to: 500, overshoot: 0.04 }));
    const peak = Math.max(...Array.from({ length: 40 }, (_, f) => Number(shown(bouncy, 0.5 + f / 30))));

    expect(peak).toBe(520);
    expect(shown(bouncy, 1.5)).toBe('500');
  });

  it('shows decimals exactly (no float truncation) and counts down', () => {
    expect(shown(lower(counter({ from: 0, to: 0.29, decimals: 2 })), 2)).toBe('0.29');
    expect(shown(lower(counter({ from: 0, to: 98.6, decimals: 1, suffix: '%' })), 2)).toBe('98.6%');
    expect(shown(lower(counter({ from: 100, to: 7 })), 2)).toBe('7');
    expect(shown(lower(counter({ from: 100, to: 7 })), 0.2)).toBe('100');
  });
});

describe('counter: formatting', () => {
  it('groups by locale, by default only from five integer digits', () => {
    expect(shown(lower(counter({ from: 0, to: 2024 })), 2)).toBe('2024');
    expect(shown(lower(counter({ from: 0, to: 2024, grouping: true })), 2)).toBe('2,024');
    expect(shown(lower(counter({ from: 0, to: 1234567.5, decimals: 1, locale: 'de' })), 2)).toBe('1.234.567,5');
    expect(shown(lower(counter({ from: 0, to: 12500, grouping: false })), 2)).toBe('12500');
    expect(shown(lower(counter({ from: 0, to: 12500.25, decimals: 2, locale: 'de-CH' })), 2)).toBe('12’500.25');
  });

  it('takes the active locale when none is set; a French group is a gap, not a glyph', () => {
    const list = lower(counter({ from: 0, to: 12500.5, decimals: 1 }), 'fr');
    const pieces = drawn(list, 2);

    expect(pieces.map((p) => p.text).join('')).toBe('12500,5');
    // The gap between the thousands and the hundreds is wider than between two figures.
    const gaps = pieces.slice(1).map((p, i) => p.x - (pieces[i].x + pieces[i].width));
    expect(gaps[1]).toBeGreaterThan(gaps[0] + 5);
  });

  it('keeps every figure in a fixed slot: positions only move when the number gains a digit', () => {
    const list = lower(counter({ from: 0, to: 900 }, { align: 'right' }));
    const unitSlot = (t: number) => {
      const last = drawn(list, t).at(-1) as Drawn;

      return last.x + last.width / 2;
    };
    const centres = Array.from({ length: 40 }, (_, f) => unitSlot(0.5 + f / 30));

    expect(new Set(centres.map((c) => c.toFixed(3))).size).toBe(1);

    const centred = lower(counter({ from: 100, to: 900 }));
    const widths = Array.from({ length: 40 }, (_, f) => {
      const pieces = drawn(centred, 0.5 + f / 30);
      const slotLeft = (pieces[0].x + pieces[0].width / 2) as number;

      return slotLeft.toFixed(3);
    });
    expect(new Set(widths).size).toBe(1);
  });

  it('draws proportional figures as one drawtext per digit count', () => {
    const list = lower(counter({ from: 0, to: 12500, tabular: false, prefix: 'EUR ' }));

    // One per digit count the roll actually shows (fast eases skip some), each gated to its frames.
    expect(list.length).toBeGreaterThan(1);
    expect(list.length).toBeLessThanOrEqual(5);
    expect(list.slice(0, -1).every((values) => String(values.enable).includes('lt(t,'))).toBe(true);
    expect(shown(list, 2)).toBe('EUR 12,500');
    expect(shown(list, 0)).toBe('EUR 0');
  });
});

describe('counter: lowering contract', () => {
  it('is drawtext only, at a constant font size, deterministic', () => {
    const block = counter({ from: 0, to: 1250000, prefix: '$', decimals: 1, overshoot: 0.02 });
    const list = lower(block);

    expect(list.every((values) => typeof values.fontsize === 'number')).toBe(true);
    expect(DEVICE_FILTERS.has('drawtext')).toBe(true);
    expect(kineticToFilters(block, { ...FRAME, text: 'en' }).every((f) => f.type === 'drawtext')).toBe(true);
    expect(JSON.stringify(lower(block))).toBe(JSON.stringify(list));
  });

  it('derives the roll duration from the range when the block sets none', () => {
    const duration = (to: number) =>
      resolveKinetic(KineticBlockSchema.parse({ text: { en: '' }, preset: 'counter', counter: { from: 0, to } }), FRAME)
        .duration;

    expect(duration(24)).toBe(0.85);
    expect(duration(1)).toBe(0.6);
    expect(duration(1_000_000)).toBe(1.6);
  });

  it('validates its fields', () => {
    expect(CounterSchema.safeParse({ from: 0, to: 10, overshoot: 0.2 }).success).toBe(false);
    expect(CounterSchema.safeParse({ from: 0, to: 10, locale: 'xx' }).success).toBe(false);
    expect(CounterSchema.safeParse({ from: 0, to: 10, tabular: false, grouping: true, locale: 'fr' }).success).toBe(
      true
    );
  });
});
