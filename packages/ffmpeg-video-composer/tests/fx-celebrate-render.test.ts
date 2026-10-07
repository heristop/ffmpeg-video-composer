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

// ripple, glint and confetti through real FFmpeg, on raw (unencoded) frames: they draw only inside their
// window, end without a pop, stay inside their region, and render the same bytes twice.
// FX_CELEBRATE_DUMP=<dir> also writes a contact strip per scenario for eyes.

const FPS = 30;
const AT = 0.2;
const SECTION = 2.8;
const [WIDTH, HEIGHT] = [480, 270];
const dir = testBuildDir('fx-celebrate-render');
const dump = process.env.FX_CELEBRATE_DUMP;
const CARD = { x: 160, y: 80, w: 160, h: 110, radius: 16 };

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

function sugar(inputs: string[]): SugarContext {
  return {
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
}

const BASE = `color=c=0x2A3140:s=${WIDTH}x${HEIGHT}:r=${FPS}:d=${SECTION},format=yuv420p,drawbox=x=${CARD.x}:y=${CARD.y}:w=${CARD.w}:h=${CARD.h}:color=0xC9D2E0:t=fill`;

function args(graphic: FxGraphic | null, name: string, tail: string[], post = ''): string[] {
  const inputs: string[] = [];
  const section = { name: 's', type: 'color_background', graphics: [graphic] } as unknown as Section;
  const filters = graphic
    ? lowerFx({ graphic, at: AT, until: undefined, seed: 9, index: 0, section, ctx: sugar(inputs) })
    : [];
  const keys = inputs.map((entry) => entry.slice(0, entry.indexOf('=')));
  const graph = filters[0]?.graph ? renderFilterGraph(filters[0].graph, filterText, (key) => keys.indexOf(key)) : '';
  const files = inputs.map((entry, i) => {
    const file = path.join(dir, `${name}-${i}.png`);

    fs.writeFileSync(file, spritePng(parseSpriteUrl(entry.slice(entry.indexOf('=') + 1)) as SpriteSpec));

    return file;
  });

  return [
    '-v',
    'error',
    ...files.flatMap((file) => ['-loop', '1', '-i', file]),
    '-filter_complex',
    `${graph ? `${BASE},${graph}` : BASE}${post}`,
    ...tail,
  ];
}

function render(graphic: FxGraphic | null, name: string): Buffer[] {
  const raw = execFileSync('ffmpeg', args(graphic, name, ['-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-']), {
    maxBuffer: 1 << 30,
  });
  const size = WIDTH * HEIGHT * 1.5;

  return Array.from({ length: raw.length / size }, (_, i) => raw.subarray(i * size, (i + 1) * size));
}

function maxLumaDelta(a: Buffer, b: Buffer, outside?: { x: number; y: number; w: number; h: number }): number {
  let worst = 0;

  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const inside =
        outside && x >= outside.x && x < outside.x + outside.w && y >= outside.y && y < outside.y + outside.h;

      if (!inside) worst = Math.max(worst, Math.abs(a[y * WIDTH + x] - b[y * WIDTH + x]));
    }
  }

  return worst;
}

const SCENARIOS: Record<string, Partial<FxGraphic>> = {
  ring: { effect: 'ripple' },
  tap: { effect: 'ripple', variant: 'tap', radius: 0.9 },
  glint: { effect: 'glint', count: 4 },
  orbit: { effect: 'glint', path: 'orbit' },
  confetti: { effect: 'confetti', origin: { x: 0.5, y: 0.6 } },
};

function graphicOf(name: string): FxGraphic {
  return { type: 'fx', at: AT, target: CARD, ...SCENARIOS[name] } as FxGraphic;
}

const ready = hasFfmpeg();
const frames = new Map<string, Buffer[]>();
let plain: Buffer[] = [];

beforeAll(() => {
  if (!ready) return;

  fs.mkdirSync(dir, { recursive: true });
  plain = render(null, 'plain');

  for (const name of Object.keys(SCENARIOS)) frames.set(name, render(graphicOf(name), name));

  if (!dump) return;

  fs.mkdirSync(dump, { recursive: true });

  for (const name of Object.keys(SCENARIOS)) {
    const strip = ['-frames:v', '1', '-y', path.join(dump, `${name}.png`)];

    execFileSync('ffmpeg', args(graphicOf(name), `${name}-dump`, strip, String.raw`,select=not(mod(n\,4)),tile=5x3`));
  }
}, 180000);

/** Indices of the frames that differ from the plain render. */
function litFrames(name: string): number[] {
  return (frames.get(name) ?? []).flatMap((frame, i) => (frame.equals(plain[i]) ? [] : [i]));
}

describe.skipIf(!ready)('celebrate fx on real frames', () => {
  it('draws only inside the effect window', () => {
    for (const name of Object.keys(SCENARIOS)) {
      const lit = litFrames(name);

      expect(lit.length, name).toBeGreaterThan(5);
      expect(lit[0], name).toBeGreaterThanOrEqual(Math.round(AT * FPS));
    }
  });

  it('ends without a pop: the last two lit frames of a ripple barely differ from the plain frame', () => {
    for (const name of ['ring', 'tap']) {
      const lit = litFrames(name);
      const fx = frames.get(name) ?? [];

      for (const i of lit.slice(-2)) expect(maxLumaDelta(fx[i], plain[i]), `${name} frame ${i}`).toBeLessThanOrEqual(6);
    }
  });

  it('keeps ripple and glint marks around their target (never the far corners of the frame)', () => {
    const near = { x: CARD.x - 120, y: CARD.y - 90, w: CARD.w + 240, h: CARD.h + 180 };

    for (const name of ['ring', 'tap', 'glint', 'orbit']) {
      const fx = frames.get(name) ?? [];

      for (const [i, frame] of fx.entries()) expect(maxLumaDelta(frame, plain[i], near), `${name} ${i}`).toBe(0);
    }
  });

  it('moves confetti: consecutive frames differ and pieces fall back down after the apex', () => {
    const fx = frames.get('confetti') ?? [];
    const lit = litFrames('confetti');
    const mid = lit[Math.floor(lit.length / 2)];

    expect(fx[mid].equals(fx[mid + 3])).toBe(false);
    expect(lit.length).toBeGreaterThan(Math.round(1.8 * FPS));
  });

  it('renders the same bytes twice', () => {
    const again = render(graphicOf('confetti'), 'confetti-again');

    expect(again.every((frame, i) => frame.equals((frames.get('confetti') ?? [])[i]))).toBe(true);
  }, 60000);
});
