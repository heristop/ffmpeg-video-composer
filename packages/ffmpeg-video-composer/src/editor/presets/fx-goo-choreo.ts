// The goo fx's default choreography (fx-goo-plan.ts): one blob pops in (a single overshoot, ≤ 8 %), 1–4
// droplets stretch out of it along an axis and bounce apart (the split ease overshoots ~5 %), drift a little,
// run back so every droplet merges on the same frame, the whole blob holds, then shrinks away. Every blob is
// x / y / r keyframe tracks in target px, so the lowering and the preview treat it like authored blobs.

import type { EasingSpec } from '@/core/motion/easing';
import type { TrackKey } from '@/core/motion/tracks';
import type { FxGraphicOf } from '../../schemas/fx.schemas';
import type { GooBlob } from './fx-goo-plan';

type Graphic = FxGraphicOf<'goo'>;

/** Pop in: one overshoot of ~6 %, settled within the pop. */
export const GOO_POP_EASE = 'cubic-bezier(0.3, 1.45, 0.55, 1)';
/** Shrinking away: accelerates out, short. */
const VANISH_EASE = 'cubic-bezier(0.5, 0, 0.75, 0)';
/** Running back together: a firm start, landing on the merge frame. */
const MERGE_EASE = 'cubic-bezier(0.55, 0, 0.3, 1)';
/** How much farther a settled droplet drifts before running back (share of its travel), and how. */
const DRIFT = 0.06;
const DRIFT_EASE = 'cubic-bezier(0.4, 0, 0.6, 1)';
/** Droplet radii relative to the main blob, nearest first. */
const DROPLET_SIZES = [0.62, 0.48, 0.38, 0.3];

/** Settled droplets sit this many radii-sums apart: past the goo reach (≈ 1.35 at the default threshold). */
const SEPARATION = 1.5;
/** Pass fractions of the choreography. */
const BEAT = { popped: 0.1, split: 0.42, merge: 0.56, merged: 0.84, vanish: 0.92, stagger: 0.03 };

export interface Choreo {
  at: number;
  duration: number;
  passes: number;
  every: number;
  ease: EasingSpec;
  random: () => number;
}

interface Split {
  cx: number;
  cy: number;
  ux: number;
  uy: number;
  main: number;
  droplets: Array<{ r: number; d: number }>;
  pop: boolean;
}

// The split's geometry; seeded draws in a fixed order: droplet count, side, angle jitter, distance jitters.
function splitOf(g: Graphic, w: number, h: number, random: () => number): Split {
  const count = g.droplets ?? 2 + (random() < 0.5 ? 1 : 0);
  const side = random() < 0.5 ? 0 : 180;
  const angle = ((g.angle ?? side + (random() - 0.5) * 30) * Math.PI) / 180;
  const [ux, uy] = [Math.cos(angle), Math.sin(angle)];
  const main = (g.size ?? 0.14) * Math.min(w, h);
  const sizes = DROPLET_SIZES.slice(0, count).map((share) => share * main);
  const last = sizes.at(-1) as number;
  // The farthest droplet (with its overshoot and drift) stays inside the target.
  const room = Math.min(
    Math.abs(ux) > 1e-6 ? (w / 2 - last) / Math.abs(ux) : Infinity,
    Math.abs(uy) > 1e-6 ? (h / 2 - last) / Math.abs(uy) : Infinity
  );
  const travel = Math.min((g.spread ?? 0.3) * w, room / 1.12);
  // Evenly spaced along the travel, but never closer than the goo reach to the blob before (they would stay
  // fused), unless the target has no room for that.
  const droplets: Array<{ r: number; d: number }> = [];

  for (const [j, r] of sizes.entries()) {
    const before = j === 0 ? { r: main * 0.84, d: 0 } : droplets[j - 1];
    const spaced = travel * ((j + 1) / count) * (0.94 + random() * 0.12);
    const clear = before.d + SEPARATION * (before.r + r);

    droplets.push({ r, d: Math.min(Math.max(spaced, clear), room / 1.12) });
  }

  return {
    cx: w / 2,
    cy: h / 2,
    ux,
    uy,
    main,
    droplets,
    pop: g.pop ?? true,
  };
}

function key(t: number, v: number, ease?: EasingSpec): TrackKey {
  return ease ? { t, v, ease } : { t, v };
}

// One pass's keys of every blob (main first), at pass start p0.
function passKeys(split: Split, c: Choreo, p0: number): Array<{ x: TrackKey[]; y: TrackKey[]; r: TrackKey[] }> {
  function at(share: number): number {
    return p0 + share * c.duration;
  }

  // A radius track opens from nothing and closes back to it when the blob pops.
  function ends(r: number, keys: TrackKey[]): TrackKey[] {
    if (!split.pop) return [key(at(0), r), ...keys];

    return [key(at(0), 0), ...keys, key(at(BEAT.vanish), r), key(at(1), 0, VANISH_EASE)];
  }

  const { cx, cy, ux, uy, main } = split;
  const recoil = 0.1 * (split.droplets[0]?.d ?? 0);
  const mainTrack = {
    x: [
      key(at(BEAT.popped), cx),
      key(at(BEAT.split), cx - recoil * ux, c.ease),
      key(at(BEAT.merge), cx - recoil * ux),
      key(at(BEAT.merged), cx, MERGE_EASE),
    ],
    y: [
      key(at(BEAT.popped), cy),
      key(at(BEAT.split), cy - recoil * uy, c.ease),
      key(at(BEAT.merge), cy - recoil * uy),
      key(at(BEAT.merged), cy, MERGE_EASE),
    ],
    r: ends(main, [
      key(at(BEAT.popped), main, split.pop ? GOO_POP_EASE : undefined),
      key(at(BEAT.split), main * 0.84, c.ease),
      key(at(BEAT.merge), main * 0.84),
      key(at(BEAT.merged), main, MERGE_EASE),
    ]),
  };
  const drops = split.droplets.map((drop, j) => {
    const leave = at(BEAT.popped + j * BEAT.stagger);
    // The farthest droplet starts back first, so every droplet lands on the merge frame.
    const back = at(BEAT.merge - j * BEAT.stagger);
    const [x, y] = [cx + drop.d * ux, cy + drop.d * uy];
    // Settled apart, a droplet keeps drifting a little: liquid never freezes.
    const [dx, dy] = [x + DRIFT * drop.d * ux, y + DRIFT * drop.d * uy];

    return {
      x: [
        key(leave, cx),
        key(at(BEAT.split), x, c.ease),
        key(back, dx, DRIFT_EASE),
        key(at(BEAT.merged), cx, MERGE_EASE),
      ],
      y: [
        key(leave, cy),
        key(at(BEAT.split), y, c.ease),
        key(back, dy, DRIFT_EASE),
        key(at(BEAT.merged), cy, MERGE_EASE),
      ],
      r: ends(drop.r * 0.5, [
        key(at(BEAT.popped), drop.r * 0.5, split.pop ? GOO_POP_EASE : undefined),
        key(at(BEAT.split), drop.r, c.ease),
        key(back, drop.r),
        key(at(BEAT.merged), drop.r * 0.5, MERGE_EASE),
      ]),
    };
  });

  return [mainTrack, ...drops];
}

/** The choreography's blobs over every pass, in target px. */
export function choreography(g: Graphic, box: { w: number; h: number }, c: Choreo): GooBlob[] {
  const split = splitOf(g, box.w, box.h, c.random);
  const starts = Array.from({ length: c.passes }, (_, i) => c.at + i * c.every);
  const passes = starts.map((p0) => passKeys(split, c, p0));

  return passes[0].map((_, b) => {
    function join(axis: 'x' | 'y' | 'r'): TrackKey[] {
      return passes.flatMap((pass) => pass[b][axis]);
    }

    const first = passes[0][b];

    return {
      x: { base: Number(first.x[0].v), keys: join('x') },
      y: { base: Number(first.y[0].v), keys: join('y') },
      r: { base: Number(first.r[0].v), keys: join('r') },
    };
  });
}
