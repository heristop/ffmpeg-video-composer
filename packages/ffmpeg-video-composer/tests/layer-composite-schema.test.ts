import { describe, expect, it } from 'vitest';
import { InputSchema } from '@/schemas/template.schemas';
import { KineticBlockSchema } from '@/schemas/kinetic.schemas';
import { BLEND_MODES, resolveMotionBlur } from '@/schemas/layer-composite.schemas';

const card = (options: Record<string, unknown>) => ({
  name: 'card',
  type: 'html',
  html: '<div></div>',
  width: 100,
  height: 100,
  options,
});

describe('layer blend schema', () => {
  it('accepts every blend mode on a layer', () => {
    for (const blend of BLEND_MODES) {
      expect(InputSchema.safeParse(card({ blend })).success, blend).toBe(true);
    }
  });

  it('rejects an unknown mode at options.blend', () => {
    const result = InputSchema.safeParse(card({ blend: 'hue' }));

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['options', 'blend']);
  });
});

describe('motion blur schema', () => {
  it('takes true or a bounded { shutter, samples }', () => {
    expect(InputSchema.safeParse(card({ motionBlur: true })).success).toBe(true);
    expect(InputSchema.safeParse(card({ motionBlur: { shutter: 270, samples: 12 } })).success).toBe(true);

    for (const motionBlur of [
      { shutter: 400 },
      { shutter: -1 },
      { shutter: 90.5 },
      { shutter: Infinity },
      { samples: 1 },
      { samples: 17 },
      { samples: 4.5 },
      { shutter: 180, speed: 2 },
      false,
    ]) {
      expect(InputSchema.safeParse(card({ motionBlur })).success, JSON.stringify(motionBlur)).toBe(false);
    }
  });

  it('is accepted on a kinetic block', () => {
    const block = { text: { en: 'GO' }, preset: 'slide', motionBlur: { shutter: 180 } };

    expect(KineticBlockSchema.safeParse(block).success).toBe(true);
  });

  it('resolves defaults; a closed shutter or no value is off', () => {
    expect(resolveMotionBlur(undefined)).toBeNull();
    expect(resolveMotionBlur(null as never)).toBeNull();
    expect(resolveMotionBlur([] as never)).toBeNull();
    expect(resolveMotionBlur('yes' as never)).toBeNull();
    expect(resolveMotionBlur(true)).toEqual({ shutter: 180, samples: 8 });
    expect(resolveMotionBlur({ samples: 4 })).toEqual({ shutter: 180, samples: 4 });
    expect(resolveMotionBlur({ shutter: 0, samples: 16 })).toBeNull();
    expect(resolveMotionBlur({ shutter: 360, samples: 2 })).toEqual({ shutter: 360, samples: 2 });
  });
});

describe('clip cannot combine with blend or motionBlur', () => {
  const clip = { x: 0, y: 0, w: 50, h: 50 };

  it('still accepts a clip alone and a normal blend with a clip', () => {
    expect(InputSchema.safeParse(card({ clip })).success).toBe(true);
    expect(InputSchema.safeParse(card({ clip, blend: 'normal' })).success).toBe(true);
  });

  it('rejects clip with a non-normal blend at options.blend', () => {
    const result = InputSchema.safeParse(card({ clip, blend: 'screen' }));

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['options', 'blend']);
    expect(result.error?.issues[0]?.message).toContain('clip cannot combine with blend or motionBlur yet; drop one');
  });

  it('rejects clip with motionBlur at options.motionBlur', () => {
    const result = InputSchema.safeParse(card({ clip, motionBlur: true }));

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['options', 'motionBlur']);
  });
});
