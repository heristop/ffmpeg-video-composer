// fx "grain": fine, seeded, luma-only film grain (schemas/fx-ambient.schemas.ts for the fields).
//
// A copy of the target region (a kit tap) gets gaussian luma noise (`noise` c0 only, seeded, temporal when
// `animated`) of strength peak × 100, i.e. at most 12 at the 0.12 ceiling (the same texture as a full-strength
// noise copy mixed at that alpha, without its clipping near black), and replaces the picture inside the window:
// blacks, whites and colours keep their levels (no grey wash, unlike a grey noise layer). The default sits just
// above what a crf-23 encode keeps on flat areas. A coarser `size` grains a downscaled copy and scales it back
// (soft clumps, like 16 mm).
// Ambient: soft ramps at both ends of the life; absent under reduced motion; skipped without `noise`.

import type { Filter } from '@/core/types';
import type { FxContext, FxEffect, FxLayer } from './fx-kit';
import { ambientRamps, atFrame, even, fromWindow, withAlpha } from './fx-light-kit';

/** noise strength per unit of peak: the 0.12 ceiling is strength 12. */
const STRENGTH = 100;

function scaled(fx: FxContext<'grain'>, size: number): { down: Filter[]; up: Filter[] } {
  if (size < 1.25) return { down: [], up: [] };

  const { w, h } = fx.target;

  return {
    down: [{ type: 'scale', value: `${even(w / size)}:${even(h / size)}` }],
    up: [{ type: 'scale', value: `${w}:${h}` }],
  };
}

function lower(fx: FxContext<'grain'>): FxLayer[] | null {
  if (fx.reduced) return [];

  if (!fx.has('noise')) return null;

  const g = fx.graphic;
  const p = fx.prefix;
  const size = Math.max(1, atFrame(fx, g.size ?? 1));
  const { down, up } = scaled(fx, size);
  const flags = g.animated === false ? '' : ':c0f=t';
  const filters: Filter[] = [
    fromWindow(fx),
    ...down,
    {
      type: 'noise',
      value: `c0s=${Math.max(1, Math.round(STRENGTH * fx.peak))}${flags}:all_seed=${fx.seed % 2147483647}`,
    },
    ...up,
    ...withAlpha(1),
    ...ambientRamps(fx, g.ramp ?? 0.3),
  ];

  return [
    {
      chains: [{ inputs: [`${p}tap`], filters, outputs: [`${p}gr`] }],
      label: `${p}gr`,
      x: '0',
      y: '0',
      taps: [`${p}tap`],
    },
  ];
}

export const GRAIN: FxEffect<'grain'> = { lower };
