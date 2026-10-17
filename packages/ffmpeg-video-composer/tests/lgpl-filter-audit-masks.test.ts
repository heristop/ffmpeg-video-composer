import { describe, expect, it } from 'vitest';
import type { Filter } from '@/core/types';
import { designedTransitionGraph } from '@/core/motion/transitions';
import { kineticToFilters } from '@/editor/presets/kinetic';
import { DEVICE_FILTERS } from '@/editor/utils/device-filters.generated';
import { ENGINE_EMITTED_FILTERS } from '@/editor/utils/filter-compat';
import type { KineticBlock } from '@/schemas/kinetic.schemas';

// The LGPL device audit (lgpl-filter-audit.test.ts) continued for masks and transitions: clip boxes, the
// bands transition, shaped irises and zoom-through windows lower to filters of the on-device build.

const BOUNDARY = {
  left: 'vs0',
  right: 'vs1',
  out: 'v0',
  id: 'dt0',
  offset: 2,
  duration: 0.8,
  width: 640,
  height: 360,
  fps: 25,
};
const MATTE = { label: '2:v', centre: { x: 300, y: 180 }, scale: 40 };

function graphFilters(graph: string): string[] {
  return [...graph.matchAll(/(?:^|[\];,])([a-z]+)(?=[=[,;]|$)/g)].map((m) => m[1]);
}

describe('LGPL device filter audit: clip boxes, bands, iris shapes, zoom-through windows', () => {
  it('a clipped kinetic block lowers to device-safe section filters', () => {
    const flat = (filters: Filter[]): string[] =>
      filters.flatMap((f) => (f.graph ? f.graph.flatMap((chain) => flat(chain.filters)) : [f.type]));
    const frame = { width: 640, height: 360, fps: 25, duration: 2, seed: 1, energy: 1, text: 'ONE\nTWO' };
    const block = { text: { en: 'ONE\nTWO' }, preset: 'rise', clip: 'line' } as KineticBlock;
    const types = flat(kineticToFilters(block, frame));

    expect(new Set(types)).toEqual(new Set(['split', 'drawtext', 'crop', 'overlay']));
    for (const type of types) {
      expect(DEVICE_FILTERS.has(type), `emits "${type}"`).toBe(true);
      expect(ENGINE_EMITTED_FILTERS as readonly string[], type).toContain(type);
    }
  });

  it('bands, a star iris and a zoom-through window lower to device-safe assembly filters', () => {
    const graphs = [
      designedTransitionGraph({ ...BOUNDARY, type: 'bands', count: 5, angle: -25 }),
      designedTransitionGraph({ ...BOUNDARY, type: 'iris', shape: 'star', matte: MATTE, ease: 'spring(300, 14)' }),
      designedTransitionGraph({ ...BOUNDARY, type: 'zoom-through', matte: MATTE }),
    ];

    expect(graphFilters(graphs[0])).toEqual(expect.arrayContaining(['color', 'rotate', 'loop', 'overlay']));
    expect(graphFilters(graphs[1])).toEqual(expect.arrayContaining(['xfade', 'alphamerge']));
    expect(graphFilters(graphs[2])).toEqual(expect.arrayContaining(['zoompan', 'alphamerge']));
    // The transition assembly is not a section filter chain (no compat pass): on the build list is enough.
    for (const type of graphs.flatMap(graphFilters)) expect(DEVICE_FILTERS.has(type), `emits "${type}"`).toBe(true);
  });
});
