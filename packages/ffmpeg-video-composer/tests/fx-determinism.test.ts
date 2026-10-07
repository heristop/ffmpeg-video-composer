import { describe, expect, it } from 'vitest';
import type { FilterGraphChain } from '@/core/types';
import { lightInTarget, type AnyFxContext } from '@/editor/presets/fx-kit';
import { FX_EFFECTS } from '@/editor/presets/fx-registry';
import type { FxEffectName } from '@/schemas/fx.schemas';

// Every fx primitive, on every capability path, lowers to sources that are pure functions of their options:
// a `gradients` source seeds itself from the clock unless `seed` is set, and replaces any endpoint outside
// its size with a random one. And the section frame enters the sub-graph opaque (see fx-kit OPAQUE): FFmpeg's
// overlay onto a main that carries alpha is slice-thread racy.

const FRAME = { width: 1280, height: 720, fps: 30 };

function context(effect: FxEffectName, has: (filter: string) => boolean, graphic = {}): AnyFxContext {
  return {
    graphic: { type: 'fx', effect, ...graphic },
    target: { x: 200, y: 120, w: 400, h: 240, radius: 16, mask: 'rounded' },
    frame: FRAME,
    at: 0.5,
    duration: 0.75,
    passes: 1,
    every: 1.95,
    end: 1.25,
    ease: 'cubic-bezier(0.45, 0, 0.2, 1)',
    color: '#FFF8EE',
    peak: 0.12,
    energy: 1,
    reduced: false,
    seed: 42,
    random: () => 0.5,
    prefix: 'fx0_',
    has,
    sprite: (key) => `input:fx0_${key}`,
  } as AnyFxContext;
}

function text(graph: FilterGraphChain[]): string {
  return graph.map((chain) => chain.filters.map((f) => `${f.type}=${String(f.value ?? '')}`).join(',')).join(';');
}

function lowered(effect: FxEffectName, has: (filter: string) => boolean, graphic = {}): string {
  const fx = context(effect, has, graphic);
  const layers = (FX_EFFECTS[effect] as { lower: (fx: AnyFxContext) => unknown }).lower(fx);

  return layers ? text(lightInTarget(fx, layers as never) ?? []) : '';
}

function option(source: string, key: string): number {
  return Number(new RegExp(`(?:^|:)${key}=(-?[\\d.]+)`).exec(source)?.[1] ?? NaN);
}

const PATHS: [string, (filter: string) => boolean][] = [
  ['full build', () => true],
  ['no vignette', (filter) => filter !== 'vignette'],
];
const FOCI = [{}, { focus: { x: 0, y: 0 } }, { focus: { x: 1, y: 1 } }, { focus: { x: 0.9, y: 0.1 } }];

describe('fx determinism', () => {
  const effects = Object.keys(FX_EFFECTS) as FxEffectName[];

  it.each(PATHS)('pins every gradients source (%s): a seed, and endpoints inside its size', (_, has) => {
    const sources = effects
      .flatMap((effect) => FOCI.map((graphic) => lowered(effect, has, graphic)))
      .flatMap((graph) => graph.split(/[,;]/).filter((filter) => filter.startsWith('gradients=')));

    expect(sources.length).toBeGreaterThan(0);

    for (const source of sources) {
      const [w, h] = (/s=(\d+)x(\d+)/.exec(source) ?? []).slice(1).map(Number);

      expect(source).toMatch(/:seed=\d+/);

      for (const [key, size] of [
        ['x0', w],
        ['x1', w],
        ['y0', h],
        ['y1', h],
      ] as const) {
        const value = option(source.slice('gradients='.length), key);

        expect(value, `${key} in ${source}`).toBeGreaterThanOrEqual(0);
        expect(value, `${key} in ${source}`).toBeLessThan(size);
      }
    }
  });

  it('pins the section frame opaque before the sub-graph splits it', () => {
    for (const effect of effects) {
      const graph = lowered(effect, () => true);

      if (graph) expect(graph, effect).toMatch(/^format=yuv420p,split=2/);
    }
  });
});
