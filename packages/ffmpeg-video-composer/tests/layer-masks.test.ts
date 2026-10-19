import { describe, expect, it, vi } from 'vitest';
import { markBackgroundInput } from '@/editor/utils/background-input';
import { clipBoxSteps } from '@/editor/presets/clip-box';
import {
  layerMaskPlan,
  matteModes,
  matteReaders,
  SECTION_READER,
  stageLayerMasks,
  type LayerMaskEnv,
} from '@/editor/presets/layer-masks';
import { backdrop, stepsAsGraph } from '@/editor/presets/mask-composite';
import { matteBlur, shapeMaskPlan } from '@/editor/presets/mask-source';
import type { SugarContext } from '@/editor/presets/sugar-context';
import type { LayerMask } from '@/schemas/mask.schemas';

const RECT = { type: 'rect', x: 100, y: 50, w: 200, h: 100 } as const;
const IO = { base: 'bg', leg: 'card_src', overlay: '220:130:eof_action=pass', name: 'card', filters: [] };

function ctx(available: boolean) {
  const masks = { available, input: vi.fn(() => 'input:mask1'), color: (c: string) => c, warn: vi.fn() };
  const context = { duration: 2, scale: '640:360', fps: 25, isVideo: true, masks } as SugarContext;

  return { context, masks };
}

const section = (mask: LayerMask) =>
  ({
    name: 's',
    type: 'video',
    inputs: [
      { name: 'plain', type: 'image', url: 'a.png', options: {} },
      { name: 'card', type: 'image', url: 'b.png', options: { mask } },
    ],
  }) as never;

const env = (extra?: number, available = true): LayerMaskEnv => ({
  io: IO,
  position: 0,
  fps: 25,
  frame: [640, 360],
  available,
  extraInput: (key) => (key === 'mask0' ? extra : undefined),
});

describe('staging layer masks', () => {
  it('registers each shape image under mask<position>, and nothing for a track matte', () => {
    const { context, masks } = ctx(true);

    stageLayerMasks(section({ shape: RECT }), context);
    stageLayerMasks(section({ layer: 'plain' }), context);

    expect(masks.input).toHaveBeenCalledTimes(1);
    expect(masks.input).toHaveBeenCalledWith('mask1', {
      url: 'mask:w=202,h=102,f=0,d=M1_1L201_1L201_101L1_101Z',
      still: true,
    });
  });

  it('stages nothing and says how each mask degrades without alphamerge', () => {
    const { context, masks } = ctx(false);

    stageLayerMasks(section({ shape: RECT }), context);

    expect(masks.input).not.toHaveBeenCalled();
    expect(masks.warn).toHaveBeenCalledWith(
      `[mask_unavailable] inputs[1] "card": a shape mask needs alphamerge, absent from this FFmpeg build; it is cut to the mask's resting box`
    );
  });
});

describe('planning a layer mask', () => {
  it('lays a still mask image straight from its input', () => {
    const plan = layerMaskPlan({ shape: RECT }, env(7));

    expect(plan.chains).toEqual([]);
    expect(plan.steps[3]).toMatchObject({
      inputs: ['card.mk_z', '7:v'],
      filters: [
        { type: 'overlay', value: "x='99':y='49':format=rgb" },
        { type: 'format', value: 'gray' },
      ],
    });
    expect(plan.steps.at(-1)?.outputs).toEqual(['card']);
  });

  it('names its pads in a namespace no authored name can produce, so card and card_mk_o cannot collide', () => {
    const pads = layerMaskPlan({ shape: RECT }, env(7)).steps.flatMap((step) => [...step.inputs, ...step.outputs]);
    const own = pads.filter((pad) => !['bg', 'card_src', 'card'].includes(pad) && !/^\d+:v$/.test(pad));

    expect(own.length).toBeGreaterThan(0);
    expect(own.every((pad) => pad.startsWith('card.mk_'))).toBe(true);
    expect(own.some((pad) => /^[A-Za-z0-9_-]+$/.test(pad))).toBe(false);
  });

  it('moves an animated mask on its own leg chain', () => {
    const plan = layerMaskPlan({ shape: RECT, animate: { scale: [{ v: 0 }, { t: 1, v: 1 }] } }, env(7));

    expect(plan.chains).toHaveLength(1);
    expect(plan.chains[0]).toMatch(/^\[7:v\]fps=25,.*\[card.mk_l\]$/);
    expect(plan.steps[3].inputs).toEqual(['card.mk_z', 'card.mk_l']);
  });

  it('falls back to the resting box, or to the plain overlay when inverted, without a staged image', () => {
    expect(layerMaskPlan({ shape: RECT }, env()).steps).toEqual(clipBoxSteps(IO, { x: 98, y: 48, w: 204, h: 104 }));
    expect(layerMaskPlan({ shape: RECT, invert: true }, env()).steps).toEqual([
      { inputs: ['bg', 'card_src'], filters: [{ type: 'overlay', value: IO.overlay }], outputs: ['card'] },
    ]);
  });

  it('never reaches alphamerge when the build lacks it, even with a staged image', () => {
    const plan = layerMaskPlan({ shape: RECT }, env(7, false));

    expect(plan.chains).toEqual([]);
    expect(JSON.stringify(plan.steps)).not.toContain('alphamerge');
    expect(plan.steps).toEqual(clipBoxSteps(IO, { x: 98, y: 48, w: 204, h: 104 }));
  });
});

describe('mask hardening', () => {
  it('clamps a negative feather to no blur', () => {
    expect(matteBlur(-5)).toBeUndefined();
    expect(matteBlur(0)).toBeUndefined();
    expect(matteBlur(5)).toBe(2);
  });

  it('plans a shape with a negative feather like an unfeathered one', () => {
    expect(layerMaskPlan({ shape: RECT, feather: -4 }, env(7))).toEqual(layerMaskPlan({ shape: RECT }, env(7)));
  });

  it('refuses a backdrop colour that is not a safe token', () => {
    expect(backdrop('black')).toEqual({ type: 'drawbox', value: 'x=0:y=0:w=iw:h=ih:color=black:t=fill' });
    expect(() => backdrop('red:t=fill,drawtext=x')).toThrow();
  });

  it('refuses a sub-graph without steps', () => {
    expect(() => stepsAsGraph([])).toThrow(/at least one step/);
  });
});

describe('mask_unavailable index', () => {
  it('names the authored input, skipping the prepended section background', () => {
    const { context, masks } = ctx(false);
    const background = markBackgroundInput({ name: 's', type: 'image', url: 'bg.png', options: {} });
    const authored = { name: 'card', type: 'image', url: 'b.png', options: { mask: { shape: RECT } } };

    stageLayerMasks({ name: 's', type: 'video', inputs: [background, authored] } as never, context);

    expect(masks.warn).toHaveBeenCalledWith(expect.stringContaining('inputs[0] "card"'));
  });
});

describe('track matte layers', () => {
  const withMattes = {
    name: 's',
    type: 'video',
    inputs: [
      { name: 'card', type: 'image', url: 'a.png', options: { mask: { layer: 'hole', mode: 'luma' } } },
      { name: 'badge', type: 'image', url: 'b.png', options: { mask: { layer: 'word' } } },
      { name: 'hole', type: 'image', url: 'c.png', options: {} },
      { name: 'word', type: 'html', html: '<b>Hi</b>', width: 100, height: 50, options: {} },
    ],
  } as never;

  const DRAWN = new Set(['card', 'badge', 'hole', 'word']);

  it('lists each matte layer with how it is read, none when masks are unavailable', () => {
    expect(matteModes(withMattes, true, DRAWN)).toEqual(
      new Map([
        ['hole', 'luma'],
        ['word', 'alpha'],
      ])
    );
    expect(matteModes(withMattes, false, DRAWN)).toEqual(new Map());
  });

  it('ignores a matte or a reader that is not drawn as a layer (plain media would leave the leg unconnected)', () => {
    expect(matteModes(withMattes, true, new Set(['card', 'badge', 'word']))).toEqual(new Map([['word', 'alpha']]));
    expect(matteModes(withMattes, true, new Set(['hole', 'word']))).toEqual(new Map());
  });

  it('hands a shared matte to its first reader only', () => {
    const shared = {
      name: 's',
      type: 'video',
      inputs: [
        { name: 'a', type: 'image', url: 'a.png', options: { mask: { layer: 'hole', mode: 'luma' } } },
        { name: 'b', type: 'image', url: 'b.png', options: { mask: { layer: 'hole' } } },
        { name: 'hole', type: 'image', url: 'c.png', options: {} },
      ],
    } as never;
    const drawn = new Set(['a', 'b', 'hole']);

    expect(matteReaders(shared, drawn)).toEqual(new Map([['hole', 'a']]));
    expect(matteModes(shared, true, drawn)).toEqual(new Map([['hole', 'luma']]));
  });

  it('gives a shared matte to an earlier layer over the section, and to the section when no layer reads it', () => {
    const hole = { name: 'hole', type: 'image', url: 'c.png', options: {} };
    const reader = { name: 'a', type: 'image', url: 'a.png', options: { mask: { layer: 'hole' } } };
    const options = { mask: { layer: 'hole' } };
    const both = { name: 's', type: 'video', options, inputs: [reader, hole] } as never;
    const alone = { name: 's', type: 'video', options, inputs: [hole] } as never;

    expect(matteReaders(both, new Set(['a', 'hole']))).toEqual(new Map([['hole', 'a']]));
    expect(matteReaders(alone, new Set(['hole']))).toEqual(new Map([['hole', SECTION_READER]]));
  });

  it('never reads a layer named after the section reader', () => {
    const named = {
      name: 's',
      type: 'video',
      inputs: [{ name: 'a', type: 'image', url: 'a.png', options: { mask: { layer: SECTION_READER } } }],
    } as never;

    expect(matteReaders(named, new Set(['a']))).toEqual(new Map());
  });

  // A reader that is itself a matte (self, chained, cycle) has no leg to hand on: it draws plain, with a warning.
  it('skips a reader that is its own matte, in a chain or in a cycle', () => {
    const layers = (...masks: Array<[string, string | undefined]>) =>
      ({
        name: 's',
        type: 'video',
        inputs: masks.map(([name, layer]) => ({
          name,
          type: 'image',
          url: `${name}.png`,
          options: layer ? { mask: { layer } } : {},
        })),
      }) as never;
    const drawn = new Set(['a', 'b', 'c']);

    expect(matteReaders(layers(['a', 'a']), drawn)).toEqual(new Map());
    expect(matteReaders(layers(['a', 'b'], ['b', 'c'], ['c', undefined]), drawn)).toEqual(new Map([['b', 'a']]));
    expect(matteReaders(layers(['a', 'b'], ['b', 'a']), drawn)).toEqual(new Map());
    expect(matteModes(layers(['a', 'b'], ['b', 'a']), true, drawn)).toEqual(new Map());
    expect(matteModes(layers(['a', 'a']), true, drawn)).toEqual(new Map());
  });

  it('lays the matte leg on the canvas, blurred when feathered', () => {
    const matte = { pad: 'hole.mt_src', overlay: '270:130:eof_action=pass' };
    const plan = layerMaskPlan({ layer: 'hole', feather: 10 }, { ...env(), matte });

    expect(plan.steps[3]).toEqual({
      inputs: ['card.mk_z', 'hole.mt_src'],
      filters: [
        { type: 'overlay', value: '270:130:eof_action=pass:format=rgb' },
        { type: 'format', value: 'gray' },
        { type: 'gblur', value: 'sigma=4' },
      ],
      outputs: ['card.mk_m'],
    });
  });

  it('draws plainly, never through a two-input null chain, without alphamerge or a registered matte', () => {
    const matte = { pad: 'hole.mt_src', overlay: '270:130:eof_action=pass' };

    for (const e of [{ ...env(undefined, false), matte }, env()]) {
      const steps = layerMaskPlan({ layer: 'hole' }, e).steps;

      expect(JSON.stringify(steps)).not.toContain('alphamerge');
      expect(steps).toEqual([
        { inputs: ['bg', 'card_src'], filters: [{ type: 'overlay', value: IO.overlay }], outputs: ['card'] },
      ]);
    }
  });
});

describe('feathers past the schema maximum (validation skipped)', () => {
  it('clamps a shape feather to 200 px so the mask URL stays loadable', () => {
    const plan = shapeMaskPlan({ shape: RECT, feather: 300 }, 'mask0', 25);

    expect(plan?.url).toMatch(/,f=200,/);
  });

  it('clamps a track matte blur to the largest feather sigma', () => {
    expect(matteBlur(1e6)).toBe(200 / 2.5);
    expect(matteBlur(300)).toBe(200 / 2.5);
  });
});
