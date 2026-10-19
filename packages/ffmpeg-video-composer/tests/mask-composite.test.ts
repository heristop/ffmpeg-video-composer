import { describe, expect, it } from 'vitest';
import { clipBoxSteps, frameSize } from '@/editor/presets/clip-box';
import { layerKeyframes } from '@/editor/presets/layer-keyframes';
import { layerMaskSteps, sectionMaskSteps, stepsAsGraph } from '@/editor/presets/mask-composite';
import { ALPHA_TO_GREY, legToFilters, matteLegFilters, shapeMaskPlan } from '@/editor/presets/mask-source';

const RECT = { type: 'rect', x: 100, y: 50, w: 200, h: 100 } as const;
const SOURCE = { pad: '7:v', overlay: "x='99':y='49'" };

describe('mask sources', () => {
  it('plans a still shape: its image URL, its resting box, no leg', () => {
    expect(shapeMaskPlan({ shape: RECT }, 'mask0', 25)).toEqual({
      key: 'mask0',
      url: 'mask:w=202,h=102,f=0,d=M1_1L201_1L201_101L1_101Z',
      box: { x: 99, y: 49, w: 202, h: 102 },
      legFilters: [],
      x: '99',
      y: '49',
    });
    expect(shapeMaskPlan({ shape: { type: 'path', d: 'M0 0 L10 0' } }, 'mask0', 25)).toBeNull();
  });

  it('moves a shape with the layer track machinery, reading plain x keys as offsets', () => {
    const plan = shapeMaskPlan(
      { shape: RECT, animate: { x: [{ v: 0 }, { t: 1, v: 80 }], scale: [{ v: 0 }, { t: 0.5, v: 1 }] } },
      'mask0',
      25
    );
    const direct = layerKeyframes(
      {
        position: '99:49',
        scale: '202:102',
        animate: { x: [{ v: '+0' }, { t: 1, v: '+80' }], scale: [{ v: 0 }, { t: 0.5, v: 1 }] },
      },
      25
    );

    expect(plan?.legFilters).toEqual(direct.legFilters);
    expect(plan?.x).toBe(direct.x);
    expect(plan?.legFilters.some((f) => f.startsWith('scale=') && f.includes('eval=frame'))).toBe(true);
  });

  it('reduces a matte leg to grey: alpha copied into colour and dropped, luma as drawn', () => {
    expect(matteLegFilters('alpha', ['fps=25'])).toEqual(['fps=25', 'format=rgba', ALPHA_TO_GREY, 'format=gbrp']);
    expect(matteLegFilters(undefined, [])).toEqual(['format=rgba', ALPHA_TO_GREY, 'format=gbrp']);
    expect(matteLegFilters('luma', [])).toEqual(['null']);
    expect(matteLegFilters('luma', ['scale=10:10'])).toEqual(['scale=10:10']);
  });

  it('turns leg strings into engine filters', () => {
    expect(legToFilters(['fps=25', "rotate=a='(t)*PI/180':c=black@0", 'hflip'])).toEqual([
      { type: 'fps', value: '25' },
      { type: 'rotate', value: "a='(t)*PI/180':c=black@0" },
      { type: 'hflip' },
    ]);
  });
});

describe('masked composites', () => {
  it('draws the layer on one copy, lays the mask on a black canvas from another, merges and lays it back', () => {
    const steps = layerMaskSteps({
      base: 'bg',
      leg: 'card_src',
      overlay: '220:130:eof_action=pass',
      source: SOURCE,
      prefix: 'card_',
      out: 'card',
      filters: [{ type: 'null' }],
    });

    expect(steps).toEqual([
      { inputs: ['bg'], filters: [{ type: 'split', value: '3' }], outputs: ['card_o', 'card_d', 'card_k'] },
      {
        inputs: ['card_d', 'card_src'],
        filters: [{ type: 'overlay', value: '220:130:eof_action=pass' }],
        outputs: ['card_c'],
      },
      {
        inputs: ['card_k'],
        filters: [
          { type: 'format', value: 'gray' },
          { type: 'lutyuv', value: 'y=0' },
        ],
        outputs: ['card_z'],
      },
      {
        inputs: ['card_z', '7:v'],
        filters: [
          { type: 'overlay', value: "x='99':y='49':format=rgb" },
          { type: 'format', value: 'gray' },
        ],
        outputs: ['card_m'],
      },
      { inputs: ['card_c', 'card_m'], filters: [{ type: 'alphamerge' }], outputs: ['card_a'] },
      {
        inputs: ['card_o', 'card_a'],
        filters: [{ type: 'overlay', value: '0:0' }, { type: 'null' }],
        outputs: ['card'],
      },
    ]);
  });

  it('blurs a feathered matte and inverts on the canvas', () => {
    const steps = layerMaskSteps({
      base: 'bg',
      leg: 'l',
      overlay: '0:0',
      source: { ...SOURCE, blur: 4, invert: true },
      prefix: 'p_',
      out: 'p',
      filters: [],
    });

    expect(steps[3].filters.slice(1)).toEqual([
      { type: 'format', value: 'gray' },
      { type: 'gblur', value: 'sigma=4' },
      { type: 'lutyuv', value: 'y=negval' },
    ]);
  });

  it('refuses a pad label that is not a safe pad name', () => {
    expect(() =>
      layerMaskSteps({
        base: 'bg',
        leg: 'l]x[',
        overlay: '0:0',
        source: SOURCE,
        prefix: 'p_',
        out: 'p',
        filters: [],
      })
    ).toThrow();
  });

  it('masks a section clip over a solid backdrop, as maps or as one sub-graph', () => {
    const steps = sectionMaskSteps({ base: 'bg', background: '#141416', source: SOURCE, prefix: 'sm_', out: 'out' });

    expect(steps[1]).toEqual({
      inputs: ['sm_o'],
      filters: [{ type: 'drawbox', value: 'x=0:y=0:w=iw:h=ih:color=#141416:t=fill' }],
      outputs: ['sm_b'],
    });
    expect(steps.at(-1)).toEqual({
      inputs: ['sm_b', 'sm_a'],
      filters: [{ type: 'overlay', value: '0:0' }],
      outputs: ['out'],
    });

    const source = { inputs: ['input:smask'], filters: [{ type: 'null' }], outputs: ['sm_l'] };
    const graph = stepsAsGraph(steps, [source]).graph ?? [];

    expect(graph[0]).toEqual({ filters: [{ type: 'split', value: '3' }], outputs: ['sm_o', 'sm_d', 'sm_k'] });
    expect(graph[1]).toEqual(source);
    expect(graph.at(-1)).toEqual({ inputs: ['sm_b', 'sm_a'], filters: [{ type: 'overlay', value: '0:0' }] });
  });

  it('keeps the clip-box maps MapManager emitted before', () => {
    const io = { base: 'bg', leg: 'card_src', overlay: '220:130', name: 'card', filters: [] };

    expect(clipBoxSteps(io, { x: 220, y: 200, w: 200, h: 100 })).toEqual([
      { inputs: ['bg'], filters: [{ type: 'split', value: '2' }], outputs: ['card_cb', 'card_cd'] },
      {
        inputs: ['card_cd', 'card_src'],
        filters: [
          { type: 'overlay', value: '220:130' },
          { type: 'crop', value: '200:100:220:200' },
        ],
        outputs: ['card_cc'],
      },
      { inputs: ['card_cb', 'card_cc'], filters: [{ type: 'overlay', value: '220:200' }], outputs: ['card'] },
    ]);
    // A box off the frame still consumes the registered leg: an overlay that never enables.
    expect(clipBoxSteps(io, null)).toEqual([
      { inputs: ['bg', 'card_src'], filters: [{ type: 'overlay', value: '0:0:enable=0' }], outputs: ['card'] },
    ]);
    expect(frameSize('640:360')).toEqual([640, 360]);
    expect(frameSize('')).toEqual([Infinity, Infinity]);
  });
});
