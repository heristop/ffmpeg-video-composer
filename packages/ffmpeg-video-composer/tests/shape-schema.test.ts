// packages/ffmpeg-video-composer/tests/shape-schema.test.ts
import { describe, expect, it } from 'vitest';
import { GraphicSchema } from '@/schemas/graphics.schemas';
import { motionCatalog } from '@/core/motion/catalog';

// The shape graphic's schema: a preset or a closed SVG d, fill and stroke, layer tracks, and the
// cross-field rules agents read back from validate_template.

const parse = (g: Record<string, unknown>) => GraphicSchema.safeParse({ type: 'shape', ...g });

function messages(g: Record<string, unknown>): string[] {
  const result = parse(g);

  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

describe('shape graphic: schema', () => {
  it('accepts a preset, an SVG d with a viewBox, a gradient, layer tracks and an outline-only draw', () => {
    expect(parse({ preset: { type: 'star', points: 6, inner: 0.4 } }).success).toBe(true);
    expect(
      parse({ d: 'M12 2 L22 22 L2 22 Z', viewBox: [0, 0, 24, 24], x: 100, y: 100, width: 200, height: 200 }).success
    ).toBe(true);
    expect(
      parse({
        preset: { type: 'blob', seed: 4, lobes: 7, wobble: 0.3 },
        gradient: { from: '#9298fb', to: '$color.accent', shape: 'radial' },
      }).success
    ).toBe(true);
    expect(
      parse({
        preset: { type: 'heart' },
        origin: 'bottom',
        animate: { scale: [{ v: 0 }, { t: 0.5, v: 1, ease: 'spring(300, 14)' }] },
      }).success
    ).toBe(true);
    expect(
      parse({ preset: { type: 'rect', radius: 0.5 }, fill: false, stroke: { width: 6, draw: true } }).success
    ).toBe(true);
    expect(
      parse({ preset: { type: 'arrow', direction: 'up', head: 0.5, shaft: 0.3 }, fillRule: 'evenodd' }).success
    ).toBe(true);
  });

  it('needs exactly one of d or preset', () => {
    expect(messages({})).toContain('a shape needs exactly one of `d` or `preset`');
    expect(messages({ d: 'M0 0 L1 1 Z', preset: { type: 'heart' } })).toContain(
      'a shape needs exactly one of `d` or `preset`'
    );
  });

  it('keeps d to the path grammar and its length cap', () => {
    expect(messages({ d: 'M0 0 A 5 5 0 0 1 10 10 Z' })).toContain('`d` takes M, L, H, V, C, Q and Z commands only');
    expect(messages({ d: `M0 0 ${'L1 1 '.repeat(1000)}Z` })).toContain('`d` is longer than 4000 characters');
  });

  it('refuses contradictions between fields', () => {
    expect(messages({ preset: { type: 'star' }, viewBox: [0, 0, 24, 24] })).toContain(
      '`viewBox` maps a `d` into the box; a preset has no viewBox'
    );
    expect(messages({ preset: { type: 'star' }, fill: false })).toContain('a shape with fill: false needs a stroke');
    expect(
      messages({ preset: { type: 'star' }, fill: false, stroke: {}, gradient: { from: '#fff', to: '#000' } })
    ).toContain('`gradient` fills the shape: drop fill: false');
    expect(
      messages({ preset: { type: 'star' }, stroke: { draw: true }, animate: { opacity: [{ v: 0 }, { t: 1, v: 1 }] } })
    ).toContain('stroke.draw reveals the outline in place: drop animate or the draw');
  });

  it('bounds every field: colour tokens, preset parameters, box sizes', () => {
    expect(parse({ preset: { type: 'star' }, color: '#fff;drawtext' }).success).toBe(false);
    expect(parse({ preset: { type: 'star' }, gradient: { from: 'red,blue', to: '#000' } }).success).toBe(false);
    expect(parse({ preset: { type: 'star' }, stroke: { color: "#fff'" } }).success).toBe(false);
    expect(parse({ preset: { type: 'cloud' } }).success).toBe(false);
    expect(parse({ preset: { type: 'star', points: 2 } }).success).toBe(false);
    expect(parse({ preset: { type: 'polygon', sides: 40 } }).success).toBe(false);
    expect(parse({ preset: { type: 'star' }, width: 30000 }).success).toBe(false);
    expect(parse({ preset: { type: 'star' }, stroke: { width: 120 } }).success).toBe(false);
    expect(parse({ d: 'M0 0 L1 1 Z', viewBox: [0, 0, 0, 24] }).success).toBe(false);
  });

  it('is in the motion catalog with an art-direction guide', () => {
    const catalog = motionCatalog();

    expect(catalog.graphics.shape.description).toContain('stroke.draw');
    expect(catalog.graphics.shape.verb).toBe('STAMPS');
  });
});
