import { describe, expect, it } from 'vitest';
import { compositeLayer, layerComposite, type LayerCompositeRequest } from '@/editor/presets/layer-composite';
import type { MapAnimationInput } from '@/core/types';

const base: LayerCompositeRequest = {
  name: 'card',
  base: 'card_bg',
  raw: '3:v',
  legFilters: ['scale=200:100', 'setsar=1'],
  overlay: '100:50:eof_action=pass',
  blend: 'normal',
  motionBlur: null,
  animate: undefined,
  fps: 30,
  tail: [],
  has: () => true,
  warn: () => undefined,
};

describe('layerComposite', () => {
  it('leaves a normal, unblurred layer to the plain overlay map', () => {
    expect(layerComposite(base)).toBeNull();
  });

  it('blends a layer as one graph ending in its own pad', () => {
    expect(layerComposite({ ...base, blend: 'multiply' })?.split(';')).toEqual([
      '[3:v]scale=200:100,setsar=1[card_src]',
      '[card_bg]split=3[card_sb0][card_sb1][card_sb2]',
      '[card_sb1]format=gbrap,colorchannelmixer=rr=0:gg=0:bb=0:aa=0[card_scv]',
      '[card_scv][card_src]overlay=100:50:eof_action=pass:format=gbrp[card_sly]',
      '[card_sb2]format=gbrap[card_sba]',
      '[card_sly][card_sba]blend=c0_mode=multiply:c1_mode=multiply:c2_mode=multiply:c3_mode=normal:c3_opacity=1[card_smx]',
      '[card_sb0][card_smx]overlay=0:0:format=auto[card_sharp]',
      '[card_sharp]null[card]',
    ]);
  });

  it('supersamples the moving span on a conformed leg and lays it over the sharp frames', () => {
    const graph = layerComposite({
      ...base,
      legFilters: [],
      overlay: "x='100+300*(t-0.5)':y='50':eof_action=pass",
      motionBlur: { shutter: 180, samples: 8 },
      animate: {
        x: [
          { t: 0.5, v: '+0' },
          { t: 1, v: '+300' },
        ],
      },
    }) as string;
    const chains = graph.split(';');

    expect(chains[0]).toBe('[3:v]split=2[card_cl0][card_cl1]');
    expect(chains[1]).toBe('[card_cl0]null[card_src]');
    expect(chains[2]).toBe(
      "[card_cl1]fps=30,trim=start=0.45:end=1.05,fps=240:round=down,settb=1/86400,setpts='STARTPTS+(floor(N/8)+mod(N,8)*0.0625)/30/TB'[card_lb0]"
    );
    expect(chains).toContain('[card_bg]split=2[card_cb0][card_cb1]');
    expect(chains).toContain("[card_cb0][card_src]overlay=x='100+300*(t-0.5)':y='50':eof_action=pass[card_sharp]");
    expect(chains).toContain("[card_bc0]tmix=frames=8,setpts='STARTPTS+floor(N/8)/30/TB',fps=30[card_bt0]");
    expect(chains).toContain('[card_sharp][card_bt0]overlay=0:0:eof_action=pass[card_mg0]');
    expect(chains.at(-1)).toBe('[card_mg0]null[card]');
  });

  it('drops a leading frame-rate conform from the blurred leg (the head brings its own)', () => {
    const graph = layerComposite({
      ...base,
      legFilters: ['fps=30', "rotate=a='(t)*PI/180':ow=224:oh=224:c=black@0"],
      motionBlur: { shutter: 360, samples: 4 },
      animate: {
        rotate: [
          { t: 0, v: 0 },
          { t: 0.5, v: 90 },
        ],
      },
    }) as string;

    expect(graph).toContain('[card_cl0]fps=30,rotate=');
    expect(graph).toMatch(
      /\[card_cl1\]fps=30,trim=start=0:end=[^,]+,fps=120:round=down,settb=[^,]+,setpts='[^']+',rotate=/
    );
  });

  it('composites normally with a warning when the build has no blend filter', () => {
    const warnings: string[] = [];

    expect(
      layerComposite({ ...base, blend: 'screen', has: (f) => f !== 'blend', warn: (m) => warnings.push(m) })
    ).toBeNull();
    expect(warnings).toEqual([expect.stringMatching(/^\[blend_unavailable\]/)]);
  });

  it('draws sharp with a warning when the build has no tmix', () => {
    const warnings: string[] = [];
    const graph = layerComposite({
      ...base,
      blend: 'screen',
      motionBlur: { shutter: 180, samples: 8 },
      animate: {
        x: [
          { t: 0, v: 0 },
          { t: 1, v: 100 },
        ],
      },
      has: (f) => f !== 'tmix',
      warn: (m) => warnings.push(m),
    }) as string;

    expect(graph).toContain('blend=c0_mode=screen');
    expect(graph).not.toContain('tmix');
    expect(warnings).toEqual([expect.stringMatching(/^\[motion_blur_unavailable\]/)]);
  });

  it('appends the input filters after the composite', () => {
    expect(layerComposite({ ...base, blend: 'add', tail: ['fade=t=out:st=1:d=0.5'] })).toMatch(
      /\[card_sharp\]fade=t=out:st=1:d=0\.5\[card\]$/
    );
  });

  it('throws on an unsafe input name or base pad', () => {
    expect(() => layerComposite({ ...base, blend: 'add', name: 'a]b' })).toThrow(/Unsafe pad label/);
    expect(() => layerComposite({ ...base, blend: 'add', base: 'x;y' })).toThrow(/Unsafe pad label/);
  });

  it('throws on a blend mode that skipValidation let through', () => {
    expect(() => layerComposite({ ...base, blend: 'x]y' as never })).toThrow();
  });

  it('throws on a non-numeric shutter that skipValidation let through', () => {
    expect(() =>
      layerComposite({
        ...base,
        motionBlur: { shutter: '1;x' as never, samples: 8 },
        animate: {
          x: [
            { t: 0, v: 0 },
            { t: 1, v: 100 },
          ],
        },
      })
    ).toThrow();
  });
});

describe('compositeLayer', () => {
  const input = {
    name: 'card',
    type: 'html',
    options: { blend: 'multiply' },
    filters: [{ type: 'fade', value: 't=out:st=1:d=0.5' }],
  } as unknown as MapAnimationInput;
  const filters = {
    frameRate: () => 30,
    supports: () => true,
    advise: () => undefined,
    addFilter: (filter: { type: string; value?: unknown }) => `${filter.type}=${String(filter.value)}`,
  };
  const context = (layer: MapAnimationInput) => {
    const segment = { filtersMapList: ['[0:v]null[card_bg]'], mapsList: ['card_bg'] };

    return {
      segment,
      args: {
        input: layer,
        inputIndex: 3,
        base: 'card_bg',
        legFilters: [],
        overlay: '10:10:eof_action=pass',
        filters,
        segment,
      },
    };
  };

  it('splices the graph and its output pad into the segment, rendering the input filters last', () => {
    const { segment, args } = context(input);

    expect(compositeLayer(args)).toBe(true);
    expect(segment.mapsList).toEqual(['card_bg', 'card']);
    expect(segment.filtersMapList).toHaveLength(2);
    expect(segment.filtersMapList[1].split(';')[0]).toBe('[3:v]null[card_src]');
    expect(segment.filtersMapList[1]).toMatch(/\[card_sharp\]fade=t=out:st=1:d=0\.5\[card\]$/);
  });

  it('leaves a plain layer untouched', () => {
    const { segment, args } = context({ ...input, options: {} } as unknown as MapAnimationInput);

    expect(compositeLayer(args)).toBe(false);
    expect(segment.mapsList).toEqual(['card_bg']);
    expect(segment.filtersMapList).toHaveLength(1);
  });
});
