import { describe, expect, it } from 'vitest';
import type { Filter } from '@/core/types';
import { designedTransitionGraph } from '@/core/motion/transitions';
import { lowerFx } from '@/editor/presets/fx';
import { graphicToFilters } from '@/editor/presets/graphics';
import { DEVICE_FILTERS } from '@/editor/utils/device-filters.generated';
import { ENGINE_EMITTED_FILTERS } from '@/editor/utils/filter-compat';
import { GraphicSchema } from '@/schemas/graphics.schemas';

// The LGPL device audit (lgpl-filter-audit.test.ts) continued for the motion options that add filters to
// existing graphics and transitions: DEVICE_FILTERS is checked against scripts/ffmpeg/common.sh there.

describe('LGPL device filter audit: glitch tear, iris origin, sheen gloss', () => {
  // GLITCH_TEAR_AUDIT / IRIS_AUDIT / GLOSS_AUDIT: the glitch's row tearing, the iris with an origin and an
  // ease, and the sheen's gloss profile on a flat card lower to device filters only.
  it('glitch tearing, the shaped iris and the gloss sheen lower to device-safe filters', () => {
    const flat = (filters: Filter[]): string[] =>
      filters.flatMap((f) => (f.graph ? f.graph.flatMap((chain) => flat(chain.filters)) : [f.type]));
    const glitch = flat(
      graphicToFilters(GraphicSchema.parse({ type: 'glitch', duration: 0.9, tear: 24 }), {
        width: 640,
        height: 360,
        fps: 25,
      })
    );
    const iris = designedTransitionGraph({
      type: 'iris',
      origin: { x: 0.1, y: 0.15 },
      ease: 'spring(300, 14)',
      left: 'vs0',
      right: 'vs1',
      out: 'v0',
      id: 'dt0',
      offset: 2,
      duration: 0.6,
      width: 640,
      height: 360,
      fps: 25,
    });
    const irisFilters = [...iris.matchAll(/(?:^|[\];,])([a-z]+)(?=[=[,;]|$)/g)].map((m) => m[1]);
    const graphic = { type: 'fx', effect: 'sheen', profile: 'gloss', target: { x: 40, y: 30, w: 300, h: 100 } };
    const section = { name: 's', type: 'color_background', graphics: [graphic] } as never;
    const gloss = flat(
      lowerFx({
        graphic: graphic as never,
        at: 0.2,
        until: undefined,
        seed: 3,
        index: 0,
        section,
        ctx: {
          duration: 3,
          scale: '640:360',
          fps: 25,
          isVideo: false,
          motion: { energy: 1, seedFor: () => 1, resolveText: () => '' },
          masks: {
            available: true,
            input: (key: string) => `input:${key}`,
            color: (c: string) => c,
            warn: () => undefined,
          },
        },
      })
    );

    expect(new Set(glitch)).toEqual(new Set(['split', 'crop', 'overlay', 'noise', 'rgbashift', 'drawbox']));
    expect(irisFilters).toContain('alphamerge');
    expect(irisFilters).toContain('xfade');
    for (const type of [...glitch, ...gloss]) {
      expect(DEVICE_FILTERS.has(type), `emits "${type}"`).toBe(true);
      expect(ENGINE_EMITTED_FILTERS as readonly string[], type).toContain(type);
    }
    // The transition assembly is not a section filter chain (no compat pass): on the build list is enough.
    for (const type of irisFilters) expect(DEVICE_FILTERS.has(type), `iris emits "${type}"`).toBe(true);
  });
});
