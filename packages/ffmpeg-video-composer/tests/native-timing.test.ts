import { describe, expect, it } from 'vitest';
import { applyAnimation } from '../src/editor/presets/text';
import { titleCardToFilters } from '../src/editor/presets/text-blocks';
import { ExitSchema } from '../src/schemas/reveal.schemas';
import { TitleCardSchema } from '../src/schemas/text.schemas';

const card = {
  kicker: { en: 'Introducing' },
  headline: { en: 'A headline' },
  subtitle: { en: 'Supporting copy' },
  accent: '#ffffff',
  fade: { in: false, out: false },
};
const context = { scale: '1280:720' };

describe('native timing contracts', () => {
  it('eases the exit alpha and movement with the existing cubic curve', () => {
    const values = { x: 100, y: 200 } as Record<string, unknown>;
    applyAnimation(
      values,
      undefined,
      { type: 'rise', after: 2, duration: 1, easing: 'ease-out' },
      { x: 100, y: 200 },
      4
    );
    const ramp = 'if(lt(t,2),0,if(lt(t,3),(t-2)/1,1))';
    expect(values.alpha).toBe(`'(1-(1-pow(1-(${ramp}),3)))'`);
    expect(values.y).toBe(`'(200)-(1-pow(1-(${ramp}),3))*60'`);
  });

  it('preserves existing output for omitted or explicit linear exit easing', () => {
    const plain = { x: 10, y: 20 } as Record<string, unknown>;
    const explicit = { ...plain };
    applyAnimation(plain, 'fade', 'slide-left', { x: 10, y: 20 }, 3);
    applyAnimation(explicit, 'fade', { type: 'slide-left', easing: 'linear' }, { x: 10, y: 20 }, 3);
    expect(explicit).toEqual(plain);
  });

  it.each([0, 0.07])('uses authored title-card stagger %s without consuming blank slots', (stagger) => {
    const filters = titleCardToFilters({ ...card, kicker: { en: ' ' }, stagger }, context);
    const text = filters.filter((filter) => filter.type === 'drawtext');
    expect(text).toHaveLength(2);
    expect(text[0].values?.alpha).toContain('lt(t,0.3)');
    expect(text[1].values?.alpha).toContain(`lt(t,${0.3 + stagger})`);
    expect(filters.find((filter) => filter.type === 'drawbox')?.values?.enable).toBe("'gte(t,0.3)'");
  });

  it('keeps the default .15 line stagger byte-identical', () => {
    expect(titleCardToFilters({ ...card, stagger: 0.15 }, context)).toEqual(titleCardToFilters(card, context));
  });

  it('strictly validates authored easing and bounded stagger', () => {
    expect(ExitSchema.safeParse({ type: 'fade', easing: 'ease-out' }).success).toBe(true);
    expect(ExitSchema.safeParse({ type: 'fade', easing: 'bounce' }).success).toBe(false);
    expect(TitleCardSchema.safeParse({ ...card, stagger: 0 }).success).toBe(true);
    expect(TitleCardSchema.safeParse({ ...card, stagger: 1 }).success).toBe(true);
    expect(TitleCardSchema.safeParse({ ...card, stagger: -0.1 }).success).toBe(false);
    expect(TitleCardSchema.safeParse({ ...card, stagger: 1.01 }).success).toBe(false);
  });
});
