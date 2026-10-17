// The asset stage of an animated HTML card (an html input with a `motion` map): its frame plan
// (core/html/motion-frames), each distinct frame drawn by the host's rasteriser with its tagged elements in
// their state, joined into one animated PNG under the build FS, named by a hash of the still and the plan
// (`html-seq:<hash>`, html-<hash>.apng). Bounded by the plan's budget, the bytes the frames take and a
// deadline; past any of them, or when a frame fails to draw, it returns null and the card is staged as its
// still in the final state, with an html_motion_static warning saying why. The deadline is the one
// wall-clock input: it only trips on a stalled host, and then the still is what renders.

import { sha256Hex } from '@/core/determinism/sha256';
import { canonicalJson } from '@/core/determinism/hash';
import { applyMotionStates, motionTargets, type ElementState } from '@/core/html/element-motion';
import type { LayerElement } from '@/core/html/html-element';
import type { HtmlRasteriser, RasterFont } from '@/core/html/html-rasteriser';
import {
  HTML_LAYER_DENSITY,
  HTML_MOTION_DEADLINE_MS,
  HTML_MOTION_MAX_BYTES,
  HTML_MOTION_MAX_SPAN,
  HTML_MOTION_VERSION,
  HTML_SEQUENCE_SCHEME,
} from '@/core/html/limits';
import { motionBudget, planMotionFrames, type ElementMotionMap, type MotionFramePlan } from '@/core/html/motion-frames';
import type AbstractFilesystem from '../../platform/filesystem/AbstractFilesystem';
import type AbstractLogger from '../../platform/logging/AbstractLogger';
import { assembleApng, type ApngFrame } from './apng-assemble';
import type { StagedHtmlLayer } from './stage-html-layer';

export interface SequenceLayer {
  name: string;
  /** The prepared layer, images inlined, its motion names in place. */
  element: LayerElement;
  motion: ElementMotionMap;
  width: number;
  height: number;
  /** The key of the card's still: the sequence's own key extends it with the plan. */
  stillKey: string;
  fonts: () => Promise<RasterFont[]>;
}

export interface SequenceContext {
  rasteriser: HtmlRasteriser;
  filesystem: Pick<AbstractFilesystem, 'stat' | 'writeFile'>;
  logger: AbstractLogger;
  dir: string;
  section: string;
  fps: number;
  now: () => number;
}

const MB = 1024 * 1024;

function stillInstead(ctx: SequenceContext, name: string, reason: string): null {
  ctx.logger.warn(
    `[${ctx.section}][Html] html_motion_static: input "${name}" shows as a still in its final state: ${reason}`
  );

  return null;
}

/** The name of an animated card's file: its still's key, extended by every frame it draws. */
export function sequenceKey(stillKey: string, plan: MotionFramePlan): string {
  return sha256Hex(canonicalJson({ still: stillKey, plan, version: HTML_MOTION_VERSION })).slice(0, 16);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// The frame's PNG, or why it could not be drawn.
async function drawFrame(
  layer: SequenceLayer,
  states: ElementState[],
  fonts: RasterFont[],
  ctx: SequenceContext
): Promise<Uint8Array | string> {
  try {
    const element = applyMotionStates(layer.element, states);
    const raster = await ctx.rasteriser.render({
      element,
      width: layer.width,
      height: layer.height,
      density: HTML_LAYER_DENSITY,
      fonts,
    });

    return raster.png;
  } catch (error) {
    return messageOf(error);
  }
}

interface Walk {
  layer: SequenceLayer;
  plan: MotionFramePlan;
  fonts: RasterFont[];
  ctx: SequenceContext;
  started: number;
}

// The frames from `index` on, drawn one after the other (the deadline and the byte budget stop the walk).
async function drawFrom(walk: Walk, index: number, done: ApngFrame[], bytes: number): Promise<ApngFrame[] | string> {
  const frame = walk.plan.frames[index] as MotionFramePlan['frames'][number] | undefined;

  if (!frame) return done;

  if (walk.ctx.now() - walk.started > HTML_MOTION_DEADLINE_MS) {
    return `drawing took over ${HTML_MOTION_DEADLINE_MS / 1000} s`;
  }

  const png = await drawFrame(walk.layer, frame.states, walk.fonts, walk.ctx);

  if (typeof png === 'string') return `frame ${index} failed to draw (${png})`;

  if (bytes + png.length > HTML_MOTION_MAX_BYTES) return `its frames are over ${HTML_MOTION_MAX_BYTES / MB} MB`;

  return drawFrom(walk, index + 1, [...done, { png, ticks: frame.ticks }], bytes + png.length);
}

async function drawFrames(
  layer: SequenceLayer,
  plan: MotionFramePlan,
  ctx: SequenceContext
): Promise<ApngFrame[] | string> {
  const fonts = await layer.fonts();

  return drawFrom({ layer, plan, fonts, ctx, started: ctx.now() }, 0, [], 0);
}

function joined(frames: ApngFrame[], fps: number): Uint8Array | string {
  try {
    return assembleApng(frames, fps);
  } catch (error) {
    return `its frames could not be joined (${messageOf(error)})`;
  }
}

/** Renders (or reuses) the animated card; null when the card is to be staged as its still. */
export async function stageHtmlSequence(layer: SequenceLayer, ctx: SequenceContext): Promise<StagedHtmlLayer | null> {
  if (Number.isFinite(ctx.fps) && !Number.isInteger(ctx.fps)) {
    return stillInstead(ctx, layer.name, `the frame rate (${ctx.fps}) is not a whole number`);
  }

  const result = planMotionFrames(motionTargets(layer.element), layer.motion, ctx.fps);

  if (result.kind === 'none') return null;

  if (result.kind === 'too-long') {
    return stillInstead(ctx, layer.name, `an animated span of ${result.span} s (limit ${HTML_MOTION_MAX_SPAN} s)`);
  }

  const { plan } = result;

  // One state for the whole span (single-key tracks): the still in that state is the card.
  if (plan.frames.length === 1) return null;

  const problem = motionBudget(plan, layer.width, layer.height).problem;

  if (problem) return stillInstead(ctx, layer.name, problem);

  const key = sequenceKey(layer.stillKey, plan);
  const staged = { url: `${HTML_SEQUENCE_SCHEME}${key}`, path: `${ctx.dir}/html-${key}.apng` };

  if (await ctx.filesystem.stat(staged.path)) return staged;

  const frames = await drawFrames(layer, plan, ctx);

  if (typeof frames === 'string') return stillInstead(ctx, layer.name, frames);

  const apng = joined(frames, plan.fps);

  if (typeof apng === 'string') return stillInstead(ctx, layer.name, apng);

  await ctx.filesystem.writeFile(staged.path, apng);
  ctx.logger.info(`[${ctx.section}][Html] staged ${layer.name} as html-${key}.apng (${frames.length} frames)`);

  return staged;
}
