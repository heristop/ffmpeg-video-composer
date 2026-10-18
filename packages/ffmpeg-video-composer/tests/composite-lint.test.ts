import { describe, expect, it } from 'vitest';
import { TemplateValidator } from '@/services/TemplateValidator';
import { collectCompositeWarnings } from '@/services/composite-lint';

const layer = (options: Record<string, unknown>) => ({
  sections: [
    {
      name: 's',
      type: 'color_background',
      options: { duration: 2 },
      inputs: [{ name: 'c', type: 'html', html: '<div></div>', width: 100, height: 100, options }],
    },
  ],
});

const kinetic = (block: Record<string, unknown>) => ({
  sections: [
    { name: 's', type: 'color_background', options: { duration: 2 }, kinetic: [{ text: { en: 'Hi' }, ...block }] },
  ],
});

const codes = (template: unknown, caps?: Parameters<typeof collectCompositeWarnings>[1]) =>
  collectCompositeWarnings(template, caps).map((w) => `${w.code} ${w.path}`);

const moving = { x: [{ v: 0 }, { t: 1, v: 200 }] };

describe('composite lint', () => {
  it('flags motion blur on a layer that never moves', () => {
    const still = collectCompositeWarnings(
      layer({ motionBlur: true, animate: { opacity: [{ v: 0 }, { t: 1, v: 1 }] } })
    );

    expect(still.map((w) => `${w.code} ${w.path}`)).toEqual([
      'motion_blur_static sections[0].inputs[0].options.motionBlur',
    ]);
    expect(still[0].message).toMatch(/entrance `motion` presets are not blurred/);
    expect(codes(layer({ motionBlur: true, animate: moving }))).toEqual([]);
  });

  it('flags motion blur on a kinetic preset that never travels', () => {
    expect(codes(kinetic({ preset: 'typewriter', motionBlur: true }))).toEqual([
      'motion_blur_static sections[0].kinetic[0].motionBlur',
    ]);
  });

  it('flags motion blur that a fill, a kinetic clip or a layer clip draws sharp', () => {
    const fill = { gradient: { from: '#fff', to: '#000' } };

    expect(codes(kinetic({ preset: 'slide', motionBlur: true, fill }))).toEqual([
      'motion_blur_ignored sections[0].kinetic[0].motionBlur',
    ]);
    expect(codes(kinetic({ preset: 'slide', motionBlur: true, clip: { shape: 'circle' } }))).toEqual([
      'motion_blur_ignored sections[0].kinetic[0].motionBlur',
    ]);
    expect(codes(layer({ motionBlur: true, animate: moving, clip: { shape: 'circle' } }))).toEqual([
      'motion_blur_ignored sections[0].inputs[0].options.motionBlur',
    ]);
  });

  it('names what the target build cannot draw, only when told its capabilities', () => {
    const template = layer({ blend: 'screen', motionBlur: true, animate: moving });
    const caps = { textShaping: true, masks: true, blend: false, tmix: false };

    expect(codes(template)).toEqual([]);
    expect(codes(template, caps)).toEqual([
      'blend_unavailable sections[0].inputs[0].options.blend',
      'motion_blur_unavailable sections[0].inputs[0].options.motionBlur',
    ]);
    expect(codes(kinetic({ preset: 'slide', motionBlur: true }), caps)).toEqual([
      'motion_blur_unavailable sections[0].kinetic[0].motionBlur',
    ]);
    expect(collectCompositeWarnings(template, caps)[0].message).toMatch(/blend modes need the blend filter/);
  });

  it('never throws on malformed tracks', () => {
    expect(() =>
      collectCompositeWarnings(layer({ motionBlur: true, animate: { x: 'oops', y: [null, 3] } }))
    ).not.toThrow();
    expect(() => collectCompositeWarnings({ sections: [null, { inputs: 'x', kinetic: [1] }] })).not.toThrow();
  });

  it('rides on getMotionWarnings', () => {
    const warnings = new TemplateValidator().getMotionWarnings(kinetic({ preset: 'fade', motionBlur: true }));

    expect(warnings.find((w) => w.code === 'motion_blur_static')?.hint).toMatch(/slide|rise|drop/);
  });

  it('treats a null, array or string motionBlur as absent instead of throwing', () => {
    for (const motionBlur of [null, [], 'yes', 0]) {
      expect(() => collectCompositeWarnings(layer({ motionBlur, animate: moving }))).not.toThrow();
      expect(codes(layer({ motionBlur, animate: moving }))).toEqual([]);
      expect(codes(kinetic({ preset: 'fade', motionBlur }))).toEqual([]);
    }
  });
});
