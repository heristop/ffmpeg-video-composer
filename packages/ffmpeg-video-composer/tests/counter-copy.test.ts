import { describe, expect, it } from 'vitest';
import { COPY_COUNTER_SECONDS, counterFromCopy } from '@/core/kinetic/counter-copy';
import { resolveKinetic } from '@/core/kinetic/resolve';
import { kineticBlocksToFilters } from '@/editor/presets/kinetic';
import { KineticBlockSchema, type KineticBlock } from '@/schemas/kinetic.schemas';
import type { SugarContext } from '@/editor/presets/sugar-context';
import type { Filter } from '@/core/types';

const FRAME = { width: 1280, height: 720, fps: 30, duration: 4, seed: 7, energy: 1 };

function parse(copy: string, fields: Record<string, unknown> = {}) {
  return counterFromCopy({ from: 0, ...fields }, copy);
}

function block(fields: Partial<KineticBlock> = {}): KineticBlock {
  return KineticBlockSchema.parse({
    text: { en: '{{ price }}' },
    preset: 'counter',
    counter: { from: 0 },
    delay: 0.2,
    ...fields,
  });
}

// The section lowering with the price field resolved to `price` (locale "en").
function lower(blocks: KineticBlock[], price: string): Filter[] {
  const ctx = {
    scale: '1280:720',
    fps: 30,
    duration: 4,
    motion: {
      energy: 1,
      seedFor: () => 7,
      resolveText: (text: Record<string, string | undefined>) => (text.en ?? '').replace('{{ price }}', price),
    },
  } as unknown as SugarContext;

  return kineticBlocksToFilters(blocks, ctx);
}

function texts(filters: Filter[]): string[] {
  return filters.map((filter) => {
    const values = filter.values as { textExpr?: string; text?: string };

    return values.textExpr ?? values.text ?? '';
  });
}

describe('counter from its copy: parsing', () => {
  it('takes the first number as `to` and the text around it as prefix and suffix', () => {
    expect(parse('EUR 24')).toMatchObject({ to: 24, prefix: 'EUR ', suffix: '', decimals: 0, grouping: false });
    expect(parse('Only $19 today')).toMatchObject({ to: 19, prefix: 'Only $', suffix: ' today' });
  });

  it('reads decimals, grouping and the locale from the separators as typed', () => {
    expect(parse('$1,299.00')).toMatchObject({ to: 1299, decimals: 2, grouping: true, locale: 'en' });
    expect(parse('24,90 €')).toMatchObject({ to: 24.9, decimals: 2, suffix: ' €', locale: 'fr' });
    expect(parse('1.299,50 €')).toMatchObject({ to: 1299.5, decimals: 2, grouping: true, locale: 'de' });
    expect(parse('CHF 1’250.–')).toMatchObject({ to: 1250, grouping: true, locale: 'de-CH', suffix: '.–' });
    expect(parse('1 500 €')).toMatchObject({ to: 1500, grouping: true, locale: 'fr' });
    expect(parse('1,500')).toMatchObject({ to: 1500, decimals: 0, grouping: true });
    expect(parse('9.5/10')).toMatchObject({ to: 9.5, decimals: 1, suffix: '/10' });
  });

  it('keeps authored fields and returns null for copy without a number', () => {
    expect(parse('EUR 24', { prefix: '€', decimals: 2, locale: 'de' })).toMatchObject({
      to: 24,
      prefix: '€',
      decimals: 2,
      locale: 'de',
    });
    expect(parse('Free')).toBeNull();
    expect(parse('')).toBeNull();
  });
});

describe('counter from its copy: lowering', () => {
  it('rolls up to the number in the resolved field and lands on the copy', () => {
    const filters = lower([block({ counter: { from: 0, tabular: false } })], 'EUR 24');
    const shown = texts(filters).join(' ');

    expect(shown).toContain('EUR ');
    expect(shown).toMatch(/%\{eif\\:/);
    expect(shown).not.toContain('{{');
  });

  it('draws copy without a number as a plain fade, and leaves explicit counters alone', () => {
    expect(texts(lower([block()], 'Free')).join('')).toContain('Free');
    expect(texts(lower([block({ counter: { from: 0, to: 5 } })], 'EUR 24')).join('')).not.toContain('EUR');
  });

  it('rolls for a fixed time without a block duration, so the timeline agrees with the lowering', () => {
    const settings = resolveKinetic(block(), FRAME, '');

    expect(settings.duration).toBe(COPY_COUNTER_SECONDS);
  });
});
