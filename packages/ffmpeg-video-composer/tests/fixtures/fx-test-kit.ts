import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Filter, FilterGraphChain, Section } from '@/core/types';
import { lowerFx } from '@/editor/presets/fx';
import { parseSpriteUrl, spritePng, type SpriteSpec } from '@/editor/presets/fx-sprites';
import type { SugarContext } from '@/editor/presets/sugar-context';
import { renderFilterGraph } from '@/editor/utils/filter-graph';
import type { FxGraphic } from '@/schemas/fx.schemas';

// Shared harness for the fx primitive suites: lower one fx graphic in a fake section (graph text, sprite
// URLs, warnings), and run that graph through real FFmpeg over a lavfi backdrop to raw yuv420p frames.

export interface LowerOptions {
  energy?: number;
  has?: (filter: string) => boolean;
  seed?: number;
  scale?: string;
  at?: number;
  fps?: number;
  index?: number;
}

export interface Lowered {
  text: string;
  /** The sprite URLs registered as extra inputs, in order. */
  urls: string[];
  warnings: string[];
  filters: Filter[];
}

function sugar(options: LowerOptions, urls: string[], warnings: string[]): SugarContext {
  return {
    duration: 6,
    scale: options.scale ?? '1280:720',
    fps: options.fps ?? 30,
    isVideo: false,
    motion: { energy: options.energy ?? 1, seedFor: () => 1, resolveText: () => '' },
    masks: {
      available: true,
      input: (_key, source) => {
        urls.push('url' in source ? source.url : '');

        return `input:${urls.length - 1}`;
      },
      color: (color) => color,
      warn: (message) => warnings.push(message),
      has: options.has ?? (() => true),
    },
  };
}

function filterText(filter: Filter): string {
  return filter.value === undefined ? filter.type : `${filter.type}=${String(filter.value)}`;
}

/** The graph as FFmpeg text, extra inputs as [<n>:v]. */
export function graphText(filters: Filter[]): string {
  const chains: FilterGraphChain[] = filters.flatMap((filter) => filter.graph ?? []);

  return chains.length > 0 ? renderFilterGraph(chains, filterText, (key) => Number(key)) : '';
}

export function lowerGraphic(graphic: Record<string, unknown>, options: LowerOptions = {}): Lowered {
  const urls: string[] = [];
  const warnings: string[] = [];
  const g = { type: 'fx', ...graphic } as FxGraphic;
  const section = { name: 's', type: 'color_background', graphics: [g] } as unknown as Section;
  const ctx = sugar(options, urls, warnings);
  const at = options.at ?? 0.3;
  const filters = lowerFx({
    graphic: g,
    at,
    until: undefined,
    seed: options.seed ?? 77,
    index: options.index ?? 0,
    section,
    ctx,
  });

  return { text: graphText(filters), urls, warnings, filters };
}

export function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-hide_banner', '-filters'], { stdio: 'pipe' });

    return true;
  } catch {
    return false;
  }
}

export interface RenderSpec {
  /** A lavfi chain producing the backdrop at width×height, e.g. `color=c=0x808080:s=640x360:r=30:d=2`. */
  base: string;
  width: number;
  height: number;
  /** Seconds rendered. */
  seconds: number;
  dir: string;
  name: string;
}

/** Raw yuv420p frames of the backdrop with the lowered graph applied (none = the plain backdrop). */
export function renderFrames(spec: RenderSpec, lowered: Lowered | null): Buffer[] {
  fs.mkdirSync(spec.dir, { recursive: true });

  const files = (lowered?.urls ?? []).map((url, i) => {
    const file = path.join(spec.dir, `${spec.name}-${i}.png`);

    fs.writeFileSync(file, spritePng(parseSpriteUrl(url) as SpriteSpec));

    return file;
  });
  const base = `${spec.base},format=yuv420p`;
  const graph = lowered?.text ? `${base},${lowered.text}` : base;
  const args = [
    '-v',
    'error',
    ...files.flatMap((file) => ['-loop', '1', '-t', String(spec.seconds), '-i', file]),
    '-filter_complex',
    graph,
    '-t',
    String(spec.seconds),
    '-f',
    'rawvideo',
    '-pix_fmt',
    'yuv420p',
    '-',
  ];
  const raw = execFileSync('ffmpeg', args, { maxBuffer: 1 << 30 });
  const size = spec.width * spec.height * 1.5;

  return Array.from({ length: Math.floor(raw.length / size) }, (_, i) => raw.subarray(i * size, (i + 1) * size));
}

/** Luma of a raw yuv420p frame at (x, y). */
export function lumaAt(frame: Buffer, width: number, x: number, y: number): number {
  return frame[y * width + x];
}
