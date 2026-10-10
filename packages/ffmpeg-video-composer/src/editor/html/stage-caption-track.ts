// The asset stage of an HTML caption track (subtitles.renderer "html", editor/presets/subtitles-html.ts):
// every distinct caption look rasterised once as an HTML layer (named by content hash, so a look repeated
// within the track, across sections or across renders is drawn once), plus one transparent raster, then
// played as a single timed image stream through the concat demuxer: a list naming each raster with how long
// it stays. One `-i` for the whole track and one decoded frame at a time, however long the transcript.
//
// A raster takes over half a frame before the first frame that shows it, so the overlay (which picks the
// latest image at or before each video frame) switches on exactly the frame drawtext's `enable` would.

import { parseVerticalMetrics } from '@/core/font-metrics';
import { assertSafeArgToken } from '@/core/arg-guard';
import { captionHtml, type CaptionMetrics, type CaptionTrack } from '@/core/captions/caption-html';
import type { CaptionState } from '@/core/captions/caption-frames';
import { utf8 } from '@/core/determinism/hash';
import { sha256Hex } from '@/core/determinism/sha256';
import { fmt } from '@/core/motion/hermite';
import { stageHtmlLayer, type HtmlStageContext } from './stage-html-layer';

export interface StagedCaptionTrack {
  /** The `-i` fragment of the timed stream. */
  arg: string;
  /** Distinct rasters the track composites (its looks plus the blank one). */
  rasters: number;
}

/** Rubik's hhea metrics, for a face whose tables cannot be read. */
const FALLBACK_METRICS: CaptionMetrics = { ascent: 0.935, descent: 0.25, weight: 400 };

interface Entry {
  path: string;
  from: number;
  to: number;
}

function stateKey(state: CaptionState): string {
  return `${state.cue}:${state.active}:${state.filled}:${state.bump}:${state.reveal}`;
}

async function metricsOf(track: CaptionTrack, ctx: HtmlStageContext): Promise<CaptionMetrics> {
  const metrics = parseVerticalMetrics(await ctx.loadFont(track.look.font));

  if (metrics) return metrics;

  ctx.logger.warn(`[${ctx.section}][Captions] cannot read ${track.look.font}'s line metrics: baseline approximated`);

  return FALLBACK_METRICS;
}

// Each look's raster, staged through the HTML layer path (its own log lines silenced: one summary instead).
async function stageLooks(track: CaptionTrack, ctx: HtmlStageContext): Promise<Map<string, string>> {
  const { logger } = ctx;
  const quietLogger = {
    debug: (message: string) => {
      logger.debug(message);
    },
    info: () => {},
    warn: (message: string) => {
      logger.warn(message);
    },
    error: (message: string) => {
      logger.error(message);
    },
  };
  const quiet: HtmlStageContext = { ...ctx, logger: quietLogger };
  const metrics = await metricsOf(track, ctx);
  const { band } = track;
  const box = { width: band.width, height: band.height };
  const paths = new Map<string, string>();
  const blank = {
    name: 'caption-blank',
    html: `<div style="display:flex;width:${band.width}px;height:${band.height}px"></div>`,
  };

  paths.set('blank', (await stageHtmlLayer({ ...blank, ...box }, quiet)).path);

  // One at a time: a phone or a browser draws them on a single WebView / worker anyway, and only the
  // raster being drawn is held in memory.
  const looks = [...new Map(track.slides.map((slide) => [stateKey(slide.state), slide.state])).entries()];

  await looks.reduce<Promise<void>>(
    (chain, [key, state]) =>
      chain.then(async () => {
        const html = captionHtml({ plan: track.plan, state, look: track.look, band, metrics });
        const staged = await stageHtmlLayer({ name: `caption-${paths.size}`, html, ...box }, quiet);

        paths.set(key, staged.path);
      }),
    Promise.resolve()
  );

  return paths;
}

function entries(track: CaptionTrack, paths: Map<string, string>): Entry[] {
  const blank = paths.get('blank') as string;
  const out: Entry[] = [];
  let cursor = 0;

  for (const slide of track.slides) {
    if (slide.from > cursor) out.push({ path: blank, from: cursor, to: slide.from });

    out.push({ path: paths.get(stateKey(slide.state)) as string, from: slide.from, to: slide.to });
    cursor = slide.to;
  }

  return [...out, { path: blank, from: cursor, to: cursor + 1 }];
}

function quoted(path: string): string {
  return `'${path.replaceAll("'", String.raw`'\''`)}'`;
}

// Durations are differences of rounded switch times, so their running sum lands on each switch exactly.
// Each image is read at twice the output rate: the image demuxer otherwise stamps it on a 1/25 s clock,
// which would move the half-frame switch times onto the wrong frames.
function concatList(track: CaptionTrack, paths: Map<string, string>): string {
  function at(frame: number): number {
    return Number((frame === 0 ? 0 : (frame - 0.5) / track.fps).toFixed(6));
  }

  const lines = entries(track, paths).flatMap((entry) => [
    `file ${quoted(entry.path)}`,
    `option framerate ${fmt(track.fps * 2)}`,
    `duration ${fmt(at(entry.to) - at(entry.from))}`,
  ]);

  return ['ffconcat version 1.0', ...lines, ''].join('\n');
}

/** Rasterises a caption track and writes its timed list; returns the list's `-i` fragment. */
export async function stageCaptionTrack(track: CaptionTrack, ctx: HtmlStageContext): Promise<StagedCaptionTrack> {
  const paths = await stageLooks(track, ctx);
  const list = concatList(track, paths);
  const path = `${ctx.dir}/captions-${sha256Hex(list).slice(0, 16)}.ffconcat`;

  if (!(await ctx.filesystem.stat(path))) await ctx.filesystem.writeFile(path, utf8(list));

  const rasters = new Set(paths.values()).size;
  const { width, height } = track.band;

  ctx.logger.info(
    `[${ctx.section}][Captions] ${track.slides.length} slides from ${rasters} rasters (${width}×${height})`
  );

  return { arg: `-f concat -safe 0 -i ${assertSafeArgToken(path, 'caption track')}`, rasters };
}
