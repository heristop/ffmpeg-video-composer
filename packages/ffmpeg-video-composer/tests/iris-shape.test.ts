import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { designedTransitionGraph } from '@/core/motion/transitions';
import { boundaryMatte } from '@/core/motion/transition-mattes';
import { coverScale, fieldLevel, revealField, shapeOutline } from '@/core/motion/radial-matte';
import { boundaryTransitions } from '@/director/prepare-build';
import { buildVideoGraph } from '@/editor/utils/transition-graph';
import { matteInputArgs } from '@/editor/utils/matte-staging';
import { DEVICE_FILTERS } from '@/editor/utils/device-filters.generated';
import { TransitionSchema } from '@/schemas/effects.schemas';
import type { Section } from '@/core/types';

// The iris `shape`: a star, heart or rounded square opens from the origin, through a compile-time reveal
// field. The circle keeps its own paths, byte for byte.

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
const MATTE = { label: '3:v', centre: { x: 96, y: 90 }, scale: 300 };

function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-hide_banner', '-version'], { stdio: 'pipe' });

    return true;
  } catch {
    return false;
  }
}

describe('iris shape: schema and boundary', () => {
  it('accepts the four shapes and nothing else', () => {
    for (const shape of ['circle', 'star', 'heart', 'rounded-square']) {
      expect(TransitionSchema.safeParse({ type: 'iris', shape }).success, shape).toBe(true);
    }
    expect(TransitionSchema.safeParse({ type: 'iris', shape: 'triangle' }).success).toBe(false);
  });

  it('carries the shape to the boundary', () => {
    const sections = [{ name: 'a' }, { name: 'b' }] as unknown as Section[];

    expect(
      boundaryTransitions(sections, { type: 'iris', duration: 0.6, shape: 'star', origin: { x: 0.2, y: 0.3 } })
    ).toEqual([{ type: 'iris', duration: 0.6, ease: undefined, origin: { x: 0.2, y: 0.3 }, shape: 'star' }]);
  });
});

describe('iris shape: lowering', () => {
  it('keeps the circle byte-identical, with or without shape: circle', () => {
    const plain = designedTransitionGraph(BOUNDARY);

    expect(designedTransitionGraph({ ...BOUNDARY, shape: 'circle' })).toBe(plain);
    expect(designedTransitionGraph({ ...BOUNDARY, shape: 'circle', matte: MATTE })).toBe(plain);
    expect(plain).toContain('circleopen');
    // A star without its matte (no input could be added) falls back to the circle.
    expect(designedTransitionGraph({ ...BOUNDARY, shape: 'star' })).toBe(plain);
  });

  it('thresholds the field at the eased level on a half-size xfade', () => {
    const graph = designedTransitionGraph({ ...BOUNDARY, shape: 'star', matte: MATTE });

    expect(graph).toContain(
      '[3:v]format=gray16le,setsar=1,setpts=PTS-STARTPTS[dt0m0];color=c=black:s=640x360:r=30:d=0.6,format=gray16le[dt0m1];' +
        "[dt0m0][dt0m1]xfade=transition=custom:expr='65535*clip(((-163.8375+65862.675*(if(lt((0.6*(1-P)),0),0," +
        'clip(if(lt((0.6*(1-P)),0.3),0+((0.6*(1-P))-0)*(1.666667+((0.6*(1-P))-0)*(0+((0.6*(1-P))-0)*0)),' +
        'if(lt((0.6*(1-P)),0.6),0.5+((0.6*(1-P))-0.3)*(1.666667+((0.6*(1-P))-0.3)*(0+((0.6*(1-P))-0.3)*0)),1)),0,1))))' +
        "-A)/327.675+0.5,0,1)':duration=0.6:offset=0,format=gray,scale=1280:720:flags=bilinear,format=gray,settb=AVTB,setpts=N/(30*TB)[dt0mask];" +
        '[dt0in]setpts=N/(30*TB)[dt0ic];[dt0tail]setpts=N/(30*TB)[dt0tc];' +
        '[dt0ic][dt0mask]alphamerge[dt0ia];[dt0tc][dt0ia]overlay=0:0[dt0mix]'
    );
  });

  it('routes the matte from the assembly frame to its boundary', () => {
    const graph = buildVideoGraph(
      [
        { type: 'push-left', duration: 0.5 },
        { type: 'iris', duration: 0.6, shape: 'heart' },
      ],
      [2, 4],
      [0.5, 0.6],
      '[vout]',
      { scale: '1280:720', fps: 30, mattes: [undefined, MATTE] }
    );

    expect(graph).toContain('[3:v]format=gray');
    expect(graph.match(/\[3:v\]/g)).toHaveLength(1);
  });

  it('uses on-device filters only and is deterministic', { timeout: 60_000 }, () => {
    const graph = designedTransitionGraph({ ...BOUNDARY, shape: 'heart', matte: MATTE, ease: 'ease-out-cubic' });
    const filters = new Set([...graph.matchAll(/(?:^|[\];,])([a-z]+)(?=[=[,;]|$)/g)].map((m) => m[1]));

    for (const filter of filters) expect(DEVICE_FILTERS.has(filter), filter).toBe(true);
    expect(graph).toBe(designedTransitionGraph({ ...BOUNDARY, shape: 'heart', matte: MATTE, ease: 'ease-out-cubic' }));
    expect(boundaryMatte({ type: 'iris', shape: 'heart' }, { width: 1280, height: 720 }).matte?.png()).toEqual(
      boundaryMatte({ type: 'iris', shape: 'heart' }, { width: 1280, height: 720 }).matte?.png()
    );
  });
});

// Real FFmpeg: black → white across a star iris from (0.3, 0.5). Halfway, the white region is the star at
// half the covering scale, centred on the origin.
describe.skipIf(!hasFfmpeg())('star iris on real frames', () => {
  const [W, H, FPS] = [640, 360, 30];
  const ORIGIN = { x: 0.3, y: 0.5 };

  it('reveals a star centred on the origin', { timeout: 300_000 }, () => {
    const frame = { width: W, height: H };
    const result = boundaryMatte({ type: 'iris', shape: 'star', origin: ORIGIN }, frame);
    const matte = result.matte;

    if (!matte) throw new Error('no matte');

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-shape-'));
    const file = path.join(dir, matte.name);
    fs.writeFileSync(file, matte.png());

    const boundary = {
      ...BOUNDARY,
      width: W,
      height: H,
      offset: 0.5,
      duration: 0.6,
      shape: 'star' as const,
      ease: 'linear',
    };
    const graph =
      `color=c=black:s=${W}x${H}:r=${FPS}:d=1.5,format=yuv420p,settb=AVTB[vs0];` +
      `color=c=white:s=${W}x${H}:r=${FPS}:d=1.5,format=yuv420p,settb=AVTB[vs1];` +
      designedTransitionGraph({ ...boundary, matte: { label: '0:v', centre: matte.centre, scale: matte.scale } });
    const args = matteInputArgs(file, FPS, 0.6).trim().split(/\s+/);
    const raw = execFileSync(
      'ffmpeg',
      ['-v', 'error', ...args, '-filter_complex', graph, '-map', '[v0]', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
      { maxBuffer: 1 << 28 }
    );
    const frames = Array.from({ length: raw.length / (W * H) }, (_, i) => raw.subarray(i * W * H, (i + 1) * W * H));
    const mid = frames[15 + 9];

    // Expected: the star at the threshold level halfway (linear), on the full-size field.
    const soft = (65535 * 1.5) / matte.scale;
    const level = -soft / 2 + (65535 + soft) * 0.5;
    const outline = shapeOutline('star', { x: ORIGIN.x * W, y: ORIGIN.y * H }, 1);
    const field = revealField(outline, W, H, coverScale(outline, W, H));
    let [both, either] = [0, 0];

    for (let p = 0; p < W * H; p++) {
      const expected = fieldLevel(field, p) <= level;
      const shown = mid[p] > 128;

      if (expected && shown) both++;

      if (expected || shown) either++;
    }

    expect(either).toBeGreaterThan(W * H * 0.05);
    // Anti-aliased along the whole outline (an 8-bit field stepped it in multi-pixel stairs).
    expect(mid.reduce((n, v) => n + (v > 60 && v < 195 ? 1 : 0), 0)).toBeGreaterThan(700);
    expect(both / either).toBeGreaterThan(0.93);
    expect(frames[0][0]).toBeLessThan(20);
    expect(Math.min(...frames[15 + 18].subarray(0, W * H))).toBeGreaterThan(235);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

// Real FFmpeg, scenes on a segment file's clock (1/15360 rescaled to AVTB) at an offset that does not land on
// whole microseconds: the mask must still advance on every frame (it held every third one before the
// scenes and the mask shared one frame clock).
describe.skipIf(!hasFfmpeg())('shaped iris on segment timestamps', () => {
  it('opens a little more on every frame, circle with an origin and star alike', { timeout: 300_000 }, () => {
    const [W, H, FPS] = [320, 180, 30];
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-clock-'));
    const star = boundaryMatte(
      { type: 'iris', shape: 'star', origin: { x: 0.3, y: 0.5 } },
      { width: W, height: H }
    ).matte;

    if (!star) throw new Error('no matte');

    const file = path.join(dir, star.name);
    fs.writeFileSync(file, star.png());

    const sources =
      `color=c=black:s=${W}x${H}:r=${FPS}:d=6,format=yuv420p,settb=1/15360,settb=AVTB[vs0];` +
      `color=c=white:s=${W}x${H}:r=${FPS}:d=2,format=yuv420p,settb=1/15360,settb=AVTB[vs1];`;
    const boundary = {
      ...BOUNDARY,
      width: W,
      height: H,
      offset: 4.25,
      duration: 0.8,
      origin: { x: 0.3, y: 0.5 },
      ease: 'linear',
    };
    const lit = (graph: string, extra: string[] = []): number[] => {
      const raw = execFileSync(
        'ffmpeg',
        [
          '-v',
          'error',
          ...extra,
          '-filter_complex',
          sources + graph,
          '-map',
          '[v0]',
          '-f',
          'rawvideo',
          '-pix_fmt',
          'gray',
          '-',
        ],
        { maxBuffer: 1 << 28 }
      );

      return Array.from({ length: 22 }, (_, i) =>
        raw.subarray((129 + i) * W * H, (130 + i) * W * H).reduce((n, v) => n + (v > 128 ? 1 : 0), 0)
      );
    };
    const circle = lit(designedTransitionGraph(boundary));
    const starred = lit(
      designedTransitionGraph({
        ...boundary,
        shape: 'star',
        matte: { label: '0:v', centre: star.centre, scale: star.scale },
      }),
      matteInputArgs(file, FPS, 0.8).trim().split(/\s+/)
    );

    for (const counts of [circle, starred]) {
      for (let i = 1; i < counts.length; i++) expect(counts[i], `frame ${129 + i}`).toBeGreaterThan(counts[i - 1]);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
