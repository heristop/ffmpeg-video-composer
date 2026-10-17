// packages/ffmpeg-video-composer/tests/shape-draw.test.ts
import { describe, expect, it } from 'vitest';
import type { Filter, FilterGraphChain } from '@/core/types';
import { assertSafeFilterOptions } from '@/editor/utils/filter-option-guard';
import { lowerShape, toFilter } from '@/editor/presets/shape-draw';
import type { ShapeRequest } from '@/editor/presets/sugar-context';

function request(
  graphic: Record<string, unknown>,
  options: {
    inputs?: Map<string, string>;
    warnings?: string[];
    at?: number;
    until?: number;
    available?: boolean;
    refuse?: boolean;
  } = {}
): ShapeRequest {
  const inputs = options.inputs ?? new Map<string, string>();

  return {
    graphic: { type: 'shape', ...graphic },
    at: options.at ?? 1,
    until: options.until,
    seed: 7,
    index: 0,
    section: { name: 's', type: 'color_background', options: { duration: 3 } },
    ctx: {
      duration: 3,
      scale: '1280:720',
      fps: 30,
      isVideo: false,
      masks: {
        available: options.available ?? true,
        input: (key: string, source: { url: string }) => {
          if (options.refuse) return null;

          inputs.set(key, source.url);

          return `input:${key}`;
        },
        color: (c: string) => c,
        warn: (message: string) => options.warnings?.push(message),
      },
    },
  } as unknown as ShapeRequest;
}

const chainsOf = (filter: Filter): FilterGraphChain[] => filter.graph as FilterGraphChain[];
const flat = (filters: Filter[]): Filter[] =>
  filters.flatMap((f) => (f.graph ? f.graph.flatMap((chain) => flat(chain.filters)) : [f]));

describe('toFilter', () => {
  it('splits a leg string at its first =', () => {
    expect(toFilter("rotate=a='(t)*PI/180':ow=10:oh=10:c=black@0")).toEqual({
      type: 'rotate',
      value: "a='(t)*PI/180':ow=10:oh=10:c=black@0",
    });
    expect(toFilter('hflip')).toEqual({ type: 'hflip' });
  });
});

describe('lowerShape', () => {
  it('overlays the shape image through a fading layer leg, gated from `at`', () => {
    const inputs = new Map<string, string>();
    const filters = lowerShape(request({ preset: { type: 'star' }, duration: 0.5 }, { inputs }));

    expect(filters).toHaveLength(1);

    const chains = chainsOf(filters[0]);

    expect(chains[0]).toEqual({ filters: [{ type: 'null' }], outputs: ['sh0_m'] });
    expect(chains[1].inputs).toEqual(['input:sh0_fill']);
    expect(chains[1].outputs).toEqual(['sh0_s']);
    expect(chains[1].filters[0]).toEqual({ type: 'fps', value: '30' });
    expect(chains[1].filters.map((f) => f.type)).toContain('colorchannelmixer');
    expect(inputs.get('sh0_fill')).toMatch(/^shape:w=280,h=266,rule=nonzero,fill=solid,c1=7c83fdff,/);
    expect(chains[2]).toEqual({
      inputs: ['sh0_m', 'sh0_s'],
      filters: [{ type: 'overlay', value: "x='500':y='214':eof_action=pass:enable='gte(t,1)'" }],
      outputs: undefined,
    });
  });

  it('ends at `until`', () => {
    const [graph] = lowerShape(request({ preset: { type: 'star' } }, { until: 2.5 }));

    expect(chainsOf(graph)[2].filters[0].value).toContain("enable='gte(t,1)*lt(t,2.5)'");
  });

  it('turns and scales about the origin with the layer tracks', () => {
    const [graph] = lowerShape(
      request({
        preset: { type: 'star' },
        origin: 'bottom',
        animate: { rotate: [{ v: -30 }, { t: 1, v: 0 }], scale: [{ v: 0 }, { t: 0.6, v: 1 }] },
      })
    );
    const chains = chainsOf(graph);
    const leg = chains[1].filters;

    expect(leg.map((f) => f.type)).toEqual(expect.arrayContaining(['rotate', 'scale']));
    expect(leg.find((f) => f.type === 'scale' && String(f.value).includes('eval=frame'))).toBeDefined();
    expect(String(chains[2].filters[0].value)).toContain('cos(');
  });

  it('draws the outline on with the path graphic, over the fill', () => {
    const inputs = new Map<string, string>();
    const filters = lowerShape(
      request({ preset: { type: 'heart' }, stroke: { draw: true, color: '#ffffff', width: 6 } }, { inputs })
    );

    expect(filters).toHaveLength(2);
    expect(flat([filters[1]]).map((f) => f.type)).toContain('lutyuv');
    expect([...inputs.keys()]).toEqual(expect.arrayContaining(['sh0_fill', 'gs0_cover', 'gs0_code']));
  });

  it('skips with shape_unavailable when the segment cannot take the image', () => {
    const warnings: string[] = [];

    expect(lowerShape(request({ preset: { type: 'star' } }, { warnings, refuse: true }))).toEqual([]);
    expect(warnings[0]).toMatch(/^\[shape_unavailable\] graphics\[0\] shape: /);
  });

  it('still shows a drawn shape, outline baked, on an engine without alphamerge', () => {
    const warnings: string[] = [];
    const inputs = new Map<string, string>();
    const filters = lowerShape(
      request({ preset: { type: 'heart' }, stroke: { draw: true, width: 6 } }, { warnings, inputs, available: false })
    );

    expect(filters).toHaveLength(1);
    expect(flat(filters).map((f) => f.type)).not.toContain('lutyuv');
    expect(inputs.get('sh0_fill')).toContain(',sw=6,');
    expect(warnings[0]).toMatch(/^\[shape_draw_unavailable\]/);
  });

  it('emits only filters that pass the render-time filter guard', () => {
    const filters = lowerShape(
      request({
        preset: { type: 'blob', seed: 2 },
        gradient: { from: '#9298fb', to: '#f96f99', shape: 'radial' },
        stroke: { width: 4 },
        origin: 'bottom',
        animate: {
          x: [{ v: '-40' }, { t: 0.5, v: '+0', ease: 'spring(300, 14)' }],
          scaleX: [{ v: 1 }, { t: 1, v: 0.8 }],
          rotate: [{ v: -30 }, { t: 1, v: 0 }],
          opacity: [{ v: 0 }, { t: 0.3, v: 1 }],
        },
      })
    );

    for (const filter of flat(filters)) {
      expect(() => assertSafeFilterOptions(filter.type, String(filter.value ?? '')), filter.type).not.toThrow();
    }
  });
});
