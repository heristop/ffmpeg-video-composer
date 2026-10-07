import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { leakStops, protectRamp } from '@/editor/presets/fx-leak';
import { hasFfmpeg, lowerGraphic, lumaAt, renderFrames, type Lowered } from './fixtures/fx-test-kit';
import { testBuildDir } from './fixtures/build-dir';

const leak = (graphic: Record<string, unknown> = {}, options = {}): Lowered =>
  lowerGraphic({ effect: 'leak', ...graphic }, options);

describe('fx leak: graph', () => {
  it('lowers to two radial lobes at half resolution, computed once, with an eased envelope', () => {
    const { text, warnings } = leak({ edge: 'left', duration: 2.6 });
    const lobes = [...text.matchAll(/gradients=s=(\d+)x(\d+):type=radial:([^,]*)/g)];

    expect(warnings).toEqual([]);
    expect(lobes).toHaveLength(2);
    // Half resolution: the source is half the lobe box it is scaled to.
    const scale = /gblur=sigma=[\d.]+,scale=(\d+):(\d+)/.exec(text);

    expect(Number(scale?.[2])).toBeGreaterThanOrEqual(2 * Number(lobes[0][2]) - 2);
    expect(lobes[0][3]).toMatch(/c7=#[0-9A-F]{6}@0:nb_colors=8/);
    // One frame of work, held for the window (bounded: 2.6 s at 30 fps).
    expect(text).toContain('trim=end_frame=1,setpts=PTS-STARTPTS+0.3/TB');
    expect(text).toContain('loop=loop=78:size=1:start=0');
    // Two ramps in (zero-slope start), two out (long soft tail), all on the alpha.
    expect(text.match(/fade=t=in:st=0.3:d=[\d.]+:alpha=1/g)?.length).toBeGreaterThanOrEqual(2);
    expect(text.match(/fade=t=out:st=[\d.]+:d=[\d.]+:alpha=1/g)?.length).toBeGreaterThanOrEqual(2);
    expect(text).toContain("enable='between(t,0.3,2.9)'");
  });

  it('keeps the shadows: a tap of the picture, alphamerged with a luma ramp, laid back on top', () => {
    const { text } = leak({ edge: 'right' });

    expect(text).toMatch(/crop=1280:720:0:0,format=yuv420p,split=2\[fx0_r\]\[fx0_tap\]/);
    expect(text).toContain('[fx0_tap]trim=start=0.3,split=2[fx0_sc][fx0_sm]');
    expect(text).toMatch(/\[fx0_sm\]format=gray,lutyuv=y='255\*max\(1\*\(1-clip\(val\/46,0,1\)/);
    expect(text).toContain('[fx0_sc][fx0_sa]alphamerge[fx0_sh]');
    expect(protectRamp(0, 180)).toContain('max(0*');
    expect(protectRamp(1, 180)).toContain('clip((val-152)/28,0,1)');
    expect(leak({}, { has: (f: string) => f !== 'alphamerge' }).text).not.toContain('alphamerge');
  });

  it('peaks at 0.22 by default and never above the 0.25 ceiling, with a bell that ends at exactly 0', () => {
    const peak = (text: string): number => Math.max(...[...text.matchAll(/@([\d.]+)/g)].map((m) => Number(m[1])));

    expect(peak(leak().text)).toBeCloseTo(0.22, 2);
    expect(peak(leak({ intensity: 1 }).text)).toBeCloseTo(0.25, 3);
    expect(leakStops(0.2)[0]).toBeCloseTo(0.2, 6);
    expect(leakStops(0.2).at(-1)).toBe(0);
    expect(leakStops(1).every((a, i, all) => i === 0 || a <= all[i - 1])).toBe(true);
  });

  it('is deterministic per seed and derives different untuned leaks from different seeds', () => {
    expect(leak().text).toBe(leak().text);

    const looks = new Set([1, 2, 3, 4, 5, 6].map((seed) => leak({}, { seed }).text));

    expect(looks.size).toBe(6);
    expect(leak({ seed: 4 }).text).not.toBe(leak().text);
  });

  it('honours every look parameter', () => {
    const base = leak({ edge: 'left' }).text;

    for (const change of [
      { edge: 'top-right' },
      { size: 0.8 },
      { stretch: 2.5 },
      { drift: -0.2 },
      { secondary: '#55AAFF' },
      { balance: 0 },
      { spread: 1.2 },
      { shadows: 0.5 },
      { rise: 0.1 },
      { fall: 0.7 },
      { color: '#FFD27A' },
    ]) {
      expect(leak({ edge: 'left', ...change }).text, JSON.stringify(change)).not.toBe(base);
    }

    expect(leak({ balance: 0 }).text.match(/gradients=/g)).toHaveLength(1);
  });

  it('falls back to gaussian disc sprites without gradients, and stands still under reduced motion', () => {
    const fallback = leak({}, { has: (f: string) => f !== 'gradients' });

    expect(fallback.text).not.toContain('gradients');
    expect(fallback.urls.every((url) => url.startsWith('sprite:kind=disc'))).toBe(true);
    expect(fallback.urls).toHaveLength(2);

    const reduced = leak({ edge: 'left' }, { energy: 0 });

    expect(reduced.text).toMatch(/overlay=x='-?[\d.]+\+-?[\d.]+\*\(0\)'/);
    expect(reduced.text).not.toContain('if(lt(t');
  });
});

// Real FFmpeg on raw frames: the leak spares the blacks, lights the mid-tones, has no edge anywhere and is
// byte-identical across runs.
const W = 320;
const H = 180;
const dir = testBuildDir('fx-leak-render');
const ready = hasFfmpeg();
const frames: Record<string, Buffer[]> = {};
const SPEC = { width: W, height: H, seconds: 1.5, dir };
// Black frame with a mid-grey slab across its middle third.
const SLAB = `color=c=black:s=${W}x${H}:r=30:d=1.5,format=yuv420p,drawbox=x=0:y=60:w=${W}:h=60:color=0x808080:t=fill`;
const GREY = `color=c=0x606060:s=${W}x${H}:r=30:d=1.5`;
const LIGHT = `color=c=0xF0E8DC:s=${W}x${H}:r=30:d=1.5`;
const OPTIONS = { scale: `${W}:${H}`, at: 0.2 };

beforeAll(() => {
  if (!ready) return;

  const slab = leak({ edge: 'left', duration: 1, intensity: 1 }, OPTIONS);
  const bare = leak({ edge: 'top-left', duration: 1, intensity: 1, shadows: 0 }, OPTIONS);

  frames.slab = renderFrames({ ...SPEC, base: SLAB, name: 'slab' }, slab);
  frames.slabNone = renderFrames({ ...SPEC, base: SLAB, name: 'slab-none' }, null);
  frames.grey = renderFrames({ ...SPEC, base: GREY, name: 'grey' }, bare);
  frames.greyAgain = renderFrames({ ...SPEC, base: GREY, name: 'grey-again' }, bare);
  frames.greyNone = renderFrames({ ...SPEC, base: GREY, name: 'grey-none' }, null);
  frames.light = renderFrames(
    { ...SPEC, base: LIGHT, name: 'light' },
    leak({ edge: 'left', duration: 1, intensity: 1 }, OPTIONS)
  );
  frames.lightNone = renderFrames({ ...SPEC, base: LIGHT, name: 'light-none' }, null);
}, 120000);

function liftStats(fx: Buffer[], none: Buffer[], rows: [number, number]): number {
  let max = 0;

  for (const [i, frame] of fx.entries()) {
    for (let y = rows[0]; y < rows[1]; y++) {
      for (let x = 0; x < W; x++) max = Math.max(max, lumaAt(frame, W, x, y) - lumaAt(none[i], W, x, y));
    }
  }

  return max;
}

// The steepest change of the leak's lift between neighbouring pixels (a straight edge would be a cliff).
function steepest(fx: Buffer, none: Buffer): number {
  return steepestIn(fx, none, W, H);
}

// The lift averaged over 3×3 pixels: the light's static dither grain (about ±1 code value, fx-light-kit
// softDither) averages out, while a straight edge (a step of several code values) stays a cliff.
function smoothLift(fx: Buffer, none: Buffer, width: number, height: number): Float32Array {
  const out = new Float32Array(width * height);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let sum = 0;

      for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) sum += fx[(y + i) * width + x + j] - none[(y + i) * width + x + j];
      }

      out[y * width + x] = sum / 9;
    }
  }

  return out;
}

function steepestIn(fx: Buffer, none: Buffer, width: number, height: number): number {
  const smooth = smoothLift(fx, none, width, height);
  const lift = (x: number, y: number): number => smooth[y * width + x];
  let max = 0;

  for (let y = 2; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      const gx =
        lift(x + 1, y - 1) +
        2 * lift(x + 1, y) +
        lift(x + 1, y + 1) -
        lift(x - 1, y - 1) -
        2 * lift(x - 1, y) -
        lift(x - 1, y + 1);
      const gy =
        lift(x - 1, y + 1) +
        2 * lift(x, y + 1) +
        lift(x + 1, y + 1) -
        lift(x - 1, y - 1) -
        2 * lift(x, y - 1) -
        lift(x + 1, y - 1);

      max = Math.max(max, Math.hypot(gx, gy) / 8);
    }
  }

  return max;
}

describe.skipIf(!ready)('fx leak on real frames', () => {
  it('lifts the black point by at most 3 code values while lighting the mid-tones', () => {
    const blacks = Math.max(
      liftStats(frames.slab, frames.slabNone, [0, 50]),
      liftStats(frames.slab, frames.slabNone, [130, H])
    );
    const mids = liftStats(frames.slab, frames.slabNone, [64, 116]);

    expect(blacks).toBeLessThanOrEqual(3);
    expect(mids).toBeGreaterThan(12);
  });

  it('never greys a surface brighter than its light', () => {
    let darkest = 0;

    for (const [i, frame] of frames.light.entries()) {
      for (let y = 0; y < H; y += 2) {
        for (let x = 0; x < W; x += 2) {
          darkest = Math.min(darkest, lumaAt(frame, W, x, y) - lumaAt(frames.lightNone[i], W, x, y));
        }
      }
    }

    expect(darkest).toBeGreaterThanOrEqual(-1);
  });

  it('has no straight edge anywhere: the lift never steps between neighbouring pixels', () => {
    const peak = liftStats(frames.grey, frames.greyNone, [0, H]);

    expect(peak).toBeGreaterThan(15);
    for (const [i, frame] of frames.grey.entries()) {
      expect(steepest(frame, frames.greyNone[i]), `frame ${i}`).toBeLessThan(2.5);
    }
  });

  // A lobe wider than the frame (size 1.1, stretched) from a side or a corner, in both orientations: its
  // half-resolution source box, the blur and the scale-up must never leave a cliff inside the light.
  it.each([
    ['left, landscape', 'left', W, H],
    ['left, portrait', 'left', H, W],
    ['top-left corner, landscape', 'top-left', W, H],
    ['top-left corner, portrait', 'top-left', H, W],
  ])('keeps a frame-wide lobe free of straight edges (%s)', (_label, edge, width, height) => {
    const spec = { ...SPEC, width, height, base: `color=c=0x606060:s=${width}x${height}:r=30:d=1.5` };
    const wide = leak(
      { edge, size: 1.1, stretch: 1.4, duration: 1, intensity: 1, shadows: 0 },
      { ...OPTIONS, scale: `${width}:${height}` }
    );
    const lit = renderFrames({ ...spec, name: `wide-${edge}-${width}` }, wide);
    const none = renderFrames({ ...spec, name: `wide-none-${width}` }, null);

    for (const i of [12, 18, 24]) {
      expect(steepestIn(lit[i], none[i], width, height), `frame ${i}`).toBeLessThan(2.5);
    }
  });

  it('leaves the frames before and after its window untouched and renders byte-identically', () => {
    expect(frames.grey[3].equals(frames.greyNone[3])).toBe(true);
    expect(frames.grey.at(-1)?.equals(frames.greyNone.at(-1) as Buffer)).toBe(true);

    const sha = (list: Buffer[]): string => createHash('sha256').update(Buffer.concat(list)).digest('hex');

    expect(sha(frames.grey)).toBe(sha(frames.greyAgain));
  });
});
