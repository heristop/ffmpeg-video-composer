import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Filter, Section } from '@/core/types';
import { lowerFx } from '@/editor/presets/fx';
import { parseSpriteUrl, spritePng, type SpriteSpec } from '@/editor/presets/fx-sprites';
import type { SugarContext } from '@/editor/presets/sugar-context';
import { renderFilterGraph } from '@/editor/utils/filter-graph';
import type { FxGraphic } from '@/schemas/fx.schemas';
import { testBuildDir } from './fixtures/build-dir';

// burst through real FFmpeg, on raw frames: the rays stand on their authored angles, between the radii the
// trim path predicts at that frame, and nowhere else; nothing draws outside the window; same bytes twice.
// FX_BURST_DUMP=<dir> also writes a contact strip for eyes.

const FPS = 30;
const AT = 0.2;
const DURATION = 0.9;
const SECTION = 1.6;
const [WIDTH, HEIGHT] = [640, 360];
const ORIGIN = { x: 320, y: 180 };
// A 100 px square: radius [0.6, 1.6] → the rays travel 60 → 160 px; length 0.5 → 50 px at full length.
const TARGET = { x: 270, y: 130, w: 100, h: 100 };
const [INNER, OUTER, LENGTH] = [60, 160, 50];
const GRAPHIC = {
  type: 'fx',
  effect: 'burst',
  at: AT,
  duration: DURATION,
  target: TARGET,
  rays: 4,
  radius: [0.6, 1.6],
  length: 0.5,
  thickness: 18,
  jitter: 0,
  ease: 'linear',
  color: '#FFFFFF',
  intensity: 1,
} as unknown as FxGraphic;
const dir = testBuildDir('fx-burst-render');
const dump = process.env.FX_BURST_DUMP;

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

function args(graphic: FxGraphic | null, name: string, tail: string[], post = ''): string[] {
  const inputs: string[] = [];
  const ctx: SugarContext = {
    duration: SECTION,
    scale: `${WIDTH}:${HEIGHT}`,
    fps: FPS,
    isVideo: false,
    motion: { energy: 1, seedFor: () => 5, resolveText: () => '' },
    masks: {
      available: true,
      input: (key, source) => {
        inputs.push(`${key}=${'url' in source ? source.url : ''}`);

        return `input:${key}`;
      },
      color: (color) => color,
      warn: (message) => {
        throw new Error(message);
      },
      has: () => true,
    },
  };
  const section = { name: 's', type: 'color_background', graphics: [graphic] } as unknown as Section;
  const filters = graphic ? lowerFx({ graphic, at: AT, until: undefined, seed: 9, index: 0, section, ctx }) : [];
  const keys = inputs.map((entry) => entry.slice(0, entry.indexOf('=')));
  const graph = filters[0]?.graph ? renderFilterGraph(filters[0].graph, filterText, (key) => keys.indexOf(key)) : '';
  const files = inputs.map((entry, i) => {
    const file = path.join(dir, `${name}-${i}.png`);

    fs.writeFileSync(file, spritePng(parseSpriteUrl(entry.slice(entry.indexOf('=') + 1)) as SpriteSpec));

    return file;
  });
  const base = `color=c=0x141416:s=${WIDTH}x${HEIGHT}:r=${FPS}:d=${SECTION},format=yuv420p`;

  return [
    '-v',
    'error',
    ...files.flatMap((file) => ['-loop', '1', '-i', file]),
    '-filter_complex',
    `${graph ? `${base},${graph}` : base}${post}`,
    ...tail,
  ];
}

function render(graphic: FxGraphic | null, name: string): Buffer[] {
  const raw = execFileSync('ffmpeg', args(graphic, name, ['-f', 'rawvideo', '-pix_fmt', 'gray', '-']), {
    maxBuffer: 1 << 28,
  });
  const size = WIDTH * HEIGHT;

  return Array.from({ length: raw.length / size }, (_, i) => raw.subarray(i * size, (i + 1) * size));
}

/**
 * Radii (px from the origin) along `angle` degrees where the frame is lit well above the background, within
 * 2 px either side of the line (a stub ray is 2 px wide and lands on either side of it).
 */
function litRadii(frame: Buffer, plain: Buffer, angle: number): number[] {
  const theta = (angle * Math.PI) / 180;
  const [c, s] = [Math.cos(theta), Math.sin(theta)];

  return Array.from({ length: 200 }, (_, r) => r).filter((r) =>
    [-2, -1, 0, 1, 2].some((side) => {
      const x = Math.round(ORIGIN.x + c * r - s * side);
      const y = Math.round(ORIGIN.y + s * r + c * side);

      return frame[y * WIDTH + x] - plain[y * WIDTH + x] > 40;
    })
  );
}

/** The ray's predicted extent at section time t (linear trim path over 70 % of the duration, see fx-burst.ts). */
function predicted(t: number): [number, number] {
  const p = (t - AT) / (DURATION * 0.7);
  const head = INNER + (OUTER - INNER) * Math.min(1, Math.max(0, p / 0.6));
  const tail = INNER + (OUTER - INNER) * Math.min(1, Math.max(0, (p - 0.3) / 0.7));
  const length = LENGTH * Math.min(1, Math.max(0.3, (head - tail) / LENGTH));
  const mid = (head + tail) / 2;

  return [mid - length / 2, mid + length / 2];
}

const ready = hasFfmpeg();
let plain: Buffer[] = [];
let burst: Buffer[] = [];
let turned: Buffer[] = [];
let dotted: Buffer[] = [];

beforeAll(() => {
  if (!ready) return;

  fs.mkdirSync(dir, { recursive: true });
  plain = render(null, 'plain');
  burst = render(GRAPHIC, 'burst');
  turned = render({ ...GRAPHIC, rotation: 45 } as FxGraphic, 'turned');
  dotted = render({ ...GRAPHIC, dots: true, jitter: 0.2, duration: 0.4 } as FxGraphic, 'dotted');

  if (!dump) return;

  fs.mkdirSync(dump, { recursive: true });
  execFileSync(
    'ffmpeg',
    args(
      GRAPHIC,
      'burst-dump',
      ['-frames:v', '1', '-y', path.join(dump, 'burst.png')],
      String.raw`,select=between(n\,6\,35),tile=6x5`
    )
  );
}, 120000);

describe.skipIf(!ready)('burst on real frames', () => {
  it('stands every ray on its angle, between the radii the trim path predicts', () => {
    for (const n of [9, 12, 14, 16]) {
      const [near, far] = predicted(n / FPS);

      for (const angle of [-90, 0, 90, 180]) {
        const lit = litRadii(burst[n], plain[n], angle);

        expect(lit.length, `frame ${n} ray ${angle}°`).toBeGreaterThan(8);
        expect(Math.min(...lit), `frame ${n} ray ${angle}° tail`).toBeGreaterThanOrEqual(near - 5);
        expect(Math.max(...lit), `frame ${n} ray ${angle}° head`).toBeLessThanOrEqual(far + 5);
        expect(Math.abs(Math.max(...lit) - far), `frame ${n} ray ${angle}° head`).toBeLessThanOrEqual(5);
      }

      // Between the rays (the diagonals) the frame is untouched.
      for (const angle of [-45, 45, 135, -135]) {
        expect(litRadii(burst[n], plain[n], angle), `frame ${n} gap ${angle}°`).toEqual([]);
      }
    }
  });

  it('turns the whole fan by `rotation`: diagonal rays are pre-rotated sprites on the diagonals', () => {
    const n = 14;
    const [, far] = predicted(n / FPS);

    for (const angle of [-45, 45, 135, -135]) {
      const lit = litRadii(turned[n], plain[n], angle);

      expect(lit.length, `ray ${angle}°`).toBeGreaterThan(20);
      expect(Math.abs(Math.max(...lit) - far), `ray ${angle}° head`).toBeLessThanOrEqual(6);
    }

    for (const angle of [-90, 0, 90, 180]) {
      expect(litRadii(turned[n], plain[n], angle), `gap ${angle}°`).toEqual([]);
    }
  });

  it('draws only inside its window', () => {
    const lit = burst.flatMap((frame, i) => (frame.equals(plain[i]) ? [] : [i]));

    expect(lit[0]).toBeGreaterThanOrEqual(Math.round(AT * FPS));
    expect(lit.at(-1)).toBeLessThanOrEqual(Math.round((AT + DURATION) * FPS));
  });

  it('leaves nothing behind after 70 % of its life: no ray, no faint dot', () => {
    // At 0.2 s for the default 0.4 s: everything is gone by 0.2 + 0.28 = 0.48 s, between frames 14 and 15
    // (off the frame grid: trim rounds its end to the nearest frame, so a branch must keep a clear frame).
    const last = Math.ceil((AT + 0.4 * 0.7) * FPS);
    const peak = (frame: Buffer, plainFrame: Buffer) =>
      frame.reduce((most, v, i) => Math.max(most, Math.abs(v - plainFrame[i])), 0);

    expect(peak(dotted[Math.round((AT + 0.1) * FPS)], plain[0])).toBeGreaterThan(120);

    for (let n = last; n < dotted.length; n++) expect(peak(dotted[n], plain[n]), `frame ${n}`).toBeLessThanOrEqual(2);
  });

  it('renders the same bytes twice', () => {
    const again = render(GRAPHIC, 'burst-again');

    expect(again.every((frame, i) => frame.equals(burst[i]))).toBe(true);
  }, 60000);
});
