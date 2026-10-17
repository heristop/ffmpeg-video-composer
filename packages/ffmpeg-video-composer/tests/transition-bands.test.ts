import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { designedTransitionGraph, isDesignedTransition } from '@/core/motion/transitions';
import { bandColor, bandsGeometry, bandsTiming } from '@/core/motion/transition-bands';
import { boundaryTransitions } from '@/director/prepare-build';
import { buildVideoGraph } from '@/editor/utils/transition-graph';
import { DEVICE_FILTERS } from '@/editor/utils/device-filters.generated';
import { TransitionSchema } from '@/schemas/effects.schemas';
import type { Section } from '@/core/types';

// The bands transition: N colour bands at an angle sweep in, staggered, cover the frame at the midpoint,
// then sweep on out over the next scene.

const BOUNDARY = {
  type: 'bands' as const,
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

describe('bands: schema and boundary', () => {
  it('is a designed transition that takes count, angle, colors and stagger', () => {
    expect(isDesignedTransition('bands')).toBe(true);
    expect(
      TransitionSchema.safeParse({
        type: 'bands',
        count: 5,
        angle: -20,
        colors: ['#9298fb', '$color.accent'],
        stagger: 0.1,
      }).success
    ).toBe(true);
    expect(TransitionSchema.safeParse({ type: 'bands', count: 1 }).success).toBe(false);
    expect(TransitionSchema.safeParse({ type: 'bands', count: 9 }).success).toBe(false);
    expect(TransitionSchema.safeParse({ type: 'bands', angle: 90 }).success).toBe(false);
    expect(TransitionSchema.safeParse({ type: 'bands', colors: [] }).success).toBe(false);
    expect(TransitionSchema.safeParse({ type: 'bands', stagger: 0.8 }).success).toBe(false);
  });

  it('defaults the colours to the theme: brand, accent, accent2, fg', () => {
    const sections = [{ name: 'a' }, { name: 'b' }] as unknown as Section[];
    const theme = { colors: { brand: '#9298fb', accent: '#f96f99', accent2: '#ffd166', fg: '#ffffff' } };

    expect(boundaryTransitions(sections, { type: 'bands', duration: 1 }, true, theme)).toEqual([
      { type: 'bands', duration: 1, ease: undefined, colors: ['#9298fb', '#f96f99', '#ffd166', '#ffffff'] },
    ]);
    expect(boundaryTransitions(sections, { type: 'bands', duration: 1, colors: ['#000000'], count: 3 })).toEqual([
      { type: 'bands', duration: 1, ease: undefined, colors: ['#000000'], count: 3 },
    ]);
    // Other transitions are untouched.
    expect(boundaryTransitions(sections, { type: 'push-left', duration: 0.5 })).toEqual([
      { type: 'push-left', duration: 0.5, ease: undefined },
    ]);
  });
});

describe('bands: lowering', () => {
  it('normalises colours to 0xRRGGBB and falls back on anything else', () => {
    expect(bandColor('#9298fb', 0)).toBe('0x9298FB');
    expect(bandColor('#F96F99@0.5', 1)).toBe('0xF96F99');
    expect(bandColor('red', 0)).toBe('0x7C83FD');
    expect(bandColor(undefined, 1)).toBe('0xFF8AAE');
  });

  it('shares the frame across the bands and sends each one fully off it', () => {
    const g = bandsGeometry(1280, 720, 4, 30);

    // Across: S_n = 1280 sin 30 + 720 cos 30 = 1263.5 → 316 + 2 × 3 overlap.
    expect(g.thickness).toBe(322);
    // Along: S_u = 1280 cos 30 + 720 sin 30 = 1468.5 → 1469 + 6.
    expect(g.length).toBe(1475);
    expect(g.box).toEqual({ w: 1440, h: 1018 });
    expect(g.travel).toBeCloseTo((1468.51 + 1475) / 2 + 6, 1);
    expect(g.offsets.map((o) => Math.round(o))).toEqual([-474, -158, 158, 474]);
  });

  it('caps the stagger so each sweep keeps 40% of a half', () => {
    expect(bandsTiming(1, 4, 0.06)).toEqual({ stagger: 0.06, sweep: 0.32 });
    expect(bandsTiming(1, 4, 0.5).stagger).toBeCloseTo(0.1, 6);
    expect(bandsTiming(1, 4, 0.5).sweep).toBeCloseTo(0.2, 6);
  });

  it('lowers to rotated colour sprites moved by overlay expressions', () => {
    const graph = designedTransitionGraph({ ...BOUNDARY, count: 2, colors: ['#ff0000', '#00ff00'], ease: 'linear' });

    expect(graph).toContain(
      'color=c=0xFF0000:s=1475x638:r=30,trim=end_frame=1,format=rgba,rotate=a=-0.523599:ow=1598:oh=1292:c=black@0,' +
        'loop=loop=31:size=1,setpts=N/(30*TB)[dt0b0]'
    );
    expect(graph).toContain("[dt0tail][dt0in]overlay=0:0:enable='gte(t,0.5)'[dt0k0]");
    expect(graph).toContain(
      "[dt0k0][dt0b0]overlay=x='-316.942286+(0.866025)*(1477.756258*(1-(if(lt(t,0),0,if(lt(t,0.22),0+(t-0)*" +
        '(2.272727+(t-0)*(0+(t-0)*0)),if(lt(t,0.44),0.5+(t-0.22)*(2.272727+(t-0.22)*(0+(t-0.22)*0)),1))))-(if(lt(t,0.5),0,' +
        'if(lt(t,0.72),0+(t-0.5)*(2.272727+(t-0.5)*(0+(t-0.5)*0)),if(lt(t,0.94),0.5+(t-0.72)*(2.272727+(t-0.72)*' +
        "(0+(t-0.72)*0)),1))))))':y='-559.564065+(-0.5)*(1477.756258*"
    );
    expect(graph).toContain('[dt0k1][dt0b1]overlay=');
    expect(graph).toContain(':eof_action=pass[dt0mix]');
  });

  it('uses on-device filters only and is deterministic', () => {
    const graph = designedTransitionGraph(BOUNDARY);
    const filters = new Set([...graph.matchAll(/(?:^|[\];,])([a-z]+)(?=[=[,;]|$)/g)].map((m) => m[1]));

    for (const filter of filters) expect(DEVICE_FILTERS.has(filter), filter).toBe(true);
    expect(filters).toContain('rotate');
    expect(filters).toContain('loop');
    expect(graph).toBe(designedTransitionGraph(BOUNDARY));
  });

  it('flows from the boundary list through buildVideoGraph', () => {
    const graph = buildVideoGraph([{ type: 'bands', duration: 1, count: 3, angle: 10 }], [2], [1], '[vout]', {
      scale: '1280:720',
      fps: 30,
    });

    expect(graph).toContain('[dt0b2]');
    expect(graph).not.toContain('[dt0b3]');
    expect(graph).toContain('rotate=a=-0.174533');
  });
});

// Real FFmpeg: grey → dark across bands. Midpoint: every pixel is one of the N colours; a quarter in: partial
// cover whose edges run at the angle; the end: the incoming scene.
describe.skipIf(!hasFfmpeg())('bands on real frames', () => {
  const [W, H, FPS] = [640, 360, 30];
  const COLORS = ['#ff0000', '#00ff00', '#0000ff', '#ffff00'];
  const RGB = [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [255, 255, 0],
  ];
  const ANGLE = 30;

  function frames(): Buffer[] {
    const boundary = { ...BOUNDARY, width: W, height: H, offset: 0.5, duration: 1, colors: COLORS, angle: ANGLE };
    const graph =
      `color=c=0x808080:s=${W}x${H}:r=${FPS}:d=2,format=yuv420p,settb=AVTB[vs0];` +
      `color=c=0x303030:s=${W}x${H}:r=${FPS}:d=2,format=yuv420p,settb=AVTB[vs1];` +
      designedTransitionGraph(boundary);
    const raw = execFileSync(
      'ffmpeg',
      ['-v', 'error', '-filter_complex', graph, '-map', '[v0]', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
      { maxBuffer: 1 << 29 }
    );
    const size = W * H * 3;

    return Array.from({ length: raw.length / size }, (_, i) => raw.subarray(i * size, (i + 1) * size));
  }

  // Index of the nearest band colour within `tolerance` (sum of abs channel errors), else -1.
  function bandAt(frame: Buffer, p: number, tolerance = 90): number {
    for (let c = 0; c < RGB.length; c++) {
      const err =
        Math.abs(frame[p * 3] - RGB[c][0]) +
        Math.abs(frame[p * 3 + 1] - RGB[c][1]) +
        Math.abs(frame[p * 3 + 2] - RGB[c][2]);

      if (err < tolerance) return c;
    }

    return -1;
  }

  // Dominant edge orientation of a mask (structure tensor), in degrees counter-clockwise from horizontal.
  function edgeAngle(mask: Uint8Array): number {
    let [sxx, syy, sxy] = [0, 0, 0];

    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const gx = mask[y * W + x + 1] - mask[y * W + x - 1];
        const gy = mask[(y + 1) * W + x] - mask[(y - 1) * W + x];
        sxx += gx * gx;
        syy += gy * gy;
        sxy += gx * gy;
      }
    }

    // The gradient's dominant direction is the edge normal; the edge runs perpendicular to it.
    const normal = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const edge = normal + Math.PI / 2;

    return ((-edge * 180) / Math.PI + 540) % 180;
  }

  it('covers, sweeps at the angle and lands on the incoming scene', { timeout: 300_000 }, () => {
    const all = frames();
    const start = 15; // offset 0.5 s at 30 fps
    const mid = all[start + 15];
    const counts = [0, 0, 0, 0, 0];
    let scene = 0;

    for (let p = 0; p < W * H; p++) {
      counts[bandAt(mid, p) + 1]++;

      // Neither scene shows anywhere (4:2:0 chroma only blends the colours along the band seams).
      if (Math.abs(mid[p * 3] - mid[p * 3 + 1]) < 12 && Math.abs(mid[p * 3 + 1] - mid[p * 3 + 2]) < 12) scene++;
    }

    expect(scene).toBe(0);
    expect(counts[0] / (W * H)).toBeLessThan(0.015);
    for (const count of counts.slice(1)) expect(count / (W * H)).toBeGreaterThan(0.08);

    const quarter = all[start + 8];
    const mask = new Uint8Array(W * H);
    let covered = 0;

    for (let p = 0; p < W * H; p++) {
      if (bandAt(quarter, p) === 0) mask[p] = 255;

      if (bandAt(quarter, p) >= 0) covered++;
    }

    expect(covered / (W * H)).toBeGreaterThan(0.05);
    expect(covered / (W * H)).toBeLessThan(0.95);
    expect(Math.abs(edgeAngle(mask) - ANGLE)).toBeLessThan(3);

    for (const frame of [all[start + 30], all[start + 35]]) {
      for (const p of [0, (W * H) >> 1, W * H - 1, W * 10 + 600]) expect(Math.abs(frame[p * 3] - 0x30)).toBeLessThan(6);
    }
  });
});
