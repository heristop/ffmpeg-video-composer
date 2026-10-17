// Descriptor rules for animated HTML cards (an html input's `motion` map, drawn by
// editor/html/stage-html-sequence.ts), checked on the same frame plan the render draws, with motion tokens
// and time references resolved:
// - html_motion_too_many_targets: more elements carry data-motion than one card moves;
// - html_motion_too_long: the plan is over its span, frame or pixel budget (a render would show the still).
// Track values and key order are checked with the layer tracks (motion-validation.ts); a layer whose keys
// are out of order is left to that rule.

import DefaultConfig from '@/core/default.config';
import { motionTargets } from '@/core/html/element-motion';
import { prepareHtmlLayer } from '@/core/html/html-layer';
import { HTML_MOTION_MAX_SPAN, HTML_MOTION_MAX_TARGETS } from '@/core/html/limits';
import { motionBudget, planMotionFrames, type ElementMotionMap } from '@/core/html/motion-frames';
import { resolveMotionDescriptor } from '@/core/motion/tokens';
import { keyTimesError } from '@/core/motion/tracks';
import { resolveTimeRefs } from '@/core/timing/resolve';
import { htmlInputs, type HtmlInputUse } from './html-validation';
import type { ValidationError } from './validation/types';

const BUDGET_HINT = 'Shorten the tracks or the stagger, move fewer elements, lower global.fps or make the box smaller.';

function isMotionMap(value: unknown): value is ElementMotionMap {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function tracksInOrder(motion: ElementMotionMap): boolean {
  return Object.values(motion).every((spec) =>
    Object.entries(spec).every(
      ([key, keys]) => key === 'stagger' || !Array.isArray(keys) || keyTimesError(keys) === null
    )
  );
}

function overBudget(path: string, problem: string): ValidationError {
  return {
    path: `${path}.motion`,
    code: 'html_motion_too_long',
    message: `html layer motion is over budget: ${problem}`,
    hint: BUDGET_HINT,
    kind: 'judgement',
  };
}

function tooManyTargets(path: string, count: number): ValidationError {
  return {
    path: `${path}.html`,
    code: 'html_motion_too_many_targets',
    message: `html layer motion: ${count} elements carry data-motion (limit ${HTML_MOTION_MAX_TARGETS})`,
    hint: 'Tag a wrapper per row or group and move it, rather than every element one by one.',
    kind: 'judgement',
  };
}

function side(value: unknown): number {
  return typeof value === 'number' && value > 0 ? value : 1;
}

function layerErrors({ input, path }: HtmlInputUse, fps: number): ValidationError[] {
  const motion = input.motion;

  if (!isMotionMap(motion) || !tracksInOrder(motion)) return [];

  const html = typeof input.html === 'string' ? input.html : '';
  const css = typeof input.css === 'string' ? input.css : '';
  const names = motionTargets(prepareHtmlLayer({ html, css, width: 1, height: 1 }, 'Rubik').element);

  if (names.length > HTML_MOTION_MAX_TARGETS) return [tooManyTargets(path, names.length)];

  const result = planMotionFrames(names, motion, fps);

  if (result.kind === 'too-long') {
    return [overBudget(path, `an animated span of ${result.span} s (limit ${HTML_MOTION_MAX_SPAN} s)`)];
  }

  if (result.kind === 'none') return [];

  const problem = motionBudget(result.plan, side(input.width), side(input.height)).problem;

  return problem ? [overBudget(path, problem)] : [];
}

export function validateHtmlMotion(template: unknown): ValidationError[] {
  if (!htmlInputs(template).some(({ input }) => isMotionMap(input.motion))) return [];

  const descriptor = template as { global?: unknown; sections?: unknown };
  const prepared = resolveTimeRefs(resolveMotionDescriptor(descriptor), { deferBeatsAnalysis: true }).descriptor;
  const fps = (prepared.global as { fps?: unknown } | undefined)?.fps;

  return htmlInputs(prepared).flatMap((use) => layerErrors(use, typeof fps === 'number' ? fps : DefaultConfig.FPS));
}
