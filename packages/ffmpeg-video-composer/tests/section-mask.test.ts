import { describe, expect, it, vi } from 'vitest';
import { matteModes, matteReaders } from '@/editor/presets/layer-masks';
import { sectionMaskFilters, sectionMatteSteps } from '@/editor/presets/section-mask';
import { SUGAR_COMPILERS } from '@/editor/presets/registry';
import type { SugarContext } from '@/editor/presets/sugar-context';
import type { Filter } from '@/core/types';
import { renderFilterGraph } from '@/editor/utils/filter-graph';

const ELLIPSE = { type: 'ellipse', cx: 320, cy: 180, rx: 120, ry: 90 } as const;

function ctx(available: boolean) {
  const masks = {
    available,
    input: vi.fn((key: string) => `input:${key}`),
    color: vi.fn((c: string) => `safe(${c})`.replace(/[^#A-Za-z0-9@._]/g, '')),
    warn: vi.fn(),
  };

  return { context: { duration: 2, scale: '640:360', fps: 25, isVideo: true, masks } as SugarContext, masks };
}

const section = (mask: unknown, inputs: unknown[] = []) =>
  ({ name: 's', type: 'video', options: { videoUrl: 'v.mp4', mask }, inputs }) as never;
const types = (filters: Filter[]) => (filters[0]?.graph ?? []).flatMap((chain) => chain.filters.map((f) => f.type));

describe('section masks', () => {
  it('lowers a shape to one sub-graph reading the staged mask image', () => {
    const { context, masks } = ctx(true);
    const filters = sectionMaskFilters(section({ shape: ELLIPSE, background: '#141416' }), context);
    const graph = filters[0].graph ?? [];

    expect(masks.input).toHaveBeenCalledWith('smask', {
      url: expect.stringMatching(/^mask:w=242,h=182,/),
      still: true,
    });
    expect(graph[0]).toEqual({ filters: [{ type: 'split', value: '3' }], outputs: ['sm.s.o', 'sm.s.d', 'sm.s.k'] });
    expect(graph[1]).toEqual({ inputs: ['input:smask'], filters: [{ type: 'null' }], outputs: ['sm.s.l'] });
    expect(types(filters)).toContain('alphamerge');
  });

  it('draws the backdrop in the sanitised background colour', () => {
    const { context, masks } = ctx(true);
    const graph = sectionMaskFilters(section({ shape: ELLIPSE, background: '{{ BG }}' }), context)[0].graph ?? [];

    expect(masks.color).toHaveBeenCalledWith('{{ BG }}');
    expect(graph.flatMap((chain) => chain.filters).find((f) => f.type === 'drawbox')?.value).toBe(
      'x=0:y=0:w=iw:h=ih:color=safeBG:t=fill'
    );
  });

  it('falls back to the resting box without alphamerge, and says so', () => {
    const { context, masks } = ctx(false);
    const filters = sectionMaskFilters(section({ shape: ELLIPSE }), context);

    expect(types(filters)).toEqual(['split', 'drawbox', 'crop', 'overlay']);
    expect(types(filters)).not.toContain('alphamerge');
    expect(masks.input).not.toHaveBeenCalled();
    expect(masks.warn).toHaveBeenCalledWith(expect.stringMatching(/^\[mask_unavailable\] options\.mask: a shape mask/));
    expect(sectionMaskFilters(section({ shape: ELLIPSE, invert: true }), context)).toEqual([]);
  });

  it('draws a track matte section unmasked without alphamerge, with no filters at all', () => {
    const { context, masks } = ctx(false);

    expect(sectionMaskFilters(section({ layer: 'word' }), context)).toEqual([]);
    expect(masks.warn).toHaveBeenCalledWith(expect.stringMatching(/track matte needs alphamerge|a track matte needs/));
  });

  it('leaves a track matte to the maps, and counts its layer as a matte', () => {
    const { context } = ctx(true);
    const word = { name: 'word', type: 'html', html: '<b>Hi</b>', width: 640, height: 360, options: {} };
    const drawn = new Set(['word']);
    const luma = section({ layer: 'word', mode: 'luma' }, [word]);

    expect(sectionMaskFilters(luma, context)).toEqual([]);
    expect(matteReaders(luma, drawn).size).toBe(1);
    expect(matteModes(luma, true, drawn)).toEqual(new Map([['word', 'luma']]));
    expect(matteModes(luma, false, drawn)).toEqual(new Map());
    expect(matteModes(luma, true, new Set())).toEqual(new Map());
  });
});

describe('section track matte steps', () => {
  const matte = { pad: 'word.mt_src', overlay: '0:0:eof_action=pass' };
  const request = { mask: { layer: 'word', feather: 10 }, matte, base: 'base_pad', background: '#202020' };

  it('composites the clip through the matte over the given base, out as one pad', () => {
    const steps = sectionMatteSteps(request as never);

    expect(steps[0]).toMatchObject({ inputs: ['base_pad'], filters: [{ type: 'split', value: '3' }] });
    expect(steps.at(-1)?.outputs).toEqual(['sm.s.mk_out']);
    expect(steps.flatMap((s) => s.filters).find((f) => f.type === 'drawbox')?.value).toContain('color=#202020');
    expect(steps.flatMap((s) => s.filters).some((f) => f.type === 'gblur')).toBe(true);
  });

  it('refuses a colour that would leave the option', () => {
    expect(() => sectionMatteSteps({ ...request, background: 'red:t=fill,x' } as never)).toThrow();
  });
});

describe('mask sugar order', () => {
  it('is the last background sugar, at order 50', () => {
    const background = SUGAR_COMPILERS.filter((compiler) => compiler.layer === 'background');
    const mask = background.find((compiler) => compiler.key === 'mask');

    expect(mask?.order).toBe(50);
    expect(Math.max(...background.map((compiler) => compiler.order))).toBe(50);
  });
});

describe('rendering the section mask graphs', () => {
  const text = (filter: Filter): string =>
    filter.value === undefined ? filter.type : `${filter.type}=${filter.value}`;

  it.each([true, false])('renders the sub-graph through renderFilterGraph (alphamerge %s)', (available) => {
    const { context } = ctx(available);
    const filters = sectionMaskFilters(section({ shape: ELLIPSE }), context);
    const rendered = renderFilterGraph(filters[0].graph ?? [], text, () => 5);

    expect(rendered).toContain('[sm.s.');
  });
});
