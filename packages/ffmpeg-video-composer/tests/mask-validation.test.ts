import { describe, expect, it } from 'vitest';
import { resolveTimeRefs } from '@/core/timing/resolve';
import { TemplateValidator } from '@/services/TemplateValidator';

type Bag = Record<string, unknown>;

function template(inputs: Bag[], options: Bag = {}): unknown {
  return {
    global: { orientation: 'landscape', musicEnabled: false },
    sections: [{ name: 's', type: 'video', options: { videoUrl: 'videos/clip.mp4', duration: 2, ...options }, inputs }],
  };
}

const card = (options: Bag = {}, name = 'card'): Bag => ({
  name,
  type: 'image',
  url: 'images/card.png',
  options: { position: '0:0', scale: '200:100', ...options },
});
const title: Bag = { name: 'title', type: 'html', html: '<h1>Hi</h1>', width: 400, height: 200, options: {} };
const rect = { type: 'rect', x: 0, y: 0, w: 100, h: 50 };
const errors = (t: unknown) => new TemplateValidator().validateTemplate(t).errors ?? [];
const codes = (t: unknown) => errors(t).map((e) => e.code);

describe('mask validation', () => {
  it('passes a shape mask and a track matte', () => {
    expect(errors(template([card({ mask: { shape: rect, feather: 8 } }), title]))).toEqual([]);
    expect(errors(template([card({ mask: { layer: 'title', mode: 'luma' } }), title]))).toEqual([]);
    expect(errors(template([title], { mask: { layer: 'title', background: '#000000' } }))).toEqual([]);
  });

  // Review Focus 1: a typo'd matte name is an error with the nearest name, not a silent unmasked render.
  it('names the nearest layer for an unknown track matte', () => {
    const [error] = errors(template([card({ mask: { layer: 'titel' } }), title]));

    expect(error).toMatchObject({
      path: 'sections[0].inputs[0].options.mask.layer',
      code: 'mask_layer_unknown',
      suggestion: 'title',
    });
    expect(codes(template([title], { mask: { layer: 'word' } }))).toEqual(['mask_layer_unknown']);
  });

  it('refuses a self matte, a shared matte, a masked matte and a non-layer matte', () => {
    expect(codes(template([card({ mask: { layer: 'card' } })]))).toEqual(['mask_layer_self']);
    expect(
      codes(template([card({ mask: { layer: 'title' } }), card({ mask: { layer: 'title' } }, 'card2'), title]))
    ).toEqual(['mask_layer_shared']);
    expect(
      codes(template([card({ mask: { layer: 'title' } }), { ...title, options: { mask: { shape: rect } } }]))
    ).toEqual(['mask_layer_chained']);
    expect(codes(template([card({ mask: { layer: 'logo' } }), { name: 'logo', url: 'images/logo.png' }]))).toEqual([
      'mask_layer_unknown',
    ]);
  });

  it('refuses a mask on plain media, a mask next to a clip box, and unfillable shapes', () => {
    expect(codes(template([{ name: 'media', url: 'images/x.png', options: { mask: { shape: rect } } }]))).toEqual([
      'mask_not_layer',
    ]);
    expect(codes(template([card({ clip: { x: 0, y: 0, w: 10, h: 10 }, mask: { shape: rect } })]))).toEqual([
      'mask_with_clip',
    ]);
    expect(codes(template([card({ mask: { shape: { ...rect, w: 5000 } } })]))).toEqual(['mask_too_large']);
    expect(codes(template([card({ mask: { shape: { type: 'path', d: 'M0 0 L10 0' } } })]))).toEqual([
      'mask_path_invalid',
    ]);
  });

  it('refuses a mask next to a non-normal blend or a motion blur on the same layer', () => {
    const masked = { mask: { shape: rect } };

    expect(codes(template([card({ ...masked, blend: 'normal' })]))).toEqual([]);
    expect(errors(template([card({ ...masked, blend: 'multiply', motionBlur: true })]))).toMatchObject([
      { path: 'sections[0].inputs[0].options.blend', code: 'mask_with_composite' },
      { path: 'sections[0].inputs[0].options.motionBlur', code: 'mask_with_composite' },
    ]);
  });

  it('checks shape tracks: key order and scale range, never as drawtext tracks', () => {
    const animate = (tracks: Bag) => template([card({ mask: { shape: rect, animate: tracks } })]);

    expect(errors(animate({ scale: [{ v: 0 }, { t: 0.6, v: 1.2 }], x: [{ v: -200 }, { t: 0.5, v: 0 }] }))).toEqual([]);
    expect(
      errors(
        animate({
          scale: [
            { t: 1, v: 0 },
            { t: 0.5, v: 1 },
          ],
        })
      )[0]
    ).toMatchObject({
      path: 'sections[0].inputs[0].options.mask.animate.scale',
      code: 'invalid_keyframes',
    });
    expect(errors(animate({ scale: [{ v: 0 }, { t: 1, v: 20 }] }))[0]?.message).toBe(
      'scale keys take values from 0 to 10 (got 20)'
    );
  });

  // Review Focus 4: a build without alphamerge is told what each mask becomes.
  it('reports mask_unavailable for a build without alphamerge', () => {
    const t = template([card({ mask: { shape: rect } }), card({ mask: { layer: 'title' } }, 'card2'), title]);
    const warnings = (masks: boolean) =>
      new TemplateValidator()
        .getMotionWarnings(t, { textShaping: true, masks })
        .filter((w) => w.code === 'mask_unavailable');

    expect(warnings(true)).toEqual([]);
    expect(warnings(false).map((w) => w.path)).toEqual([
      'sections[0].inputs[0].options.mask',
      'sections[0].inputs[1].options.mask',
    ]);
    expect(warnings(false)[1].message).toContain('both layers draw unmasked');
  });

  // Ruling C6: mask track key times take time references like layer tracks.
  it('resolves a time reference on a mask track to seconds', () => {
    const t = template([
      card({ mask: { shape: rect, animate: { scale: [{ v: 0 }, { t: 'end - 1', v: 1 }] } } }),
      title,
    ]);
    const out = resolveTimeRefs(t as Parameters<typeof resolveTimeRefs>[0]);
    const section = out.descriptor.sections as Bag[];
    const keys = (((section[0].inputs as Bag[])[0].options as Bag).mask as Bag).animate as { scale: Bag[] };

    expect(keys.scale[1].t).toBe(1);
    expect(errors(t)).toEqual([]);
  });
});
