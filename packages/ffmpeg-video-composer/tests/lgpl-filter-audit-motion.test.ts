import { describe, expect, it } from 'vitest';
import type { Filter } from '@/core/types';
import { designedTransitionGraph } from '@/core/motion/transitions';
import { lowerFx } from '@/editor/presets/fx';
import { kineticToFilters } from '@/editor/presets/kinetic';
import { layerComposite } from '@/editor/presets/layer-composite';
import { graphicToFilters } from '@/editor/presets/graphics';
import { DEVICE_FILTERS } from '@/editor/utils/device-filters.generated';
import { ENGINE_EMITTED_FILTERS } from '@/editor/utils/filter-compat';
import { GraphicSchema } from '@/schemas/graphics.schemas';
import { KineticBlockSchema } from '@/schemas/kinetic.schemas';

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

describe('LGPL device filter audit: blend modes and motion blur', () => {
  // LAYER_COMPOSITE_AUDIT: every blend mode, with and without motion blur, lowers to device filters only.
  it('layer blend modes and motion blur lower to device-safe filters', () => {
    const names = (graph: string): string[] =>
      graph.split(';').flatMap((chain) => {
        const body = chain.replace(/^(\[[^\]]+\])+/, '').replace(/(\[[^\]]+\])+$/, '');
        const found: string[] = [];
        let [quoted, depth, start] = [false, 0, 0];

        for (let i = 0; i <= body.length; i++) {
          const c = body[i];

          if (c === "'") quoted = !quoted;

          if (!quoted && c === '(') depth++;

          if (!quoted && c === ')') depth--;

          if (i === body.length || (!quoted && depth === 0 && c === ',')) {
            found.push(body.slice(start, i).split('=')[0]);
            start = i + 1;
          }
        }

        return found;
      });
    const modes = ['multiply', 'screen', 'overlay', 'add', 'darken', 'lighten', 'difference'] as const;
    const graphs = modes.flatMap((blend) =>
      [null, { shutter: 180, samples: 8 }].map((motionBlur) =>
        layerComposite({
          name: 'l',
          base: 'b',
          raw: '2:v',
          legFilters: ['fps=25', 'format=rgba', 'colorchannelmixer=aa=0.5'],
          overlay: "x='10+t':y='0':eof_action=pass",
          blend,
          motionBlur,
          animate: {
            x: [
              { t: 0.5, v: 0 },
              { t: 1, v: 100 },
            ],
          },
          fps: 25,
          tail: [],
          has: (filter) => DEVICE_FILTERS.has(filter),
          warn: () => undefined,
        })
      )
    );
    const emitted = new Set(graphs.flatMap((graph) => names(graph as string)));

    expect(emitted).toContain('blend');
    expect(emitted).toContain('tmix');
    // The late span's lead-in pad: trim + concat, both already built into the engine.
    expect(emitted).toContain('concat');

    for (const name of emitted) {
      expect(DEVICE_FILTERS.has(name), `layer composite emits "${name}"`).toBe(true);
      expect(ENGINE_EMITTED_FILTERS as readonly string[], name).toContain(name);
    }
  });

  // KINETIC_BLUR_AUDIT: a motion-blurred kinetic block lowers to device filters only.
  it('kinetic motion blur lowers to device-safe filters', () => {
    const block = KineticBlockSchema.parse({ text: { en: 'Shine' }, preset: 'slide', motionBlur: true });
    const lowered = kineticToFilters(block, {
      width: 640,
      height: 360,
      fps: 25,
      duration: 2,
      seed: 1,
      energy: 1,
      text: 'Shine',
      blur: { has: (filter) => DEVICE_FILTERS.has(filter), warn: () => undefined, prefix: 'kmb0_' },
    });
    const types = (filters: Filter[]): string[] =>
      filters.flatMap((f) => (f.graph ? f.graph.flatMap((chain) => types(chain.filters)) : [f.type]));
    const emitted = new Set(types(lowered));

    expect(emitted).toContain('tmix');
    expect(emitted).toContain('concat');

    for (const type of emitted) {
      expect(DEVICE_FILTERS.has(type), `kinetic blur emits "${type}"`).toBe(true);
      expect(ENGINE_EMITTED_FILTERS as readonly string[], type).toContain(type);
    }
  });
});
