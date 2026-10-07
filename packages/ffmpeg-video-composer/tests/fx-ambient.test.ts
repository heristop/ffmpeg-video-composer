import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { highlightMask } from '@/editor/presets/fx-bloom';
import { FX_PRIMITIVES } from '@/schemas/fx.schemas';
import { hasFfmpeg, lowerGraphic, lumaAt, renderFrames, type Lowered } from './fixtures/fx-test-kit';
import { testBuildDir } from './fixtures/build-dir';

// The ambient primitives: bloom (highlight halation), vignette-breathe and grain. All three stay under the
// 0.12 ambient ceiling, ramp in and out softly, and are absent under reduced motion.

const fx = (effect: string, graphic: Record<string, unknown> = {}, options = {}): Lowered =>
  lowerGraphic({ effect, duration: 3, ...graphic }, options);
const AMBIENT = ['bloom', 'vignette-breathe', 'grain'] as const;

describe('fx ambient primitives: shared behaviour', () => {
  it('cap at 0.12 alpha', () => {
    for (const name of AMBIENT) expect(FX_PRIMITIVES[name].defaults.ceiling).toBe(0.12);
  });

  it('are absent under reduced motion, without a warning', () => {
    for (const name of AMBIENT) {
      const reduced = fx(name, {}, { energy: 0 });

      expect(reduced.filters, name).toEqual([]);
      expect(reduced.warnings, name).toEqual([]);
    }
  });

  it('ramp in and out over the window and are deterministic per seed', () => {
    for (const name of AMBIENT) {
      const { text } = fx(name);

      expect(text, name).toMatch(/fade=t=in:st=0.3:d=[\d.]+:alpha=1/);
      expect(text, name).toMatch(/fade=t=out:st=[\d.]+:d=[\d.]+:alpha=1/);
      expect(text, name).toContain("enable='between(t,0.3,3.3)'");
      expect(fx(name).text, name).toBe(text);
      expect(fx(name, {}, { seed: 5 }).text, name).not.toBe(fx(name, {}, { seed: 6 }).text);
    }
  });
});

describe('fx bloom', () => {
  it('builds a highlight mask from a tap of the picture, blurs it at half size and tints it', () => {
    const { text } = fx('bloom', { threshold: 0.8, knee: 0.1, radius: 0.02 });

    expect(text).toContain('split=2[fx0_r][fx0_tap]');
    expect(text).toContain(`[fx0_tap]trim=start=0.3,format=gray,lutyuv=${highlightMask(191.25, 216.75)}`);
    expect(text).toContain('scale=640:360,gblur=sigma=7.2,scale=1280:720[fx0_bm]');
    expect(text).toContain(
      "[fx0_bc][fx0_bm]alphamerge,format=yuva444p,lutyuv=a=val*0.102,lutyuv=a='if(gt(val,0),val+8,0)',noise="
    );
    // The soft dither: pedestal, ±8 noise, an alpha-only blur into a fine grain, pedestal off.
    expect(text).toContain("c3s=17:c3f=u:all_seed=77,gblur=sigma=0.7:planes=8,lutyuv=a='max(val-8,0)'");
    // Without gblur (the vignette does not need it otherwise) the dither degrades to the plain ±1 alpha step.
    expect(fx('vignette-breathe', {}, { has: (f: string) => f !== 'gblur' }).text).toContain(
      "noise=c0s=7:c0f=u:c3s=3:c3f=u:all_seed=77,lutyuv=a='if(lt(val,2),0,val)'"
    );
    expect(fx('bloom', { intensity: 1 }).text).toContain('lutyuv=a=val*0.12,');
  });

  it('honours its parameters and skips without gblur', () => {
    const base = fx('bloom').text;

    for (const change of [{ threshold: 0.9 }, { knee: 0.3 }, { radius: 0.04 }, { ramp: 1.5 }, { color: '#FFC080' }]) {
      expect(fx('bloom', change).text, JSON.stringify(change)).not.toBe(base);
    }

    const missing = fx('bloom', {}, { has: (f: string) => f !== 'gblur' });

    expect(missing.filters).toEqual([]);
    expect(missing.warnings.join()).toContain('fx_skipped');
  });
});

describe('fx vignette-breathe', () => {
  it('breathes the vignette angle on a sine around the focus, capped at the peak', () => {
    const { text } = fx('vignette-breathe', { angle: 0.6, swing: 0.05, period: 6, focus: { x: 0.5, y: 0.4 } });

    expect(text).toContain('color=c=white:s=640x360');
    expect(text).toContain('format=gray,lutyuv=y=255,vignette=');
    expect(text).toContain("angle='0.6+0.05*sin(2*PI*(t-0.3)/6)':x0=320:y0=144:eval=frame");
    expect(text).toContain("lutyuv=y='min(30.6,");
    expect(text).toContain('color=c=#0A0806:s=1280x720');
    expect(fx('vignette-breathe', { swing: 0 }).text).toMatch(/vignette=angle='[\d.]+':/);
  });

  it('falls back to a still radial gradient without vignette, and skips with neither', () => {
    const still = fx('vignette-breathe', {}, { has: (f: string) => f !== 'vignette' });

    expect(still.text).toMatch(/gradients=s=640x360:type=radial:c0=0x000000/);
    expect(still.text).not.toContain('vignette');

    const none = fx('vignette-breathe', {}, { has: (f: string) => f !== 'vignette' && f !== 'gradients' });

    expect(none.filters).toEqual([]);
  });
});

describe('fx grain', () => {
  it('grains a tap of the picture (luma only, seeded, temporal) and mixes it at a constant alpha', () => {
    const { text } = fx('grain');

    expect(text).toMatch(/\[fx0_tap\]trim=start=0.3,noise=c0s=10:c0f=t:all_seed=\d+,format=yuva420p,lutyuv=a=255,/);
    expect(fx('grain', { animated: false }).text).toMatch(/noise=c0s=10:all_seed=/);
    expect(fx('grain', { size: 3 }).text).toMatch(/scale=\d+:\d+,noise=c0s=10:c0f=t:all_seed=\d+,scale=1280:720/);
    expect(fx('grain', { intensity: 1 }).text).toContain('noise=c0s=12:');
  });
});

// Real FFmpeg: the measured strength of each texture stays under the ambient ceiling.
const W = 320;
const H = 180;
const dir = testBuildDir('fx-ambient-render');
const ready = hasFfmpeg();
const frames: Record<string, Buffer[]> = {};
const GREY = `color=c=0x808080:s=${W}x${H}:r=30:d=1.6`;
const LIT = `color=c=0x101010:s=${W}x${H}:r=30:d=1.6,format=yuv420p,drawbox=x=120:y=60:w=80:h=60:color=white:t=fill`;
const SPEC = { width: W, height: H, seconds: 1.6, dir };
const OPTIONS = { scale: `${W}:${H}`, at: 0.2 };

beforeAll(() => {
  if (!ready) return;

  const max = { duration: 1.2, intensity: 1 };

  frames.vignette = renderFrames(
    { ...SPEC, base: GREY, name: 'vig' },
    fx('vignette-breathe', { ...max, focus: { x: 0.5, y: 0.5 } }, OPTIONS)
  );
  frames.grain = renderFrames({ ...SPEC, base: GREY, name: 'grain' }, fx('grain', max, OPTIONS));
  frames.grainAgain = renderFrames({ ...SPEC, base: GREY, name: 'grain-again' }, fx('grain', max, OPTIONS));
  frames.grey = renderFrames({ ...SPEC, base: GREY, name: 'grey' }, null);
  frames.bloom = renderFrames({ ...SPEC, base: LIT, name: 'bloom' }, fx('bloom', { ...max, radius: 0.05 }, OPTIONS));
  frames.lit = renderFrames({ ...SPEC, base: LIT, name: 'lit' }, null);
}, 120000);

function extremes(values: number[]): { min: number; max: number } {
  return values.reduce((acc, v) => ({ min: Math.min(acc.min, v), max: Math.max(acc.max, v) }), { min: 0, max: 0 });
}

function deltas(fx: Buffer[], none: Buffer[], at: (x: number, y: number) => boolean = () => true): number[] {
  const out: number[] = [];

  for (const [i, frame] of fx.entries()) {
    for (let y = 0; y < H; y += 2) {
      for (let x = 0; x < W; x += 2) if (at(x, y)) out.push(lumaAt(frame, W, x, y) - lumaAt(none[i], W, x, y));
    }
  }

  return out;
}

describe.skipIf(!ready)('fx ambient primitives on real frames', () => {
  it('vignette: darkens the corners by at most 12 % and leaves the focus alone', () => {
    const all = deltas(frames.vignette, frames.grey);
    const centre = deltas(frames.vignette, frames.grey, (x, y) => Math.abs(x - W / 2) < 20 && Math.abs(y - H / 2) < 12);

    expect(extremes(all).min).toBeLessThan(-3);
    expect(extremes(all).min).toBeGreaterThanOrEqual(-Math.ceil(0.12 * (126 - 16)) - 1);
    expect(extremes(centre).min).toBeGreaterThanOrEqual(-1);
  });

  it('grain: a fine, zero-mean texture of a few code values, same bytes every run', () => {
    const all = deltas(frames.grain.slice(12, 30), frames.grey.slice(12, 30));
    const mean = all.reduce((sum, d) => sum + d, 0) / all.length;
    const deviation = Math.sqrt(all.reduce((sum, d) => sum + (d - mean) ** 2, 0) / all.length);
    const { min, max } = extremes(all);

    // Noise strength 12 at the ceiling: a standard deviation of a few code values, never a blotch.
    expect(deviation).toBeGreaterThan(1);
    expect(deviation).toBeLessThan(8);
    expect(Math.max(max, -min)).toBeLessThanOrEqual(3 * 12);
    expect(Math.abs(mean)).toBeLessThan(0.3);

    const sha = (list: Buffer[]): string => createHash('sha256').update(Buffer.concat(list)).digest('hex');

    expect(sha(frames.grain)).toBe(sha(frames.grainAgain));
  });

  it('bloom: highlights halate into the dark surround, under the 0.12 ceiling', () => {
    const halo = deltas(frames.bloom, frames.lit, (x, y) => x > 100 && x < 118 && y > 70 && y < 110);
    const all = deltas(frames.bloom, frames.lit);

    expect(extremes(halo).max).toBeGreaterThan(3);
    expect(extremes(all).max).toBeLessThanOrEqual(Math.ceil(0.12 * 219) + 1);
    expect(frames.bloom.at(-1)?.equals(frames.lit.at(-1) as Buffer)).toBe(true);
  });
});
