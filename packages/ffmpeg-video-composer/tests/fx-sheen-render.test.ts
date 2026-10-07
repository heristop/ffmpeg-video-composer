import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Filter, Section } from '@/core/types';
import { lowerFx } from '@/editor/presets/fx';
import { bandProfile, parseSpriteUrl, spritePng, type SpriteSpec } from '@/editor/presets/fx-sprites';
import type { SugarContext } from '@/editor/presets/sugar-context';
import { renderFilterGraph } from '@/editor/utils/filter-graph';
import type { FxGraphic } from '@/schemas/fx.schemas';
import { testBuildDir } from './fixtures/build-dir';

// The sheen through real FFmpeg, on raw (unencoded) frames so every number is exact: the light never
// leaves its target, the window's first and last frames are untouched, the band's profile across its
// normal is the specified gaussian, the lift on mid-grey stays under the ceiling and a light card only
// ever gets lighter. FX_SHEEN_DUMP=<dir> also writes the frames as PNGs for eyes.

const FPS = 30;
const AT = 0.3;
const SECTION = 1.6;
const dir = testBuildDir('fx-sheen-render');
const dump = process.env.FX_SHEEN_DUMP;

function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-hide_banner', '-filters'], { stdio: 'pipe' });

    return true;
  } catch {
    return false;
  }
}

interface Scenario {
  name: string;
  width: number;
  height: number;
  base: string;
  card?: string;
  target: { x: number; y: number; w: number; h: number; radius?: number };
  graphic?: Partial<FxGraphic>;
}

function filterText(filter: Filter): string {
  if (filter.value !== undefined) return `${filter.type}=${String(filter.value)}`;

  return filter.type;
}

function sugar(width: number, height: number, inputs: string[]): SugarContext {
  return {
    duration: SECTION,
    scale: `${width}:${height}`,
    fps: FPS,
    isVideo: false,
    motion: { energy: 1, seedFor: () => 5, resolveText: () => '' },
    masks: {
      available: true,
      input: (key, source) => {
        inputs.push('url' in source ? source.url : '');

        return `input:${key}`;
      },
      color: (color) => color,
      warn: (message) => {
        throw new Error(message);
      },
      has: () => true,
    },
  };
}

function baseChain(s: Scenario): string {
  const card = s.card
    ? `,drawbox=x=${s.target.x}:y=${s.target.y}:w=${s.target.w}:h=${s.target.h}:color=${s.card}:t=fill`
    : '';

  return `color=c=${s.base}:s=${s.width}x${s.height}:r=${FPS}:d=${SECTION},format=yuv420p${card}`;
}

// Raw yuv420p frames of the scenario, with or without the sheen.
function render(s: Scenario, withFx: boolean): Buffer[] {
  const inputs: string[] = [];
  const graphic = { type: 'fx', effect: 'sheen', at: AT, target: s.target, ...s.graphic } as FxGraphic;
  const section = { name: 's', type: 'color_background', graphics: [graphic] } as unknown as Section;
  const filters = withFx
    ? lowerFx({ graphic, at: AT, until: undefined, seed: 9, index: 0, section, ctx: sugar(s.width, s.height, inputs) })
    : [];
  const graph = filters[0]?.graph ? renderFilterGraph(filters[0].graph, filterText, () => 0) : '';
  const files = inputs.map((url, i) => {
    const file = path.join(dir, `${s.name}-${i}.png`);

    fs.writeFileSync(file, spritePng(parseSpriteUrl(url) as SpriteSpec));

    return file;
  });
  const args = [
    '-v',
    'error',
    ...files.flatMap((file) => ['-loop', '1', '-i', file]),
    '-filter_complex',
    graph ? `${baseChain(s)},${graph}` : baseChain(s),
    '-f',
    'rawvideo',
    '-pix_fmt',
    'yuv420p',
    '-',
  ];
  const raw = execFileSync('ffmpeg', args, { maxBuffer: 1 << 30 });
  const size = s.width * s.height * 1.5;

  return Array.from({ length: raw.length / size }, (_, i) => raw.subarray(i * size, (i + 1) * size));
}

function lumaDelta(a: Buffer, b: Buffer, s: Scenario, x: number, y: number): number {
  return a[y * s.width + x] - b[y * s.width + x];
}

function inTarget(s: Scenario, x: number, y: number): boolean {
  const t = s.target;

  return x >= t.x && x < t.x + t.w && y >= t.y && y < t.y + t.h;
}

// The largest luma or chroma change outside the target between two raw yuv420p frames.
function worstOutside(s: Scenario, frame: Buffer, plain: Buffer): number {
  let worst = 0;

  for (let y = 0; y < s.height; y++) {
    for (let x = 0; x < s.width; x++) {
      if (!inTarget(s, x, y)) worst = Math.max(worst, Math.abs(lumaDelta(frame, plain, s, x, y)));
    }
  }

  const [cw, ch, luma] = [s.width / 2, s.height / 2, s.width * s.height];

  for (let y = 0; y < ch * 2; y++) {
    for (let x = 0; x < cw; x++) {
      const i = luma + y * cw + x;

      if (!inTarget(s, x * 2, (y % ch) * 2)) worst = Math.max(worst, Math.abs(frame[i] - plain[i]));
    }
  }

  return worst;
}

const GREY: Scenario = {
  name: 'grey',
  width: 640,
  height: 360,
  base: '0x808080',
  target: { x: 160, y: 90, w: 320, h: 180 },
  graphic: { tilt: 20, width: 0.15 },
};
const DARK: Scenario = {
  name: 'dark',
  width: 640,
  height: 360,
  base: '0x121826',
  card: '0x7F8BA3',
  target: { x: 128, y: 90, w: 384, h: 180, radius: 24 },
};
const LIGHT: Scenario = {
  name: 'light',
  width: 360,
  height: 640,
  base: '0xB9AE9F',
  card: '0xF0E8DC',
  target: { x: 60, y: 120, w: 240, h: 400, radius: 20 },
};
const SCENARIOS = [GREY, DARK, LIGHT];
const frames = new Map<string, { fx: Buffer[]; none: Buffer[] }>();
const ready = hasFfmpeg();

beforeAll(() => {
  if (!ready) return;

  fs.mkdirSync(dir, { recursive: true });

  for (const s of SCENARIOS) frames.set(s.name, { fx: render(s, true), none: render(s, false) });
}, 120000);

describe.skipIf(!ready)('fx sheen on real frames', () => {
  it('never lights a pixel outside its target (luma and chroma), in any frame', () => {
    for (const s of SCENARIOS) {
      const { fx, none } = frames.get(s.name) ?? { fx: [], none: [] };

      expect(fx.length).toBe(none.length);
      for (const [i, frame] of fx.entries()) {
        expect(worstOutside(s, frame, none[i]), `${s.name} frame ${i}`).toBe(0);
      }
    }
  });

  it('leaves the frames before and after the window identical to the plain render', () => {
    for (const s of SCENARIOS) {
      const { fx, none } = frames.get(s.name) ?? { fx: [], none: [] };
      const lit = fx.map((frame, i) => !frame.equals(none[i]));
      const first = lit.indexOf(true);
      const last = lit.lastIndexOf(true);

      expect(first, s.name).toBeGreaterThanOrEqual(Math.round(AT * FPS));
      expect(last, s.name).toBeLessThan(Math.round((AT + 0.8) * FPS));
      expect(fx[Math.round((AT - 0.05) * FPS)].equals(none[Math.round((AT - 0.05) * FPS)])).toBe(true);
      expect(fx.at(-1)?.equals(none.at(-1) as Buffer)).toBe(true);
    }
  });

  it('keeps rounded corners dark: the clip follows the target shape', () => {
    for (const s of [DARK, LIGHT]) {
      const { fx, none } = frames.get(s.name) ?? { fx: [], none: [] };

      for (const [i, frame] of fx.entries()) {
        expect(lumaDelta(frame, none[i], s, s.target.x + 1, s.target.y + 1), `${s.name} ${i}`).toBe(0);
        expect(lumaDelta(frame, none[i], s, s.target.x + s.target.w - 2, s.target.y + s.target.h - 2)).toBe(0);
      }
    }
  });

  it('lifts mid-grey by at most 38 code values and a light card only ever lighter', () => {
    const peakLift = (s: Scenario): { max: number; min: number } => {
      const { fx, none } = frames.get(s.name) ?? { fx: [], none: [] };
      let [max, min] = [0, 0];

      for (const [i, frame] of fx.entries()) {
        for (let y = s.target.y; y < s.target.y + s.target.h; y++) {
          for (let x = s.target.x; x < s.target.x + s.target.w; x++) {
            const d = lumaDelta(frame, none[i], s, x, y);
            [max, min] = [Math.max(max, d), Math.min(min, d)];
          }
        }
      }

      return { max, min };
    };
    const grey = peakLift(GREY);
    const light = peakLift(LIGHT);

    expect(grey.max).toBeGreaterThan(25);
    expect(grey.max).toBeLessThanOrEqual(38);
    // Light over a near-white card is physically subtle (a few code values) but must never grey it.
    expect(light.max).toBeGreaterThanOrEqual(2);
    expect(light.min).toBeGreaterThanOrEqual(0);
  });

  it('shapes the band across its normal as the specified gaussian (within 10 %)', () => {
    const { fx, none } = frames.get(GREY.name) ?? { fx: [], none: [] };
    const row = GREY.target.y + GREY.target.h / 2;
    const lifts = fx.map((frame, i) =>
      Array.from({ length: GREY.target.w }, (_, k) => lumaDelta(frame, none[i], GREY, GREY.target.x + k, row))
    );
    // The frame where the band is nearest the middle of the target.
    const best = lifts.reduce(
      (pick, lift, i) => {
        const at = lift.indexOf(Math.max(...lift));

        return Math.abs(at - GREY.target.w / 2) < Math.abs(pick.at - GREY.target.w / 2) && Math.max(...lift) > 0
          ? { i, at }
          : pick;
      },
      { i: 0, at: -1e9 }
    );
    const lift = lifts[best.i];
    const peak = lift[best.at];
    const width = 0.15 * GREY.target.h;
    const tilt = (20 * Math.PI) / 180;
    const spec = { width, peak: 1, bloom: 0.25 };

    for (const s of [width / 4, width / 2, -width / 4, -width / 2]) {
      const k = best.at + Math.round(s / Math.cos(tilt));
      const measured = lift[k] / peak;
      const expected = bandProfile(s, spec);

      expect(Math.abs(measured - expected), `offset ${s.toFixed(1)}: ${measured} vs ${expected}`).toBeLessThan(0.1);
    }

    if (dump) writeDump();
  });
});

function writeDump(): void {
  fs.mkdirSync(dump as string, { recursive: true });

  for (const s of SCENARIOS) {
    const { fx } = frames.get(s.name) ?? { fx: [] };
    const raw = Buffer.concat(fx);
    const file = path.join(dir, `${s.name}.yuv`);

    fs.writeFileSync(file, raw);
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'yuv420p',
      '-s',
      `${s.width}x${s.height}`,
      '-i',
      file,
      '-vf',
      String.raw`select=not(mod(n\,3)),tile=4x4`,
      '-frames:v',
      '1',
      path.join(dump as string, `${s.name}-tile.png`),
    ]);
  }
}
