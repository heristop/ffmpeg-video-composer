import { describe, expect, it } from 'vitest';
import { LayerMaskSchema, SectionMaskSchema } from '@/schemas/mask.schemas';
import { ColorBackgroundSectionSchema, InputOptionsSchema, VideoSectionSchema } from '@/schemas/section.schemas';

const ok = (mask: unknown) => LayerMaskSchema.safeParse(mask).success;
const rect = { type: 'rect', x: 10, y: 20, w: 300, h: 200, radius: 24 };

describe('mask schema', () => {
  it('takes a rect, an ellipse or a path shape, with invert, feather and shape tracks', () => {
    expect(ok({ shape: rect })).toBe(true);
    expect(ok({ shape: { type: 'ellipse', cx: 320, cy: 180, rx: 120, ry: 90 }, feather: 24, invert: true })).toBe(true);
    expect(
      ok({
        shape: { type: 'path', d: 'M10 10 l100 0 l0 100 z' },
        origin: 'top-left',
        animate: {
          scale: [{ v: 0 }, { t: 0.6, v: 1.2 }],
          rotate: [{ v: 0 }, { t: 1, v: 90 }],
          x: [{ v: '-200' }, { t: 0.5, v: 0 }],
        },
      })
    ).toBe(true);
  });

  it('takes a track matte by layer name, read as alpha or luma', () => {
    expect(ok({ layer: 'title' })).toBe(true);
    expect(ok({ layer: 'title', mode: 'luma', invert: true, feather: 8 })).toBe(true);
  });

  it('refuses both sources, no source, and fields of the other source', () => {
    expect(ok({ shape: rect, layer: 'title' })).toBe(false);
    expect(ok({ invert: true })).toBe(false);
    expect(ok({ shape: rect, mode: 'luma' })).toBe(false);
    expect(ok({ layer: 'title', animate: { x: [{ v: 0 }] } })).toBe(false);
    expect(ok({ layer: 'title', origin: 'center' })).toBe(false);
  });

  it('bounds the path and the feather, and keeps layer names to plain identifiers', () => {
    expect(ok({ shape: { type: 'path', d: `M0 0${' L1 1'.repeat(1000)}` } })).toBe(false);
    expect(ok({ shape: { type: 'path', d: 'M0 0 A10 10 0 0 1 20 20 Z' } })).toBe(false);
    expect(ok({ shape: rect, feather: 201 })).toBe(false);
    expect(ok({ shape: { ...rect, w: 0 } })).toBe(false);
    expect(ok({ layer: 'card];[0:v]drawtext' })).toBe(false);
    expect(ok({ layer: 'my title' })).toBe(false);
  });

  it('bounds shape coordinates like a clip box', () => {
    expect(ok({ shape: { ...rect, x: 20001 } })).toBe(false);
    expect(ok({ shape: { ...rect, w: 20001 } })).toBe(false);
    expect(ok({ shape: { ...rect, radius: 20001 } })).toBe(false);
    expect(ok({ shape: { type: 'ellipse', cx: -20001, cy: 0, rx: 5, ry: 5 } })).toBe(false);
    expect(ok({ shape: { type: 'ellipse', cx: 0, cy: 0, rx: 20001, ry: 5 } })).toBe(false);
  });

  it('sits on layer options and on video sections, not on other section types', () => {
    expect(InputOptionsSchema.safeParse({ position: '0:0', mask: { shape: rect } }).success).toBe(true);

    const video = (mask: unknown) =>
      VideoSectionSchema.safeParse({ name: 'v', type: 'video', options: { videoUrl: 'videos/clip.mp4', mask } })
        .success;
    const color = (options: unknown) =>
      ColorBackgroundSectionSchema.safeParse({ name: 'c', type: 'color_background', options }).success;

    expect(video({ layer: 'word', mode: 'luma', background: '$color.bg' })).toBe(true);
    expect(color({})).toBe(true);
    expect(color({ mask: { shape: rect } })).toBe(false);
  });

  it('takes the section background only as a colour token', () => {
    const bg = (background: string) => SectionMaskSchema.safeParse({ shape: rect, background }).success;

    expect(bg('#141416')).toBe(true);
    expect(bg('$color.surface')).toBe(true);
    expect(bg('{{ BRAND }}@0.5')).toBe(true);
    expect(bg('black:enable=0')).toBe(false);
    expect(bg("red,drawtext=text='x'")).toBe(false);
    expect(LayerMaskSchema.safeParse({ shape: rect, background: '#000000' }).success).toBe(false);
  });
});
