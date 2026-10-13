import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { designedTransitionGraph } from '@/core/motion/transitions';
import { boundaryTransitions } from '@/director/prepare-build';
import { buildVideoGraph } from '@/editor/utils/transition-graph';
import { DEVICE_FILTERS } from '@/editor/utils/device-filters.generated';
import { TransitionSchema } from '@/schemas/effects.schemas';
import type { Section } from '@/core/types';

// The iris with an `origin` and an `ease`: the circle opens from a point of the frame on a curve. Without
// either it stays the built-in centred, linear circleopen, byte for byte.

const BOUNDARY = {
  type: 'iris' as const,
  left: 'vs0',
  right: 'vs1',
  out: 'v0',
  id: 'dt0',
  offset: 2,
  duration: 0.6,
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

describe('iris origin: schema', () => {
  it('accepts an {x, y} origin in frame fractions and rejects the rest', () => {
    expect(TransitionSchema.safeParse({ type: 'iris', origin: { x: 0.15, y: 0.2 } }).success).toBe(true);
    expect(TransitionSchema.safeParse({ type: 'iris', origin: { x: 0, y: 1 } }).success).toBe(true);
    expect(TransitionSchema.safeParse({ type: 'iris', origin: { x: 1.2, y: 0.2 } }).success).toBe(false);
    expect(TransitionSchema.safeParse({ type: 'iris', origin: { x: 0.2 } }).success).toBe(false);
    expect(TransitionSchema.safeParse({ type: 'iris', origin: { x: 0.2, y: 0.2, z: 1 } }).success).toBe(false);
  });

  it('carries origin from the declared transition to the boundary', () => {
    const sections = [{ name: 'a' }, { name: 'b' }] as unknown as Section[];
    const declared = { type: 'iris', duration: 0.6, ease: 'ease-out-cubic', origin: { x: 0.1, y: 0.2 } } as const;

    expect(boundaryTransitions(sections, declared)).toEqual([
      { type: 'iris', duration: 0.6, ease: 'ease-out-cubic', origin: { x: 0.1, y: 0.2 } },
    ]);
    expect(boundaryTransitions(sections, { type: 'iris', duration: 0.6 })).toEqual([{ type: 'iris', duration: 0.6 }]);
  });
});

describe('iris origin: lowering', () => {
  it('keeps the default iris byte-identical: centred, linear circleopen', () => {
    const graph = designedTransitionGraph(BOUNDARY);

    expect(graph).toContain('[dt0tail][dt0in]xfade=transition=circleopen:duration=0.6:offset=0[dt0mix]');
    expect(graph).not.toContain('custom');
    expect(
      buildVideoGraph([{ type: 'iris', duration: 0.6 }], [2], [0.6], '[vout]', { scale: '1280:720', fps: 30 })
    ).toContain('circleopen');
  });

  it('opens from the origin on the curve through a quarter-resolution mask', () => {
    const graph = designedTransitionGraph({ ...BOUNDARY, origin: { x: 0.1, y: 0.2 }, ease: 'linear' });

    expect(graph).toContain(
      'color=c=black:s=320x180:r=30:d=0.6,format=gray[dt0m0];color=c=black:s=320x180:r=30:d=0.6,format=gray[dt0m1];' +
        "[dt0m0][dt0m1]xfade=transition=custom:expr='255*clip((323.493789*(if(lt((0.6*(1-P)),0),0," +
        'if(lt((0.6*(1-P)),0.3),0+((0.6*(1-P))-0)*(1.666667+((0.6*(1-P))-0)*(0+((0.6*(1-P))-0)*0)),' +
        'if(lt((0.6*(1-P)),0.6),0.5+((0.6*(1-P))-0.3)*(1.666667+((0.6*(1-P))-0.3)*(0+((0.6*(1-P))-0.3)*0)),1))))' +
        "-hypot(X-32,Y-36))/1.5+0.5,0,1)'" +
        ':duration=0.6:offset=0,scale=1280:720:flags=bilinear,format=gray,settb=AVTB[dt0mask];' +
        '[dt0in][dt0mask]alphamerge[dt0ia];[dt0tail][dt0ia]overlay=0:0[dt0mix]'
    );
    expect(graph).not.toContain('circleopen');
  });

  it('eases the opening: the same origin with an ease-in curve differs from linear', () => {
    const linear = designedTransitionGraph({ ...BOUNDARY, origin: { x: 0.1, y: 0.2 } });
    const eased = designedTransitionGraph({ ...BOUNDARY, origin: { x: 0.1, y: 0.2 }, ease: 'ease-in-cubic' });

    expect(eased).not.toEqual(linear);
    expect(designedTransitionGraph({ ...BOUNDARY, ease: 'ease-in-cubic' })).toContain('hypot(X-160,Y-90)');
  });

  it('uses on-device filters only and is deterministic', () => {
    const graph = designedTransitionGraph({ ...BOUNDARY, origin: { x: 0.9, y: 0.9 }, ease: 'ease-out-cubic' });
    const filters = new Set([...graph.matchAll(/(?:^|[\];,])([a-z]+)(?=[=[,;]|$)/g)].map((m) => m[1]));

    expect(filters).toEqual(
      new Set([
        'split',
        'trim',
        'setpts',
        'color',
        'format',
        'xfade',
        'scale',
        'settb',
        'alphamerge',
        'overlay',
        'concat',
      ])
    );
    for (const filter of filters) expect(DEVICE_FILTERS.has(filter), filter).toBe(true);
    expect(graph).toBe(designedTransitionGraph({ ...BOUNDARY, origin: { x: 0.9, y: 0.9 }, ease: 'ease-out-cubic' }));
  });
});

// Real FFmpeg: black → white across an iris from (0.2, 0.25). At mid-transition the white disc's centre is
// the origin (its reach right and down from the origin agree) and its radius follows the eased curve.
describe.skipIf(!hasFfmpeg())('iris origin on real frames', () => {
  const [W, H, FPS] = [640, 360, 30];
  const ORIGIN = { x: 0.2, y: 0.25 };

  function frames(ease: string): Buffer[] {
    const boundary = { ...BOUNDARY, width: W, height: H, offset: 0.5, duration: 0.6, origin: ORIGIN, ease };
    const graph =
      `color=c=black:s=${W}x${H}:r=${FPS}:d=1.5,format=yuv420p,settb=AVTB[vs0];` +
      `color=c=white:s=${W}x${H}:r=${FPS}:d=1.5,format=yuv420p,settb=AVTB[vs1];` +
      designedTransitionGraph(boundary);
    const raw = execFileSync(
      'ffmpeg',
      ['-v', 'error', '-filter_complex', graph, '-map', '[v0]', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
      { maxBuffer: 1 << 28 }
    );

    return Array.from({ length: raw.length / (W * H) }, (_, i) => raw.subarray(i * W * H, (i + 1) * W * H));
  }

  // White extent from the origin along +x and +y (first pixel under mid-grey).
  function reach(frame: Buffer): { right: number; down: number; left: number; up: number } {
    const [ox, oy] = [Math.round(ORIGIN.x * W), Math.round(ORIGIN.y * H)];
    const walk = (dx: number, dy: number): number => {
      let k = 0;

      while (ox + (k + 1) * dx >= 0 && ox + (k + 1) * dx < W && oy + (k + 1) * dy >= 0 && oy + (k + 1) * dy < H) {
        if (frame[(oy + (k + 1) * dy) * W + ox + (k + 1) * dx] < 128) break;
        k++;
      }

      return k;
    };

    return { right: walk(1, 0), down: walk(0, 1), left: walk(-1, 0), up: walk(0, -1) };
  }

  it('centres the circle on the origin at mid-transition, sized by the curve', () => {
    const linear = frames('linear');
    const eased = frames('ease-in-cubic');
    const mid = Math.round((0.5 + 0.3) * FPS);
    const far = Math.hypot(W * (1 - ORIGIN.x), H * (1 - ORIGIN.y));
    // Linear, a third of the way in (the disc still inside the frame below and right of the origin).
    const r = reach(linear[Math.round(0.5 * FPS) + 6]);

    expect(Math.abs(r.right - r.down), JSON.stringify(r)).toBeLessThanOrEqual(3);
    expect(r.right).toBeGreaterThan(far / 3 - 12);
    expect(r.right).toBeLessThan(far / 3 + 12);
    // ease-in-cubic at the middle: an eighth of the reach.
    const e = reach(eased[mid]);

    expect(Math.abs(e.right - e.down), JSON.stringify(e)).toBeLessThanOrEqual(3);
    expect(Math.abs(e.right - e.left), JSON.stringify(e)).toBeLessThanOrEqual(3);
    expect(Math.abs(e.right - e.up), JSON.stringify(e)).toBeLessThanOrEqual(3);
    expect(e.right).toBeLessThan(far * 0.125 + 12);
    expect(e.right).toBeGreaterThan(far * 0.125 - 12);
    // Before the boundary the frame is the outgoing scene, after it the incoming one.
    expect(Math.max(...linear[Math.round(0.4 * FPS)])).toBeLessThan(40);
    expect(Math.min(...linear[Math.round(1.2 * FPS)])).toBeGreaterThan(215);
  }, 60000);
});
