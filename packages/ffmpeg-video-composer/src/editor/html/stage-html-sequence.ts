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
  HTML_MOTION_MAX_NAMES,
  HTML_MOTION_MAX_TARGETS,
  HTML_MOTION_VERSION,
  HTML_SEQUENCE_SCHEME,
} from '@/core/html/limits';
import {
  motionBudget,
  overSpanReason,
  planMotionFrames,
  type ElementMotionMap,
  type MotionFramePlan,
  type MotionPlanResult,
} from '@/core/html/motion-frames';
import type AbstractFilesystem from '../../platform/filesystem/AbstractFilesystem';
import type AbstractLogger from '../../platform/logging/AbstractLogger';
import { overflowFinding } from '../../services/html-raster/html-layer-findings';
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

// An animated PNG stores a frame's delay in 16 bits.
const MAX_LEAD_TICKS = 0xffff;

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
): Promise<{ png: Uint8Array; contentHeight: number } | string> {
  try {
    const element = applyMotionStates(layer.element, states);
    const raster = await ctx.rasteriser.render({
      element,
      width: layer.width,
      height: layer.height,
      density: HTML_LAYER_DENSITY,
      fonts,
    });

    return raster;
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

interface Drawn {
  frames: ApngFrame[];
  /** The tallest content any frame drew, in layer pixels. */
  tallest: number;
}

// The frames from `index` on, drawn one after the other (the deadline and the byte budget stop the walk).
async function drawFrom(walk: Walk, index: number, done: Drawn, bytes: number): Promise<Drawn | string> {
  const frame = walk.plan.frames[index] as MotionFramePlan['frames'][number] | undefined;

  if (!frame) return done;

  if (walk.ctx.now() - walk.started > HTML_MOTION_DEADLINE_MS) {
    return `drawing took over ${HTML_MOTION_DEADLINE_MS / 1000} s`;
  }

  const drawn = await drawFrame(walk.layer, frame.states, walk.fonts, walk.ctx);

  if (typeof drawn === 'string') return `frame ${index} failed to draw (${drawn})`;

  const { png } = drawn;

  if (bytes + png.length > HTML_MOTION_MAX_BYTES) return `its frames are over ${HTML_MOTION_MAX_BYTES / MB} MB`;

  const next = {
    frames: [...done.frames, { png, ticks: frame.ticks }],
    tallest: Math.max(done.tallest, drawn.contentHeight),
  };

  return drawFrom(walk, index + 1, next, bytes + png.length);
}

async function drawFrames(layer: SequenceLayer, plan: MotionFramePlan, ctx: SequenceContext): Promise<Drawn | string> {
  const fonts = await layer.fonts();

  return drawFrom({ layer, plan, fonts, ctx, started: ctx.now() }, 0, { frames: [], tallest: 0 }, 0);
}

function joined(frames: ApngFrame[], fps: number): Uint8Array | string {
  try {
    return assembleApng(frames, fps);
  } catch (error) {
    return `its frames could not be joined (${messageOf(error)})`;
  }
}

// The plan, or why it could not be made: a key the validator never saw (an unknown easing, a malformed time).
function plannedFrames(targets: string[], layer: SequenceLayer, ctx: SequenceContext): MotionPlanResult | string {
  try {
    return planMotionFrames(targets, layer.motion, ctx.fps);
  } catch (error) {
    return `its motion could not be planned (${messageOf(error)})`;
  }
}

// Why a card's frame rate, element count or name count rules out an animation, or null.
function inputProblem(layer: SequenceLayer, targets: string[], fps: number): string | null {
  const names = Object.keys(layer.motion).length;

  if (!(fps > 0)) return `the frame rate (${fps}) is not positive`;

  if (!Number.isInteger(fps)) return `the frame rate (${fps}) is not a whole number`;

  if (targets.length > HTML_MOTION_MAX_TARGETS) {
    return `${targets.length} animated elements (limit ${HTML_MOTION_MAX_TARGETS})`;
  }

  return names > HTML_MOTION_MAX_NAMES ? `${names} motion names (limit ${HTML_MOTION_MAX_NAMES})` : null;
}

// The frame plan of an animated card, or null (with a warning when it is not simply a still) to stage the still.
function planOf(layer: SequenceLayer, ctx: SequenceContext): MotionFramePlan | null {
  const targets = motionTargets(layer.element);
  const refused = inputProblem(layer, targets, ctx.fps);

  if (refused) return stillInstead(ctx, layer.name, refused);

  const result = plannedFrames(targets, layer, ctx);

  if (typeof result === 'string') return stillInstead(ctx, layer.name, result);

  if (result.kind === 'none') return null;

  if (result.kind === 'too-long' || result.kind === 'too-many-ticks') {
    return stillInstead(ctx, layer.name, overSpanReason(result));
  }

  const { plan } = result;

  // One state for the whole span (single-key tracks): the still in that state is the card.
  if (plan.frames.length === 1) return null;

  const problem = motionBudget(plan, layer.width, layer.height).problem;

  if (problem) return stillInstead(ctx, layer.name, problem);

  if (plan.frames[0].ticks > MAX_LEAD_TICKS) {
    return stillInstead(
      ctx,
      layer.name,
      `its first frame lasts ${plan.frames[0].ticks} frames (limit ${MAX_LEAD_TICKS})`
    );
  }

  return plan;
}

/** Renders (or reuses) the animated card; null when the card is to be staged as its still. */
export async function stageHtmlSequence(layer: SequenceLayer, ctx: SequenceContext): Promise<StagedHtmlLayer | null> {
  const plan = planOf(layer, ctx);

  if (!plan) return null;

  const key = sequenceKey(layer.stillKey, plan);
  const staged = { url: `${HTML_SEQUENCE_SCHEME}${key}`, path: `${ctx.dir}/html-${key}.apng` };

  if (await ctx.filesystem.stat(staged.path)) return staged;

  const drawn = await drawFrames(layer, plan, ctx);

  if (typeof drawn === 'string') return stillInstead(ctx, layer.name, drawn);

  const { frames } = drawn;
  const apng = joined(frames, plan.fps);

  if (typeof apng === 'string') return stillInstead(ctx, layer.name, apng);

  for (const finding of overflowFinding(drawn.tallest, layer.height)) {
    ctx.logger.warn(`[${ctx.section}][Html] ${finding.code}: ${finding.message}`);
  }

  await ctx.filesystem.writeFile(staged.path, apng);
  ctx.logger.info(`[${ctx.section}][Html] staged ${layer.name} as html-${key}.apng (${frames.length} frames)`);

  return staged;
}
