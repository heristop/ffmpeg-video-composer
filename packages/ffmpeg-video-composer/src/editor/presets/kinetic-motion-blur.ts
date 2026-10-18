// packages/ffmpeg-video-composer/src/editor/presets/kinetic-motion-blur.ts
// Motion blur on a kinetic block (kinetic[].motionBlur): the block's drawtexts are drawn twice in one spliced
// sub-graph — sharp on every frame, and on the shutter clock (motion-blur.ts) over each span where units
// travel (entrances, exits; a wave until the cut), averaged and laid back over the sharp frames. drawtext
// reads the sub-frame clock itself, so every unit, echo and marker blurs along its own track. Presets whose
// units never travel, fills (their mask graph stays sharp) and reduced motion are left as they are.

import type { Filter, FilterGraphChain } from '@/core/types';
import type { KineticBlock } from '../../schemas/kinetic.schemas';
import { MOTION_BLUR_STILL_PRESETS, resolveMotionBlur } from '../../schemas/layer-composite.schemas';
import { assertSafePadLabel } from '../utils/filter-option-guard';
import { asFilter, blurHead, blurTail, planBlur } from './motion-blur';
import { unitSpans, type UnitTiming } from './motion-spans';

export interface KineticBlurEnv {
  has: (filter: string) => boolean;
  warn: (message: string) => void;
  /** Pad prefix of this block, e.g. "kmb0_". */
  prefix: string;
}

interface BlurFrame {
  fps: number;
  duration: number;
  energy: number;
  /** The units keep moving after they land (wave). */
  wave: boolean;
}

export function withMotionBlur(
  block: KineticBlock,
  filters: Filter[],
  timings: readonly UnitTiming[],
  frame: BlurFrame,
  env: KineticBlurEnv | undefined
): Filter[] {
  const blur = resolveMotionBlur(block.motionBlur);

  if (!blur || !env || frame.energy === 0 || block.fill || block.clip || MOTION_BLUR_STILL_PRESETS.has(block.preset)) {
    return filters;
  }

  // A graph filter (clip, fill) declares pads: drawing it twice would re-declare them.
  if (filters.some((filter) => filter.graph)) return filters;

  const spans = unitSpans(timings, frame.fps, frame.wave ? frame.duration : null);
  const plan = planBlur(spans, blur, frame.fps, env);

  if (!plan) return filters;

  const p = assertSafePadLabel(env.prefix);
  const n = plan.spans.length;
  const chains: FilterGraphChain[] = [
    {
      filters: [{ type: 'split', value: String(n + 1) }],
      outputs: [`${p}s`, ...plan.spans.map((_, k) => `${p}b${k}`)],
    },
    { inputs: [`${p}s`], filters, outputs: [`${p}o`] },
    ...plan.spans.map((span, k) => ({
      inputs: [`${p}b${k}`],
      filters: [...blurHead(span, plan.shutter).map(asFilter), ...filters, ...blurTail(plan.shutter).map(asFilter)],
      outputs: [`${p}t${k}`],
    })),
    ...plan.spans.map((_, k) => ({
      inputs: [k === 0 ? `${p}o` : `${p}m${k - 1}`, `${p}t${k}`],
      filters: [{ type: 'overlay', value: '0:0:eof_action=pass' }],
      ...(k === n - 1 ? {} : { outputs: [`${p}m${k}`] }),
    })),
  ];

  return [{ type: 'graph', graph: chains }];
}
