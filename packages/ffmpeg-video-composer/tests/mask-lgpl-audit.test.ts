import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { clipBoxSteps } from '@/editor/presets/clip-box';
import { layerMaskSteps, sectionMaskSteps } from '@/editor/presets/mask-composite';
import { matteLegFilters, shapeMaskPlan } from '@/editor/presets/mask-source';
import { sectionMaskFilters } from '@/editor/presets/section-mask';
import type { SugarContext } from '@/editor/presets/sugar-context';
import type { Filter } from '@/core/types';
import { ENGINE_EMITTED_FILTERS } from '@/editor/utils/filter-compat';
import { parseEnabledFilters } from '../scripts/capability-sources';

// The mask half of the LGPL device filter audit (lgpl-filter-audit.test.ts is at its import budget).
// The section shape-mask sugar graph (null / moved-leg source chain) and its box fallback, flattened to names.
function sectionGraphNames(available: boolean): string[] {
  const masks = { available, input: () => 'input:smask', color: (c: string) => c, warn: () => {} };
  const ctx = { duration: 2, scale: '640:360', fps: 25, isVideo: true, masks } as unknown as SugarContext;
  const shape = { type: 'ellipse', cx: 320, cy: 180, rx: 120, ry: 90 } as const;
  const moved = { shape, animate: { x: [{ v: 0 }, { t: 1, v: 80 }] } };
  const section = (mask: unknown) => ({ name: 's', type: 'video', options: { mask }, inputs: [] }) as never;
  const types = (filters: Filter[]): string[] =>
    filters.flatMap((filter) => (filter.graph ? types(filter.graph.flatMap((chain) => chain.filters)) : [filter.type]));

  return [{ shape }, moved].flatMap((mask) => types(sectionMaskFilters(section(mask), ctx)));
}

const here = path.dirname(fileURLToPath(import.meta.url));
const commonSh = fs.readFileSync(path.resolve(here, '../../../scripts/ffmpeg/common.sh'), 'utf8');

describe('LGPL device filter audit: masks', () => {
  let enabled: Set<string>;

  beforeAll(() => {
    enabled = parseEnabledFilters(commonSh);
  });

  // MASK_AUDIT: layer masks (a shape moved by every track, inverted; track mattes in alpha and luma, feathered),
  // a section mask and the clip-box fallback lower to device filters only.
  it('masks and track mattes lower to device-safe filters', () => {
    const animate = {
      x: [{ v: 0 }, { t: 1, v: 80 }],
      y: [{ v: '-20' }, { t: 1, v: '+0' }],
      scale: [{ v: 0 }, { t: 0.6, v: 1.2 }],
      scaleX: [{ v: 1 }, { t: 1, v: 0.5 }],
      scaleY: [{ v: 1 }, { t: 1, v: 2 }],
      rotate: [{ v: 0 }, { t: 1, v: 90 }],
    };
    const shape = { type: 'ellipse', cx: 320, cy: 180, rx: 120, ry: 90 } as const;
    const plan = shapeMaskPlan({ shape, feather: 12, animate }, 'mask0', 25);
    const source = { pad: 'card_ml', overlay: "x='0':y='0'", invert: true, blur: 4 };
    const layer = { base: 'b', leg: 'card_src', overlay: '0:0', source, prefix: 'card.mk_', out: 'card', filters: [] };
    const steps = [
      ...layerMaskSteps(layer),
      ...sectionMaskSteps({ base: 'b', background: '#141416', source, prefix: 'sm.s.mk_', out: 'sm.s.mk_out' }),
      ...clipBoxSteps({ base: 'b', leg: 'l', overlay: '0:0', name: 'card', filters: [] }, { x: 0, y: 0, w: 10, h: 10 }),
      ...clipBoxSteps({ base: 'b', leg: 'l', overlay: '0:0', name: 'card', filters: [] }, null),
    ];
    const legs = [...(plan?.legFilters ?? []), ...matteLegFilters('alpha', ['fps=25']), ...matteLegFilters('luma', [])];
    const names = new Set([
      ...steps.flatMap((step) => step.filters.map((filter) => filter.type)),
      ...legs.map((filter) => filter.split('=')[0]),
    ]);

    const sectionNames = [...sectionGraphNames(true), ...sectionGraphNames(false)];

    expect(sectionNames).toEqual(expect.arrayContaining(['split', 'alphamerge', 'null', 'crop', 'drawbox']));
    for (const name of sectionNames) names.add(name);

    expect(names).toContain('alphamerge');
    expect(names).toContain('colorchannelmixer');
    expect(names).toContain('gblur');

    for (const name of names) {
      expect(enabled.has(name), `masks emit "${name}"`).toBe(true);
      expect(ENGINE_EMITTED_FILTERS as readonly string[], name).toContain(name);
    }
  });
});
