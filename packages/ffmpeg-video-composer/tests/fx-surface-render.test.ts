import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Filter, Section } from '@/core/types';
import { lowerFx } from '@/editor/presets/fx';
import { parseSpriteUrl, spritePng, type SpriteSpec } from '@/editor/presets/fx-sprites';
import type { SugarContext } from '@/editor/presets/sugar-context';
import { renderFilterGraph } from '@/editor/utils/filter-graph';
import type { FxGraphic } from '@/schemas/fx.schemas';
import { testBuildDir } from './fixtures/build-dir';

// glass and resolve through real FFmpeg, on raw RGB frames. Glass: the text contrast on the plate holds at
// ≥ 4.5:1 over a hostile footage stand-in (white and black patches, heavy grain), whatever the tint, and
// nothing changes outside the card or the window. Resolve: the element sharpens frame by frame (no jump in
// sharpness), the glow hides it before `at`, and the frame is untouched once the pass ends.

const FPS = 25;
const [W, H] = [640, 360];
const dir = testBuildDir('fx-surface-render');

function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-hide_banner', '-filters'], { stdio: 'pipe' });

    return true;
  } catch {
    return false;
  }
}

function filterText(filter: Filter): string {
  return filter.value === undefined ? filter.type : `${filter.type}=${String(filter.value)}`;
}

function sugar(inputs: Map<string, string>, missing: string[]): SugarContext {
  return {
    duration: 2,
    scale: `${W}:${H}`,
    fps: FPS,
    isVideo: false,
    motion: { energy: 1, seedFor: () => 5, resolveText: () => '' },
    masks: {
      available: true,
      input: (key, source) => {
        inputs.set(key, 'url' in source ? source.url : '');

        return `input:${key}`;
      },
      color: (color) => color,
      warn: (message) => {
        throw new Error(message);
      },
      has: (filter) => !missing.includes(filter),
    },
  };
}

// Raw rgb24 frames of `base` with (or without) the fx graphic.
function render(base: string, graphic: Partial<FxGraphic> | null, missing: string[] = []): Buffer[] {
  const inputs = new Map<string, string>();
  const g = { type: 'fx', ...graphic } as FxGraphic;
  const section = { name: 's', type: 'color_background', graphics: [g] } as unknown as Section;
  const at = typeof g.at === 'number' ? g.at : 0;
  const filters = graphic
    ? lowerFx({ graphic: g, at, until: undefined, seed: 9, index: 0, section, ctx: sugar(inputs, missing) })
    : [];
  const keys = [...inputs.keys()];
  const graph = filters[0]?.graph ? renderFilterGraph(filters[0].graph, filterText, (key) => keys.indexOf(key)) : '';
  const files = [...inputs.values()].map((url, i) => {
    const file = path.join(dir, `${g.effect}-${i}.png`);

    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, spritePng(parseSpriteUrl(url) as SpriteSpec));

    return file;
  });
  const raw = execFileSync(
    'ffmpeg',
    [
      '-v',
      'error',
      ...files.flatMap((file) => ['-loop', '1', '-i', file]),
      '-filter_complex',
      graph ? `${base},${graph}` : base,
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      '-',
    ],
    { maxBuffer: 1 << 30 }
  );
  const size = W * H * 3;

  return Array.from({ length: raw.length / size }, (_, i) => raw.subarray(i * size, (i + 1) * size));
}

function luminance(frame: Buffer, x: number, y: number): number {
  const linear = (v: number) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
  const i = (y * W + x) * 3;

  return 0.2126 * linear(frame[i]) + 0.7152 * linear(frame[i + 1]) + 0.0722 * linear(frame[i + 2]);
}

const CARD = { x: 80, y: 200, w: 480, h: 100, radius: 20 };

// Footage at its worst for a plate: grain, a white patch and a black patch right behind the card.
const FOOTAGE =
  `color=c=0x808080:s=${W}x${H}:r=${FPS}:d=2,format=yuv420p,` +
  'drawbox=x=100:y=190:w=200:h=120:color=white:t=fill,drawbox=x=360:y=190:w=160:h=120:color=black:t=fill,' +
  'noise=alls=40:allf=t+u:all_seed=3';

// The card's luminance range inside its rounded corners and away from the 1–2 px rim.
function cardRange(frame: Buffer): [number, number] {
  let [low, high] = [1, 0];

  for (let y = CARD.y + 4; y < CARD.y + CARD.h - 4; y++) {
    for (let x = CARD.x + CARD.radius; x < CARD.x + CARD.w - CARD.radius; x++) {
      const l = luminance(frame, x, y);

      [low, high] = [Math.min(low, l), Math.max(high, l)];
    }
  }

  return [low, high];
}

const DARK_TEXT = 0.0103; // #1A1A1A

describe.skipIf(!hasFfmpeg())('fx glass render', () => {
  const glass = { effect: 'glass', at: 0.2, duration: 1.4, target: CARD } as Partial<FxGraphic>;
  const steady = 20; // a frame inside the window, past the ramp

  it.each([
    ['default tint', {}, []],
    ['a bright authored tint at full intensity', { color: '#FFD000', intensity: 1 }, []],
    ['no gblur on this build', {}, ['gblur']],
  ])('dark glass keeps white text at ≥ 4.5:1 with %s', (_label, extra, missing) => {
    const frame = render(FOOTAGE, { ...glass, ...extra }, missing as string[])[steady];
    const [, high] = cardRange(frame);

    expect((1 + 0.05) / (high + 0.05)).toBeGreaterThanOrEqual(4.5);
  });

  it('light glass keeps dark text at ≥ 4.5:1, even tinted dark', () => {
    for (const extra of [{}, { color: '#203040', intensity: 1 }]) {
      const frame = render(FOOTAGE, { ...glass, tone: 'light', ...extra })[steady];
      const [low] = cardRange(frame);

      expect((low + 0.05) / (DARK_TEXT + 0.05)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('changes nothing outside the card, nor outside the window', () => {
    const plain = render(FOOTAGE, null);
    const lit = render(FOOTAGE, glass);

    expect(lit[0].equals(plain[0])).toBe(true);
    expect(lit.at(-1)?.equals(plain.at(-1) as Buffer)).toBe(true);

    const frame = lit[steady];
    const base = plain[steady];

    for (let y = 0; y < H; y += 3) {
      for (let x = 0; x < W; x += 3) {
        const outside = x < CARD.x || x >= CARD.x + CARD.w || y < CARD.y || y >= CARD.y + CARD.h;

        if (outside) expect(frame[(y * W + x) * 3], `${x},${y}`).toBe(base[(y * W + x) * 3]);
      }
    }
  });
});

describe.skipIf(!hasFfmpeg())('fx resolve render', () => {
  const LOGO = `color=c=0x141a26:s=${W}x${H}:r=${FPS}:d=2,format=yuv420p,drawbox=x=260:y=150:w=120:h=60:color=white:t=fill`;
  const resolve = { effect: 'resolve', at: 0.4, target: { x: 220, y: 120, w: 200, h: 120 } } as Partial<FxGraphic>;
  // Sharpness: the steepest luma step across the logo's left edge on its middle row.
  const sharpness = (frame: Buffer) =>
    Math.max(
      ...Array.from({ length: 40 }, (_, i) => Math.abs(frame[(180 * W + 241 + i) * 3] - frame[(180 * W + 240 + i) * 3]))
    );

  it('sharpens frame by frame, with no jump in sharpness', () => {
    const frames = render(LOGO, resolve);
    const pass = frames.slice(10, 28).map(sharpness);
    const steps = pass.slice(1).map((value, i) => value - pass[i]);
    const total = (pass.at(-1) ?? 0) - pass[0];

    expect(total).toBeGreaterThan(100);
    expect(Math.min(...steps)).toBeGreaterThanOrEqual(-2);
    expect(Math.max(...steps)).toBeLessThanOrEqual(total * 0.4);
  });

  it('hides the element behind its glow before `at` and leaves the frame untouched after the pass', () => {
    const plain = render(LOGO, null);
    const frames = render(LOGO, resolve);

    expect(sharpness(frames[5])).toBeLessThan(sharpness(plain[5]) / 4);
    // The pass is 18 frames from 0.4 s: frame 28 is its last, frame 29 the first untouched one.
    expect(frames[29].equals(plain[29])).toBe(true);
    // The last frame of the pass already matches the sharp logo (no pop when the effect lets go).
    const delta = frames[28].reduce((worst, value, i) => Math.max(worst, Math.abs(value - plain[28][i])), 0);

    expect(delta).toBeLessThanOrEqual(6);
  });
});
