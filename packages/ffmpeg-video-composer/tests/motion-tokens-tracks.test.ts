import { describe, expect, it } from 'vitest';
import {
  BUILTIN_MOTION_TOKENS,
  keyTimesError,
  resolveKeyTimes,
  resolveMotionDescriptor,
  springSettleTime,
  trackExpr,
} from '@/core/motion';
import { applyTracks } from '@/core/motion/tracks';
import { evaluateExpr } from '@/services/geometry/drawtext-expr';
import { TemplateValidator } from '@/services/TemplateValidator';

type Descriptor = Parameters<typeof resolveMotionDescriptor>[0] & Record<string, unknown>;

function v2(global: Record<string, unknown>, sections: unknown[]): Descriptor {
  return { global, sections };
}

describe('motion tokens', () => {
  it('resolves built-in and authored tokens wherever an easing is accepted', () => {
    const resolved = resolveMotionDescriptor(
      v2({ motion: { curves: { brand: 'ease-out-expo' }, springs: { soft: { stiffness: 120, damping: 20 } } } }, [
        { caption: { reveal: { type: 'rise', easing: '$snappy' } } },
        { filters: [{ type: 'drawtext', exit: { type: 'fade', easing: '$brand' } }] },
        { inputs: [{ options: { motion: { type: 'slide-left', easing: '$soft' } } }] },
      ])
    ) as { sections: Array<Record<string, any>> };

    expect(resolved.sections[0].caption.reveal.easing).toBe('spring(420, 30, 1, 0)');
    expect(resolved.sections[1].filters[0].exit.easing).toBe('ease-out-expo');
    expect(resolved.sections[2].inputs[0].options.motion.easing).toBe('spring(120, 20, 1, 0)');
  });

  it('lets an authored token override a built-in by name', () => {
    const resolved = resolveMotionDescriptor(
      v2({ motion: { curves: { smooth: 'linear' } } }, [{ caption: { reveal: { type: 'fade', easing: '$smooth' } } }])
    ) as { sections: Array<Record<string, any>> };

    expect(resolved.sections[0].caption.reveal.easing).toBe('linear');
    expect(BUILTIN_MOTION_TOKENS.curves.smooth).toBe('cubic-bezier(0.4, 0, 0.2, 1)');
  });

  it('scales every travel by energy, including bare reveal strings, and leaves fades and cameras alone', () => {
    const resolved = resolveMotionDescriptor(
      v2({ motion: { energy: 0.5 }, overlays: [{ reveal: 'rise' }] }, [
        {
          titleCard: { reveal: { type: 'slide-left', distance: 100 } },
          caption: { reveal: 'fade' },
          motion: [{ type: 'kenburns' }],
          filters: [{ type: 'drawtext', animate: { x: [{ v: '+80' }, { t: 1, v: '-40' }], opacity: [{ v: 0 }] } }],
        },
      ])
    ) as { global: Record<string, any>; sections: Array<Record<string, any>> };

    expect(resolved.global.overlays[0].reveal).toEqual({ type: 'rise', distance: 30 });
    expect(resolved.sections[0].titleCard.reveal.distance).toBe(50);
    expect(resolved.sections[0].caption.reveal).toBe('fade');
    expect(resolved.sections[0].motion).toEqual([{ type: 'kenburns' }]);
    expect(resolved.sections[0].filters[0].animate.x.map((key: { v: string }) => key.v)).toEqual(['+40', '-20']);
    expect(resolved.sections[0].filters[0].animate.opacity[0].v).toBe(0);
  });

  it('resolves duration tokens in key times', () => {
    const resolved = resolveMotionDescriptor(
      v2({ motion: { durations: { beat: 0.5 } } }, [
        {
          filters: [
            {
              type: 'drawtext',
              animate: {
                y: [
                  { t: '$beat', v: 0 },
                  { t: '+$base', v: 10 },
                ],
              },
            },
          ],
        },
      ])
    ) as { sections: Array<Record<string, any>> };

    expect(resolved.sections[0].filters[0].animate.y.map((key: { t: unknown }) => key.t)).toEqual([0.5, '+0.6']);
  });
});

describe('keyframe tracks', () => {
  it('eases each key into the next from the resting position', () => {
    const expr = trackExpr(
      [
        { t: 0, v: '+80' },
        { t: 1, v: '+0', ease: 'ease-out-cubic' },
      ],
      100
    );

    expect(evaluateExpr(expr, { t: 0 })).toBe(180);
    expect(evaluateExpr(expr, { t: 0.5 })).toBeCloseTo(110, 1);
    expect(evaluateExpr(expr, { t: 1 })).toBe(100);
    expect(evaluateExpr(expr, { t: 5 })).toBe(100);
  });

  it('chains segments, mixing absolute and relative values', () => {
    const expr = trackExpr(
      [
        { t: 0, v: 0 },
        { t: 1, v: '+50' },
        { t: 2, v: 300 },
      ],
      200
    );

    expect(evaluateExpr(expr, { t: 0.5 })).toBe(125);
    expect(evaluateExpr(expr, { t: 1 })).toBe(250);
    expect(evaluateExpr(expr, { t: 1.5 })).toBe(275);
    expect(evaluateExpr(expr, { t: 3 })).toBe(300);
  });

  it('lets a spring decide when its key lands', () => {
    const [, landed] = resolveKeyTimes([
      { t: 0.2, v: 0 },
      { v: 1, ease: 'spring(420, 30)' },
    ]);

    expect(landed.at).toBeCloseTo(0.2 + springSettleTime({ stiffness: 420, damping: 30 }), 6);
  });

  it('overshoots with a bouncy spring and settles exactly', () => {
    const expr = trackExpr([
      { t: 0, v: 0 },
      { t: 1, v: 1, ease: 'spring(300, 14)' },
    ]);
    const peak = Math.max(...Array.from({ length: 101 }, (_, i) => evaluateExpr(expr, { t: i / 100 }) as number));

    expect(peak).toBeGreaterThan(1.1);
    expect(evaluateExpr(expr, { t: 1.5 })).toBe(1);
  });

  it('reports keys out of order', () => {
    expect(
      keyTimesError([
        { t: 1, v: 0 },
        { t: 0.5, v: 1 },
      ])
    ).toMatch(/not after/);
    expect(keyTimesError([{ v: 0 }, { t: '+0.2', v: 1 }])).toBeNull();
  });

  it('applies tracks onto drawtext values: clamped alpha and a scaled fontsize', () => {
    const values: Record<string, unknown> = { x: 100, y: '(h-text_h)/2', fontsize: 48 };
    applyTracks(
      values,
      {
        y: [{ v: '+40' }, { t: 0.5, v: '+0' }],
        opacity: [{ v: 0 }, { t: 0.3, v: 1.4 }],
        scale: [{ v: 0.8 }, { t: 0.5, v: 1 }],
      },
      { x: 100, y: '(h-text_h)/2' }
    );

    expect(evaluateExpr(values.y, { t: 0, h: 720, text_h: 40 })).toBe(380);
    expect(evaluateExpr(values.alpha, { t: 0.3 })).toBe(1);
    expect(evaluateExpr(values.fontsize, { t: 0 })).toBeCloseTo(38.4, 6);
    expect(evaluateExpr(values.fontsize, { t: 1 })).toBe(48);
  });
});

describe('motion validation', () => {
  const validator = new TemplateValidator();

  function section(filters: unknown[], extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      name: 'card',
      type: 'color_background',
      options: { backgroundColor: '#101010', duration: 3 },
      filters,
      ...extra,
    };
  }

  function codes(descriptor: Record<string, unknown>): string[] {
    return (validator.validateTemplate(descriptor).errors ?? []).map((error) => error.code);
  }

  const text = { type: 'drawtext', values: { text: { en: 'Hi' }, x: 10, y: 10, fontsize: 40 } };

  it('accepts historical names, springs, tracks and tokens', () => {
    expect(codes({ sections: [section([{ ...text, reveal: { type: 'rise', easing: 'ease-out' } }])] })).toEqual([]);
    expect(codes({ sections: [section([{ ...text, reveal: { type: 'rise', easing: 'spring(300, 14)' } }])] })).toEqual(
      []
    );
    expect(codes({ sections: [section([{ ...text, animate: { x: [{ v: 0 }] } }])] })).toEqual([]);
  });

  it('accepts a full motion template', () => {
    const descriptor = {
      global: { motion: { energy: 0.8, curves: { brand: 'cubic-bezier(0.2, 0, 0, 1)' }, durations: { beat: 0.5 } } },
      sections: [
        section([
          {
            ...text,
            reveal: { type: 'rise', easing: '$bouncy' },
            animate: {
              scale: [{ v: 0.9 }, { t: '+$beat', v: 1, ease: '$brand' }],
              x: [{ v: '+30' }, { v: '+0', ease: '$snappy' }],
            },
          },
        ]),
      ],
    };

    expect(codes(descriptor)).toEqual([]);
  });

  it('names unknown tokens, bad easings and bad tracks', () => {
    const base = {};

    expect(codes({ ...base, sections: [section([{ ...text, reveal: { type: 'rise', easing: '$nope' } }])] })).toEqual([
      'unknown_motion_token',
    ]);
    const typo = validator.validateTemplate({
      ...base,
      sections: [section([{ ...text, reveal: { type: 'rise', easing: 'ease-outt' } }])],
    });
    expect(typo.errors?.map((error) => [error.code, error.message])).toEqual([
      ['custom', 'unknown easing "ease-outt"'],
    ]);
    expect(
      codes({
        ...base,
        sections: [
          section([
            {
              ...text,
              animate: {
                x: [
                  { t: 1, v: 0 },
                  { t: 0.5, v: 9 },
                ],
              },
            },
          ]),
        ],
      })
    ).toEqual(['invalid_keyframes']);
    expect(codes({ ...base, sections: [section([{ ...text, animate: { opacity: [{ v: '+1' }] } }])] })).toEqual([
      'invalid_keyframes',
    ]);
    expect(
      codes({
        ...base,
        sections: [section([{ type: 'drawtext', values: { text: { en: 'x' } }, animate: { scale: [{ v: 1 }] } }])],
      })
    ).toEqual(['invalid_keyframes']);
    expect(codes({ ...base, sections: [section([{ ...text, animate: { y: [{ t: '$nope', v: 0 }] } }])] })).toEqual([
      'invalid_keyframes',
    ]);
    expect(
      codes({
        ...base,
        global: { motion: { springs: { limp: { stiffness: 2000, damping: 2 } } } },
        sections: [section([])],
      })
    ).toEqual(['invalid_motion_token']);
  });
});
