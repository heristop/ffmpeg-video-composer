import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { designedTransitionGraph, DESIGNED_TRANSITIONS } from '@/core/motion/transitions';
import { dripProfile } from '@/core/motion/transition-drip';
import { boundaryTransitions } from '@/director/prepare-build';
import { buildVideoGraph } from '@/editor/utils/transition-graph';
import { DEVICE_FILTERS } from '@/editor/utils/device-filters.generated';
import { TransitionSchema } from '@/schemas/effects.schemas';
import type { Section } from '@/core/types';

// The drip transition: a wall of paint runs down over the outgoing scene in drips of seeded lengths, covers
// the frame at the midpoint, then the incoming scene runs down over the paint the same way.

const BOUNDARY = {
  type: 'drip' as const,
  left: 'vs0',
  right: 'vs1',
  out: 'v0',
  id: 'dt0',
  offset: 2,
  duration: 1,
  width: 1280,
  height: 720,
  fps: 30,
};

function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-hide_banner', '-version'], { stdio: 'pipe' });

    return true;
  } catch {
    return false;
  }
}

describe('drip: schema and boundary', () => {
  it('is a designed transition with a colour', () => {
    expect(DESIGNED_TRANSITIONS).toContain('drip');
    expect(TransitionSchema.safeParse({ type: 'drip', color: '#f96f99', duration: 1 }).success).toBe(true);
    expect(TransitionSchema.safeParse({ type: 'drip', color: '$color.accent' }).success).toBe(true);
    expect(TransitionSchema.safeParse({ type: 'drip', color: 12 }).success).toBe(false);
  });

  it('carries the colour to the boundary and defaults it to the theme accent', () => {
    const sections = [{ name: 'a' }, { name: 'b' }] as unknown as Section[];

    expect(boundaryTransitions(sections, { type: 'drip', duration: 0.8, color: '#F96F99' })).toEqual([
      { type: 'drip', duration: 0.8, ease: undefined, color: '#F96F99' },
    ]);
    const [themed] = boundaryTransitions(sections, { type: 'drip', duration: 1 }, true, {
      colors: { accent: '#9298FB' },
    });

    expect(themed).toEqual({ type: 'drip', duration: 1, ease: undefined, color: '#9298FB' });
    // Other transitions are untouched: no colour key, the usual default duration.
    expect(boundaryTransitions(sections, { type: 'iris' }, true, { colors: { accent: '#9298FB' } })).toEqual([
      { type: 'iris', duration: 0.3, ease: undefined },
    ]);
  });
});

describe('drip: lowering', () => {
  it('keeps the existing designed transitions byte-identical', () => {
    for (const type of DESIGNED_TRANSITIONS.filter((name) => name !== 'drip')) {
      const graph = designedTransitionGraph({ ...BOUNDARY, type });

      expect(graph).not.toContain('gradients');
      expect(graph).not.toContain('drip');
    }

    expect(designedTransitionGraph({ ...BOUNDARY, type: 'iris' })).toContain(
      '[dt0tail][dt0in]xfade=transition=circleopen:duration=1:offset=0[dt0mix]'
    );
  });

  it('builds a seeded drip profile: varied lengths, rounded ends, a wall that covers the frame', () => {
    const profile = dripProfile({ width: 1280, height: 720, seed: 7 });
    const lengths = profile.drips.map((drip) => drip.length);

    expect(profile.drips.length).toBeGreaterThanOrEqual(8);
    expect(new Set(lengths.map((length) => Math.round(length / 20))).size).toBeGreaterThanOrEqual(5);
    expect(profile.wall).toBeGreaterThan(720);
    expect(profile.height).toBeGreaterThanOrEqual(profile.wall + Math.max(...lengths));
    expect(profile.height % 2).toBe(0);
    expect(dripProfile({ width: 1280, height: 720, seed: 7 })).toEqual(profile);
    expect(dripProfile({ width: 1280, height: 720, seed: 8 })).not.toEqual(profile);
  });

  it('lowers to one graph: paint and incoming scene each masked by a scaled silhouette', () => {
    const graph = designedTransitionGraph({ ...BOUNDARY, color: '#F96F99' });

    expect(graph).toContain('gradients=s=256x256:c0=white:c1=black:x0=128:y0=128:x1=255:y1=128');
    expect(graph).toContain('color=c=0xF96F99:s=1280x720:r=30:d=1');
    expect(graph).toContain('[dt0in][dt0k2]alphamerge[dt0ia]');
    expect(graph).toContain('[dt0tail][dt0pa]overlay=0:0[dt0s1];[dt0s1][dt0ia]overlay=0:0[dt0mix]');
    expect(graph).toContain(':eval=frame');
    expect(graph.endsWith('[dt0head][dt0mix][dt0rest]concat=n=3:v=1:a=0,settb=AVTB[v0]')).toBe(true);
  });

  it('uses on-device filters only, and is deterministic', () => {
    const graph = designedTransitionGraph({ ...BOUNDARY, color: '#F96F99', ease: 'ease-in-out-cubic' });
    const filters = new Set([...graph.matchAll(/(?:^|[\];,])([a-z]+)(?=[=[,;]|$)/g)].map((m) => m[1]));

    for (const filter of filters) expect(DEVICE_FILTERS.has(filter), filter).toBe(true);
    expect(graph).toBe(designedTransitionGraph({ ...BOUNDARY, color: '#F96F99', ease: 'ease-in-out-cubic' }));
    expect(designedTransitionGraph({ ...BOUNDARY, id: 'dt1' })).not.toEqual(
      designedTransitionGraph(BOUNDARY).replaceAll('dt0', 'dt1')
    );
  });

  it('reaches the assembly through buildVideoGraph with its colour', () => {
    const graph = buildVideoGraph([{ type: 'drip', duration: 1, color: '#123456' }], [2], [1], '[vout]', {
      scale: '1280:720',
      fps: 30,
    });

    expect(graph).toContain('color=c=0x123456:s=1280x720');
  });
});

// Real FFmpeg: a dark outgoing scene, a white incoming one, rose paint.
describe.skipIf(!hasFfmpeg())('drip on real frames', () => {
  const [W, H, FPS] = [640, 360, 30];
  const OFFSET = 0.5;
  const DURATION = 1;

  function frames(): Buffer[] {
    const boundary = { ...BOUNDARY, width: W, height: H, offset: OFFSET, duration: DURATION, color: '#F96F99' };
    const graph =
      `color=c=0x141416:s=${W}x${H}:r=${FPS}:d=2,format=yuv420p,settb=AVTB[vs0];` +
      `color=c=white:s=${W}x${H}:r=${FPS}:d=2,format=yuv420p,settb=AVTB[vs1];` +
      designedTransitionGraph(boundary);
    const raw = execFileSync(
      'ffmpeg',
      ['-v', 'error', '-filter_complex', graph, '-map', '[v0]', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
      { maxBuffer: 1 << 28 }
    );

    return Array.from({ length: raw.length / (W * H) }, (_, i) => raw.subarray(i * W * H, (i + 1) * W * H));
  }

  // Luma of the three surfaces: the dark scene (~20), the rose paint (~140) and the white scene (255).
  const isPaint = (value: number): boolean => value > 100 && value < 190;
  const isDark = (value: number): boolean => value < 50;

  // Per column, how far down the paint reaches (first non-paint row from the top).
  function leadingEdges(frame: Buffer): number[] {
    return Array.from({ length: W }, (_, x) => {
      let y = 0;

      while (y < H && !isDark(frame[y * W + x])) y++;

      return y;
    });
  }

  it('covers partially at 25 %, fully at the midpoint, and lands on the incoming scene', () => {
    const all = frames();
    const start = Math.round(OFFSET * FPS);
    const quarter = all[start + Math.round(0.25 * DURATION * FPS)];
    const mid = all[start + Math.round(0.5 * DURATION * FPS)];
    const end = all[start + DURATION * FPS];

    // 25 %: the top is paint, the bottom still the outgoing scene, drips of several lengths in between.
    const edges = leadingEdges(quarter);
    const covered = quarter.filter(isPaint).length / (W * H);

    expect(covered).toBeGreaterThan(0.12);
    expect(covered).toBeLessThan(0.95);
    expect(isPaint(quarter[2 * W + W / 2])).toBe(true);
    expect(quarter.subarray((H - 2) * W, (H - 1) * W).some(isDark)).toBe(true);
    expect(new Set(edges.map((edge) => Math.round(edge / 8))).size).toBeGreaterThanOrEqual(5);
    // Anti-aliased: intermediate values between the paint and the scene along the edges.
    expect(quarter.some((value) => value > 40 && value < 120)).toBe(true);

    // Midpoint: every pixel is paint.
    expect(mid.every(isPaint), `${mid.filter((value) => !isPaint(value)).length} pixels not covered`).toBe(true);

    // End: the incoming scene, whole.
    expect(Math.min(...end)).toBeGreaterThan(245);
    // Before the boundary: the outgoing scene, untouched.
    expect(Math.max(...all[start - 2])).toBeLessThan(40);
    expect(all.length).toBe(Math.round((OFFSET + DURATION + 2 - DURATION) * FPS));
  }, 60000);
});
