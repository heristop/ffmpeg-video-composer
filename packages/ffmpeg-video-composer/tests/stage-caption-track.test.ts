import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { stageCaptionTrack } from '@/editor/html/stage-caption-track';
import type { HtmlStageContext } from '@/editor/html/stage-html-layer';
import type { HtmlRasteriser, HtmlRasterRequest } from '@/core/html/html-rasteriser';
import { ENTRANCE_LEVELS, type CaptionSlide } from '@/core/captions/caption-frames';
import { captionBand, captionLook, type CaptionTrack } from '@/core/captions/caption-html';
import { planSubtitles } from '@/core/captions/plan';
import type { Subtitles } from '@/schemas/subtitles.schemas';

const here = dirname(fileURLToPath(import.meta.url));
const RUBIK = readFileSync(join(here, '../../leclap-creative-kit/src/library/fonts/Rubik.ttf'));
const FRAME = { width: 1280, height: 720 };

function track(slides: CaptionSlide[]): CaptionTrack {
  const subtitles = { cues: [{ at: 1, end: 3, text: 'Hello there' }], karaoke: 'word' } as Subtitles;
  const plan = planSubtitles(subtitles, { frame: FRAME, resolveText: (text) => text.en ?? text.text ?? '' });

  if (!plan) throw new Error('no plan');

  const look = captionLook(
    plan.style,
    { base: '#FFFFFF', active: '#FFD400', crown: '#FFD400', plate: undefined },
    undefined
  );

  return { plan, look, band: captionBand(plan, FRAME, look), fps: 30, slides };
}

function state(active: number) {
  return { cue: 0, active, filled: 0, bump: 0, reveal: ENTRANCE_LEVELS };
}

function context() {
  const requests: HtmlRasterRequest[] = [];
  const rasteriser: HtmlRasteriser = {
    version: 'test',
    render: vi.fn(async (request: HtmlRasterRequest) => {
      requests.push(request);

      return { png: new Uint8Array([requests.length]), contentHeight: 0 };
    }),
  };
  const written = new Map<string, Uint8Array>();
  const filesystem = {
    stat: vi.fn(async (path: string) => written.has(path)),
    writeFile: vi.fn(async (path: string, bytes: Uint8Array) => {
      written.set(path, bytes);
    }),
    readFile: vi.fn(async () => new Uint8Array()),
    resolveLocalAsset: vi.fn(async () => null),
  };
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const ctx: HtmlStageContext = {
    filesystem,
    logger,
    dir: '/build/panels',
    section: 'talk',
    lookup: () => undefined,
    defaultFamily: 'Rubik',
    loadFont: vi.fn(async () => new Uint8Array(RUBIK)),
    rasteriser,
    memory: new Map(),
  };

  return { ctx, requests, written, logger };
}

const SLIDES: CaptionSlide[] = [
  { from: 30, to: 45, state: state(0) },
  { from: 45, to: 60, state: state(1) },
  { from: 60, to: 75, state: state(0) },
  { from: 80, to: 90, state: state(-1) },
];

function listOf(written: Map<string, Uint8Array>): { path: string; text: string } {
  const entry = [...written.entries()].find(([path]) => path.endsWith('.ffconcat'));

  if (!entry) throw new Error('no list');

  return { path: entry[0], text: new TextDecoder().decode(entry[1]) };
}

describe('stageCaptionTrack', () => {
  it('rasterises each distinct look once, plus one blank, at the band size', async () => {
    const { ctx, requests } = context();
    const { band } = track(SLIDES);

    await stageCaptionTrack(track(SLIDES), ctx);

    // looks: active 0, active 1, none; and the blank.
    expect(requests).toHaveLength(4);
    expect(requests.every((request) => request.width === band.width && request.height === band.height)).toBe(true);
  });

  it('times the rasters as a concat list switching half a frame before each change', async () => {
    const { ctx, written } = context();
    const staged = await stageCaptionTrack(track(SLIDES), ctx);
    const { path, text } = listOf(written);
    const lines = text.trim().split('\n');
    const files = lines.filter((line) => line.startsWith('file ')).map((line) => line.slice(6, -1));
    const durations = lines.filter((line) => line.startsWith('duration ')).map((line) => Number(line.slice(9)));

    expect(staged.arg).toBe(`-f concat -safe 0 -i ${path}`);
    expect(lines[0]).toBe('ffconcat version 1.0');
    // blank, look 0, look 1, look 0, blank, none, blank.
    expect(files).toHaveLength(7);
    expect(files[0]).toBe(files[4]);
    expect(files[1]).toBe(files[3]);
    expect(files[0]).toBe(files[6]);
    expect(durations.slice(0, 6)).toEqual([29.5 / 30, 0.5, 0.5, 0.5, 5 / 30, 10 / 30].map((d) => Number(d.toFixed(6))));
    expect(files.every((file) => file.startsWith('/build/panels/html-'))).toBe(true);
    // Each image is read on a half-frame clock (the image demuxer's own default is 1/25 s), so the
    // switch times survive exactly.
    expect(lines.filter((line) => line.startsWith('option '))).toEqual(Array(7).fill('option framerate 60'));
  });

  it('names the list by its content and draws nothing twice', async () => {
    const { ctx, requests, written } = context();
    const first = await stageCaptionTrack(track(SLIDES), ctx);
    const second = await stageCaptionTrack(track(SLIDES), ctx);

    expect(second.arg).toBe(first.arg);
    expect(requests).toHaveLength(4);
    expect(first.rasters).toBe(4);
    expect(first.arg).toMatch(/captions-[0-9a-f]{16}\.ffconcat$/);
    expect(listOf(written).path).toMatch(/^\/build\/panels\//);
  });
});
