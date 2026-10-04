import { describe, expect, it } from 'vitest';
import { revealToExpr, applyAnimation } from '@/editor/presets/text';
import { RevealObjectSchema } from '@/schemas/reveal.schemas';
import { evaluateExpr } from '@/services/geometry/drawtext-expr';

describe('native overshoot easing', () => {
  it('accepts the easing and overshoots position while keeping alpha bounded', () => {
    const reveal = RevealObjectSchema.parse({
      type: 'rise',
      delay: 0,
      duration: 1,
      distance: 80,
      easing: 'ease-out-back',
    });
    const expressions = revealToExpr(reveal, { x: 100, y: 200 });
    expect(evaluateExpr(expressions.y, { t: 0 })).toBe(280);
    expect(evaluateExpr(expressions.y, { t: 0.5 })).toBeCloseTo(192.9842, 4);
    expect(evaluateExpr(expressions.alpha, { t: 0.5 })).toBe(1);
    expect(evaluateExpr(expressions.y, { t: 1 })).toBe(200);
    expect(evaluateExpr(expressions.y, { t: 2 })).toBe(200);
  });

  it('does not produce negative or above-one opacity during combined entrance and exit', () => {
    const values: Record<string, unknown> = {};
    applyAnimation(
      values,
      { type: 'slide-left', delay: 0, duration: 1, distance: 80, easing: 'ease-out-back' },
      { type: 'slide-left', after: 2, duration: 1, distance: 80, easing: 'ease-out-back' },
      { x: 100, y: 200 },
      3
    );
    for (let frame = 0; frame <= 120; frame++) {
      const alpha = evaluateExpr(values.alpha, { t: frame / 30 });
      expect(alpha).not.toBeNull();
      expect(alpha).toBeGreaterThanOrEqual(0);
      expect(alpha).toBeLessThanOrEqual(1);
    }
    expect(evaluateExpr(values.alpha, { t: 0.5 })).toBe(1);
    expect(evaluateExpr(values.alpha, { t: 2.5 })).toBe(0);
    expect(evaluateExpr(values.alpha, { t: 3 })).toBe(0);
  });
});
