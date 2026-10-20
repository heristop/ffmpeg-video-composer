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

  it('accepts a #RRGGBB rim colour and rejects the rest', () => {
    expect(TransitionSchema.safeParse({ type: 'iris', rim: '#F6C445' }).success).toBe(true);
    expect(TransitionSchema.safeParse({ type: 'iris', rim: 'yellow' }).success).toBe(false);
    expect(TransitionSchema.safeParse({ type: 'iris', rim: '#FC4' }).success).toBe(false);
  });

  it('carries the rim from the declared transition to the boundary', () => {
    const sections = [{ name: 'a' }, { name: 'b' }] as unknown as Section[];
    const declared = { type: 'iris', duration: 0.6, origin: { x: 0.1, y: 0.2 }, rim: '#F6C445' } as const;

    expect(boundaryTransitions(sections, declared)).toEqual([
      { type: 'iris', duration: 0.6, ease: undefined, origin: { x: 0.1, y: 0.2 }, rim: '#F6C445' },
    ]);
    expect(
      buildVideoGraph([{ type: 'iris', duration: 0.6, rim: '#F6C445' }], [2], [0.6], '[vout]', {
        scale: '1280:720',
        fps: 30,
      })
    ).toContain('color=c=0xF6C445');
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
        'clip(if(lt((0.6*(1-P)),0.3),0+((0.6*(1-P))-0)*(1.666667+((0.6*(1-P))-0)*(0+((0.6*(1-P))-0)*0)),' +
        'if(lt((0.6*(1-P)),0.6),0.5+((0.6*(1-P))-0.3)*(1.666667+((0.6*(1-P))-0.3)*(0+((0.6*(1-P))-0.3)*0)),1)),0,1)))' +
        "-hypot(X-32,Y-36))/1.5+0.5,0,1)'" +
        ':duration=0.6:offset=0,scale=1280:720:flags=bilinear,format=gray,settb=AVTB,setpts=N/(30*TB)[dt0mask];' +
        '[dt0in]setpts=N/(30*TB)[dt0ig];[dt0ig][dt0mask]alphamerge[dt0ia];[dt0tail]setpts=N/(30*TB)[dt0tg];' +
        '[dt0tg][dt0ia]overlay=0:0[dt0mix]'
    );
    expect(graph).not.toContain('circleopen');
  });

  it('outlines the opening circle with a rim: a ring mask over a colour, laid on the mix', () => {
    const plain = designedTransitionGraph({ ...BOUNDARY, origin: { x: 0.1, y: 0.2 }, ease: 'linear' });
    const rim = designedTransitionGraph({ ...BOUNDARY, origin: { x: 0.1, y: 0.2 }, ease: 'linear', rim: '#F6C445' });
    const e =
      'if(lt((0.6*(1-P)),0),0,' +
      'clip(if(lt((0.6*(1-P)),0.3),0+((0.6*(1-P))-0)*(1.666667+((0.6*(1-P))-0)*(0+((0.6*(1-P))-0)*0)),' +
      'if(lt((0.6*(1-P)),0.6),0.5+((0.6*(1-P))-0.3)*(1.666667+((0.6*(1-P))-0.3)*(0+((0.6*(1-P))-0.3)*0)),1)),0,1))';

    // The disc is unchanged; its overlay now feeds the rim instead of the mix.
    expect(rim).toContain(plain.slice(0, plain.indexOf('[dt0tg][dt0ia]overlay=0:0[dt0mix]')));
    expect(rim).toContain(
      'color=c=black:s=320x180:r=30:d=0.6,format=gray[dt0ring0];color=c=black:s=320x180:r=30:d=0.6,format=gray[dt0ring1];' +
        `[dt0ring0][dt0ring1]xfade=transition=custom:expr='255*clip((1-abs(hypot(X-32,Y-36)-323.493789*(${e})))/1.5+0.5,0,1)'` +
        ':duration=0.6:offset=0,scale=1280:720:flags=bilinear,format=gray,settb=AVTB,setpts=N/(30*TB)[dt0ringmask];' +
        'color=c=0xF6C445:s=1280x720:r=30:d=0.6,settb=AVTB,setpts=N/(30*TB)[dt0rc];' +
        '[dt0rc][dt0ringmask]alphamerge[dt0rim];[dt0tg][dt0ia]overlay=0:0[dt0ov];[dt0ov][dt0rim]overlay=0:0[dt0mix]'
    );
    // Every label is produced once and consumed once (the boundary's own split uses r1 / r2).
    const produced = [...rim.matchAll(/((?:\[[a-z0-9]+\])+)(?=;|$)/g)].flatMap((m) => m[1].slice(1, -1).split(']['));

    expect(produced).toContain('dt0r1');

    expect(new Set(produced).size).toBe(produced.length);
    // A rim alone (centred, linear) also takes the mask path.
    expect(designedTransitionGraph({ ...BOUNDARY, rim: '#F6C445' })).not.toContain('circleopen');
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
    const rimmed = designedTransitionGraph({ ...BOUNDARY, origin: { x: 0.9, y: 0.9 }, rim: '#FF0000' });

    for (const [, filter] of rimmed.matchAll(/(?:^|[\];,])([a-z]+)(?=[=[,;]|$)/g)) {
      expect(DEVICE_FILTERS.has(filter), filter).toBe(true);
    }
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

  it('draws the rim along the circle edge at mid-transition, in its colour', () => {
    const boundary = { ...BOUNDARY, width: W, height: H, offset: 0.5, duration: 0.6, origin: ORIGIN, rim: '#FF0000' };
    const graph =
      `color=c=black:s=${W}x${H}:r=${FPS}:d=1.5,format=yuv420p,settb=AVTB[vs0];` +
      `color=c=white:s=${W}x${H}:r=${FPS}:d=1.5,format=yuv420p,settb=AVTB[vs1];` +
      designedTransitionGraph(boundary);
    const raw = execFileSync(
      'ffmpeg',
      ['-v', 'error', '-filter_complex', graph, '-map', '[v0]', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
      { maxBuffer: 1 << 28 }
    );
    const size = W * H * 3;
    const frame = raw.subarray((Math.round(0.5 * FPS) + 9) * size, (Math.round(0.5 * FPS) + 10) * size);
    const rgb = (x: number, y: number) => [0, 1, 2].map((c) => frame[(y * W + x) * 3 + c]);
    const [ox, oy] = [Math.round(ORIGIN.x * W), Math.round(ORIGIN.y * H)];
    // Linear, 9 frames into 18: the edge sits at half the reach from the origin.
    const radius = Math.hypot(W * (1 - ORIGIN.x), H * (1 - ORIGIN.y)) / 2;

    let checked = 0;

    for (const angle of [0, 15, 30, 45, 60, 90, 180]) {
      const [c, s] = [Math.cos((angle * Math.PI) / 180), Math.sin((angle * Math.PI) / 180)];
      const along = (r: number) => rgb(Math.round(ox + c * r), Math.round(oy + s * r));
      const red = Array.from({ length: 25 }, (_, k) => along(radius - 12 + k)).filter(
        ([r, g, b]) => r > 180 && g < 90 && b < 90
      );

      const [fx, fy] = [ox + c * (radius + 24), oy + s * (radius + 24)];

      if (fx < 0 || fx >= W || fy < 0 || fy >= H) continue;
      expect(red.length, `rim at ${angle}°`).toBeGreaterThanOrEqual(3);
      // Inside the circle the incoming white, outside the outgoing black, both untinted.
      expect(
        along(radius * 0.5).every((v) => v > 235),
        `inside at ${angle}°`
      ).toBe(true);
      expect(
        along(radius + 24).every((v) => v < 30),
        `outside at ${angle}°`
      ).toBe(true);
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(3);
  }, 60000);

  it('opens a little on every frame when the clips come from a 1/15360 timebase (no stalled frames)', () => {
    // Segments decode on the mp4 timebase; after the trims the incoming and outgoing frames can sit 1 µs
    // apart, and an overlay pairing them by timestamp then reuses the previous mask every third frame.
    const boundary = { ...BOUNDARY, width: W, height: H, offset: 3.15, duration: 0.75, origin: ORIGIN, rim: '#FF0000' };
    const graph =
      `color=c=black:s=${W}x${H}:r=${FPS}:d=4,format=yuv420p,settb=1/15360,settb=AVTB[vs0];` +
      `color=c=white:s=${W}x${H}:r=${FPS}:d=2,format=yuv420p,settb=1/15360,settb=AVTB[vs1];` +
      designedTransitionGraph({ ...boundary, ease: 'linear' });
    const raw = execFileSync(
      'ffmpeg',
      ['-v', 'error', '-filter_complex', graph, '-map', '[v0]', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
      { maxBuffer: 1 << 28 }
    );
    const all = Array.from({ length: raw.length / (W * H) }, (_, i) => raw.subarray(i * W * H, (i + 1) * W * H));
    const radii = all.slice(Math.round(3.15 * FPS) + 2, Math.round(3.15 * FPS) + 16).map((frame) => reach(frame).right);

    for (let i = 1; i < radii.length; i++) expect(radii[i], JSON.stringify(radii)).toBeGreaterThan(radii[i - 1]);
  }, 60000);

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
