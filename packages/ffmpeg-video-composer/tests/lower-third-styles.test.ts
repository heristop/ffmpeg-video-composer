import { describe, expect, it } from 'vitest';
import { lowerThirdFilters } from '@/editor/presets/lower-third-styles';
import { lowerThirdToFilters, type LowerThird } from '@/editor/presets/text-blocks';
import { roundedBands } from '@/editor/presets/rounded-panel';
import { motionTimeline } from '@/core/motion/timeline';
import { motionCatalog } from '@/core/motion/catalog';
import { LOWER_THIRD_STYLES, LowerThirdSchema } from '@/schemas/text.schemas';
import { TemplateValidator } from '@/services/TemplateValidator';
import type { Filter } from '@/core/types';

const CTX = { scale: '1280:720', fps: 30, resolveText: (text: Record<string, string | undefined>) => text.en ?? '' };
const BLOCK: LowerThird = {
  title: { en: 'Ada Lovelace' },
  subtitle: { en: 'Analyst' },
  accent: '#FF8AAE',
  badge: { en: 'No. 1' },
};

type Values = Record<string, unknown>;

function drawn(list: Filter[], type: string): Values[] {
  return list.filter((f) => f.type === type).map((f) => f.values as Values);
}

describe('lower-third styles', () => {
  it('keeps the original band byte-identical without a style', () => {
    expect(lowerThirdFilters(BLOCK, CTX)).toEqual(lowerThirdToFilters(BLOCK, { scale: CTX.scale }));
    expect(lowerThirdFilters(undefined, CTX)).toEqual([]);
  });

  it('lowers every style to a distinct layout with the title, subtitle and badge', () => {
    const outputs = LOWER_THIRD_STYLES.map((style) => JSON.stringify(lowerThirdFilters({ ...BLOCK, style }, CTX)));

    expect(new Set(outputs).size).toBe(LOWER_THIRD_STYLES.length);
    for (const style of LOWER_THIRD_STYLES) {
      const texts = drawn(lowerThirdFilters({ ...BLOCK, style }, CTX), 'drawtext').map((v) => v.text);

      expect(texts, style).toEqual(expect.arrayContaining([BLOCK.title, BLOCK.subtitle, BLOCK.badge]));
    }
  });

  it('reuses the reveal curves: each style animates its lines with its default reveal, staggered', () => {
    const lines = drawn(lowerThirdFilters({ ...BLOCK, style: 'clean-bar' }, CTX), 'drawtext');

    expect(String(lines[0].x)).toContain('(1-(');
    expect(lines[0].alpha).not.toEqual(lines[1].alpha);
    expect(lines[0]).toMatchObject({ box: 1, boxcolor: '#0a0f14@0.85' });
  });

  it('draws its shapes frame by frame, then holds them (clean-bar rule, side-rule growth)', () => {
    const rule = drawn(lowerThirdFilters({ ...BLOCK, style: 'side-rule' }, CTX), 'drawbox');
    const heights = rule.map((v) => Number(v.h));

    expect(rule.length).toBeGreaterThan(5);
    expect(heights).toEqual([...heights].sort((a, b) => a - b));
    expect(rule.at(-1)?.enable).toBe("'gte(t,0.8)'");
    expect(rule.every((v) => v.color === '#FF8AAE')).toBe(true);
  });

  it('pill: a rounded body that grows from the left, sized from the measured copy', () => {
    const pill = drawn(lowerThirdFilters({ ...BLOCK, style: 'pill' }, CTX), 'drawbox');
    const held = pill.filter((v) => v.enable === "'gte(t,0.8)'" && v.color === '#0a0f14@0.85');
    const right = Math.max(...held.map((v) => Number(v.x) + Number(v.w)));
    const longer = drawn(
      lowerThirdFilters({ ...BLOCK, title: { en: 'Ada Lovelace the First' }, style: 'pill' }, CTX),
      'drawbox'
    );
    const longerRight = Math.max(
      ...longer.filter((v) => v.enable === "'gte(t,0.8)'").map((v) => Number(v.x) + Number(v.w))
    );

    expect(held.length).toBeGreaterThan(5);
    expect(new Set(held.map((v) => v.x)).size).toBeGreaterThan(3);
    expect(longerRight).toBeGreaterThan(right);
  });

  it('rounded bands never overlap and follow the corner arc', () => {
    const bands = roundedBands(40, 20, 4);

    expect(bands).toHaveLength(8);
    expect(bands.reduce((sum, band) => sum + band.h, 0)).toBeCloseTo(40, 6);
    expect(bands[0].inset).toBeGreaterThan(bands[3].inset);
    expect(bands[7].inset).toBeCloseTo(bands[0].inset, 6);
    expect(roundedBands(60, 10, 2).map((band) => band.inset)[2]).toBe(0);
  });

  it('validates the style, lists it in the catalog and times it on the motion timeline', () => {
    expect(LowerThirdSchema.safeParse({ ...BLOCK, style: 'pill' }).success).toBe(true);
    expect(LowerThirdSchema.safeParse({ ...BLOCK, style: 'neon' }).success).toBe(false);

    const descriptor = {
      meta: { name: 'lt' },
      global: { orientation: 'landscape', fps: 30 },
      sections: [
        { name: 's', type: 'color_background', options: { duration: 3 }, lowerThird: { ...BLOCK, style: 'pill' } },
      ],
    };
    expect(new TemplateValidator().validateTemplate(descriptor).errors ?? []).toEqual([]);
    expect(motionTimeline(descriptor).sections[0].events[0]).toMatchObject({ element: 'lowerThird' });

    const catalog = motionCatalog();
    expect(Object.keys(catalog.lowerThirds).sort()).toEqual(['band', ...LOWER_THIRD_STYLES].sort());
    expect(catalog.lowerThirds.pill.verb).toBe('BADGES');
  });
});
