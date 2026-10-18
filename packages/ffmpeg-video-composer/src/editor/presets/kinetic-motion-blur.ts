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
import { asFilter, blurGate, blurHead, blurPad, blurRebase, blurTail, planBlur, type BlurPlan } from './motion-blur';
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

// One span's branch: the block drawn on the shutter clock, averaged. A span that starts late is preceded by
// the frames before it (blurPad) so the closing overlay gets a frame from t=0 and ffmpeg never queues the
// base frames meanwhile.
function spanChains(p: string, filters: Filter[], plan: BlurPlan, k: number): FilterGraphChain[] {
  const span = plan.spans[k];
  const pad = blurPad(span, plan.shutter);
  const tail = blurTail(plan.shutter).map(asFilter);
  const draw = [...blurHead(span, plan.shutter).map(asFilter), ...filters];

  if (pad.length === 0) {
    return [{ inputs: [`${p}b${k}`], filters: [...draw, ...tail], outputs: [`${p}t${k}`] }];
  }

  return [
    { inputs: [`${p}b${k}`], filters: [{ type: 'split', value: '2' }], outputs: [`${p}p${k}`, `${p}q${k}`] },
    { inputs: [`${p}p${k}`], filters: pad.map(asFilter), outputs: [`${p}d${k}`] },
    { inputs: [`${p}q${k}`], filters: [...draw, ...tail, asFilter(blurRebase)], outputs: [`${p}r${k}`] },
    {
      inputs: [`${p}d${k}`, `${p}r${k}`],
      filters: [{ type: 'concat', value: 'n=2:v=1:a=0' }],
      outputs: [`${p}t${k}`],
    },
  ];
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
    ...plan.spans.flatMap((_, k) => spanChains(p, filters, plan, k)),
    ...plan.spans.map((span, k) => ({
      inputs: [k === 0 ? `${p}o` : `${p}m${k - 1}`, `${p}t${k}`],
      filters: [{ type: 'overlay', value: `0:0:eof_action=pass:${blurGate(span, plan.shutter)}` }],
      ...(k === n - 1 ? {} : { outputs: [`${p}m${k}`] }),
    })),
  ];

  return [{ type: 'graph', graph: chains }];
}
