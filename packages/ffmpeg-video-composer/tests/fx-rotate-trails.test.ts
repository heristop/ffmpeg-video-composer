import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Filter, FilterGraphChain, Section } from '@/core/types';
import { lowerFx } from '@/editor/presets/fx';
import { parseSpriteUrl, spritePng, type SpriteSpec } from '@/editor/presets/fx-sprites';
import type { SugarContext } from '@/editor/presets/sugar-context';
import type { FxGraphic } from '@/schemas/fx.schemas';
import { testBuildDir } from './fixtures/build-dir';

// A `rotate` with `c=none` draws nothing outside the turned picture, so FFmpeg's frame pool hands back
// buffers that still hold earlier frames there: a piece turning over time leaves a smear of its previous
// angles (trails). Rotation preserves a sprite's total alpha, so a branch whose alpha keeps growing after
// the turn is drawing stale pixels. Each rotating branch of confetti and glint goes through real FFmpeg up to
// its rotate, and its alpha mass per frame is compared with the sprite's own (it must neither exceed it nor drift).

const FPS = 30;
const dir = testBuildDir('fx-rotate-trails');

function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-hide_banner', '-filters'], { stdio: 'pipe' });

    return true;
  } catch {
    return false;
  }
}

function lowered(graphic: Partial<FxGraphic>): { chains: FilterGraphChain[]; sprites: Map<string, SpriteSpec> } {
  const sprites = new Map<string, SpriteSpec>();
  const ctx: SugarContext = {
    duration: 3,
    scale: '640:360',
    fps: FPS,
    isVideo: false,
    motion: { energy: 1, seedFor: () => 3, resolveText: () => '' },
    masks: {
      available: true,
      input: (key, source) => {
        sprites.set(`input:${key}`, parseSpriteUrl('url' in source ? source.url : '') as SpriteSpec);

        return `input:${key}`;
      },
      color: (color) => color,
      warn: (message) => {
        throw new Error(message);
      },
      has: () => true,
    },
  };
  const g = { type: 'fx', target: { x: 220, y: 120, w: 200, h: 120 }, ...graphic } as FxGraphic;
  const section = { name: 's', type: 'color_background', graphics: [g] } as unknown as Section;
  const filters = lowerFx({ graphic: g, at: 0.2, until: undefined, seed: 5, index: 0, section, ctx });

  return { chains: filters.flatMap((filter) => filter.graph ?? []), sprites };
}

function text(filter: Filter): string {
  return filter.value === undefined ? filter.type : `${filter.type}=${String(filter.value)}`;
}

/** The sprite feeding a branch label, through the stream chain that split it. */
function spriteOf(chains: FilterGraphChain[], label: string, sprites: Map<string, SpriteSpec>): SpriteSpec {
  const stream = chains.find((chain) => chain.outputs?.includes(label));

  return sprites.get(stream?.inputs?.[0] ?? '') as SpriteSpec;
}

/** Sum of the alpha plane of every rgba frame. */
function alphaMass(raw: Buffer, w: number, h: number): number[] {
  const size = w * h * 4;

  return Array.from({ length: raw.length / size }, (_, i) => {
    let sum = 0;

    for (let k = i * size + 3; k < (i + 1) * size; k += 4) sum += raw[k];

    return sum;
  });
}

function rotatedMass(name: string, spec: SpriteSpec, filters: Filter[]): { frames: number[]; sprite: number } {
  const file = path.join(dir, `${name}.png`);
  const upTo = filters.slice(0, filters.findIndex((filter) => filter.type === 'rotate') + 1);
  const turn = /ow=(\d+):oh=(\d+)/.exec(String(upTo.at(-1)?.value ?? ''));
  const [w, h] = turn ? [Number(turn[1]), Number(turn[2])] : [spec.w, spec.h];
  const prep = `format=rgba,fps=${FPS},${upTo
    .filter((f) => f.type !== 'fade')
    .map(text)
    .join(',')}`;

  fs.writeFileSync(file, spritePng(spec));

  const raw = execFileSync(
    'ffmpeg',
    ['-v', 'error', '-loop', '1', '-i', file, '-vf', prep, '-t', '3', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'],
    {
      maxBuffer: 1 << 28,
    }
  );
  const still = execFileSync('ffmpeg', [
    '-v',
    'error',
    '-i',
    file,
    '-frames:v',
    '1',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgba',
    '-',
  ]);

  return { frames: alphaMass(raw, w, h), sprite: alphaMass(still, spec.w, spec.h)[0] };
}

const CASES: Record<string, Partial<FxGraphic>> = {
  confetti: { effect: 'confetti', count: 4, colors: ['#F96F99'], spin: 3, size: 64 },
  glint: { effect: 'glint', points: [{ x: 0.5, y: 0.5 }], spin: 90, size: 64 },
};

describe.skipIf(!hasFfmpeg())('fx rotate leaves no trails', () => {
  for (const [name, graphic] of Object.entries(CASES)) {
    it(`${name}: a turning piece keeps its own alpha mass on every frame`, () => {
      fs.mkdirSync(dir, { recursive: true });

      const { chains, sprites } = lowered(graphic);
      const turning = chains.filter((chain) => chain.filters.some((filter) => filter.type === 'rotate'));

      expect(turning.length, name).toBeGreaterThan(0);

      for (const [i, chain] of turning.slice(0, 2).entries()) {
        const spec = spriteOf(chains, chain.inputs?.[0] ?? '', sprites);
        const { frames, sprite } = rotatedMass(`${name}-${i}`, spec, chain.filters);

        expect(frames.length, name).toBeGreaterThan(10);

        // Bilinear edges add 10–25 % on a small sprite; stale pixels add up to the whole turn square (2× here).
        for (const [n, mass] of frames.entries()) {
          expect(mass / sprite, `${name} branch ${i} frame ${n}`).toBeLessThan(1.35);
        }

        expect((Math.max(...frames) - Math.min(...frames)) / sprite, `${name} branch ${i} drift`).toBeLessThan(0.05);
      }
    }, 60000);
  }
});
