import { describe, expect, it } from 'vitest';
import { kineticToFilters, type KineticContext } from '@/editor/presets/kinetic';
import { KineticBlockSchema } from '@/schemas/kinetic.schemas';
import type { Filter } from '@/core/types';

const frame = { width: 640, height: 360, fps: 25, duration: 2, seed: 1, energy: 1, text: 'GO NOW' };

function lowered(
  block: Record<string, unknown>,
  overrides: Partial<KineticContext> = {},
  has = (f: string) => f !== 'nope'
) {
  const warnings: string[] = [];
  const parsed = KineticBlockSchema.parse({ text: { en: 'GO NOW' }, ...block });
  const filters = kineticToFilters(parsed, {
    ...frame,
    blur: { has, warn: (m) => warnings.push(m), prefix: 'kmb0_' },
    ...overrides,
  });

  return { filters, warnings };
}

const sharp = (block: Record<string, unknown>) =>
  kineticToFilters(KineticBlockSchema.parse({ text: { en: 'GO NOW' }, ...block }), frame);

describe('kinetic motion blur', () => {
  it('wraps a travelling block in one graph: sharp branch, supersampled span, overlay back', () => {
    const { filters, warnings } = lowered({ preset: 'slide', motionBlur: { shutter: 180, samples: 4 } });
    const graph = (filters[0] as Filter).graph ?? [];

    expect(filters).toHaveLength(1);
    expect(warnings).toEqual([]);
    expect(graph[0]).toEqual({ filters: [{ type: 'split', value: '2' }], outputs: ['kmb0_s', 'kmb0_b0'] });
    expect(graph[1].filters).toEqual(sharp({ preset: 'slide' }));
    expect(graph[2].filters.map((f) => f.type)).toEqual([
      'trim',
      'fps',
      'settb',
      'setpts',
      ...sharp({ preset: 'slide' }).map((f) => f.type),
      'tmix',
      'setpts',
      'fps',
    ]);
    expect(graph.at(-1)).toEqual({
      inputs: ['kmb0_o', 'kmb0_t0'],
      filters: [{ type: 'overlay', value: '0:0:eof_action=pass' }],
    });
  });

  it('leaves presets that never travel, fills, reduced motion and builds without tmix sharp', () => {
    expect(lowered({ preset: 'fade', motionBlur: true }).filters).toEqual(sharp({ preset: 'fade' }));
    expect(lowered({ preset: 'slide', motionBlur: true }, { energy: 0 }).filters).toEqual(
      kineticToFilters(KineticBlockSchema.parse({ text: { en: 'GO NOW' }, preset: 'slide' }), { ...frame, energy: 0 })
    );

    const noTmix = lowered({ preset: 'slide', motionBlur: true }, {}, (f) => f !== 'tmix');

    expect(noTmix.filters).toEqual(sharp({ preset: 'slide' }));
    expect(noTmix.warnings).toEqual([expect.stringMatching(/^\[motion_blur_unavailable\]/)]);
  });

  it('bounds a wave that bobs to the cut: fewer samples, with a warning', () => {
    const { filters, warnings } = lowered({ preset: 'wave', motionBlur: { samples: 16 } }, { duration: 10, fps: 30 });
    const tmix = (filters[0].graph ?? []).flatMap((chain) => chain.filters).find((f) => f.type === 'tmix');

    expect(tmix).toBeDefined();
    expect(Number(String(tmix?.value).replace('frames=', ''))).toBeLessThan(16);
    expect(warnings[0]).toMatch(/^\[motion_blur_capped\]/);
  });
});
