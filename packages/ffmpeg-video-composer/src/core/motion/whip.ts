// Whip transitions: the motion blur of a push at speed, modelled on a camera shutter. The push's curve is
// differentiated at compile time around each output frame's own instant: the distance the picture travels
// during the shutter (a share of one frame interval) is the length of the streak. A gaussian stretched
// along the travel axis with the same second moment as that streak (σ = length / √12) is enabled for the
// frame, so the blur follows the real speed: it fades in and out with the ease instead of switching on at
// a threshold, a longer whip blurs less, and a higher frame rate blurs less per frame. Frames sharing a
// radius share one filter. gblur geometry is fixed per instance, so the radius steps per enable window
// (gated mid-frame): frame-exact and deterministic, like the animated graphics.

import { parseEasing, type EasingSpec } from './easing';
import { fmt } from './hermite';

/** Default whip curve: a sharper in-out than the push default, so the peak speed is short and high. */
export const WHIP_EASE = 'cubic-bezier(0.7, 0, 0.2, 1)';
/** Shutter as a share of the frame interval (144°): a crisp action look; a 0.4 s whip at 30 fps peaks ≈ 39 px. */
const SHUTTER = 0.4;
/** Box-to-gaussian: a streak of length L has the second moment of a gaussian of σ = L/√12. */
const BOX_TO_SIGMA = 1 / Math.sqrt(12);
/** Ceiling on the radius, as a fraction of the travel axis (≈ 58 px on a 1280 px frame), for very short whips. */
const MAX_BLUR = 0.045;
/** Blur across the travel axis: a hair, so the smear reads as directional. */
const CROSS_SIGMA = 0.5;

export interface WhipSpec {
  ease: EasingSpec;
  duration: number;
  fps: number;
  width: number;
  height: number;
  type: string;
}

interface Run {
  from: number;
  to: number;
  sigma: number;
}

// Pixels the picture travels while the shutter is open on each output frame (frame f shows the push at f/fps).
function shutterTravel(ease: EasingSpec, frames: number, axis: number): number[] {
  const fn = parseEasing(ease).fn;
  const half = SHUTTER / 2 / frames;

  return Array.from({ length: frames + 1 }, (_, f) => {
    const at = f / frames;

    return Math.abs(fn(Math.min(1, at + half)) - fn(Math.max(0, at - half))) * axis;
  });
}

// Windows switch half a frame before each frame's instant, never on it.
function edge(frame: number, fps: number): number {
  return frame === 0 ? 0 : (frame - 0.5) / fps;
}

function blurRuns(spec: WhipSpec, axis: number): Run[] {
  const frames = Math.max(1, Math.round(spec.duration * spec.fps));
  const runs: Run[] = [];
  const cap = axis * MAX_BLUR;

  for (const [f, travel] of shutterTravel(spec.ease, frames, axis).entries()) {
    const sigma = Math.round(Math.min(cap, travel * BOX_TO_SIGMA));
    const last = runs.at(-1);

    if (last?.sigma === sigma) {
      last.to = edge(f + 1, spec.fps);
      continue;
    }

    runs.push({ from: edge(f, spec.fps), to: edge(f + 1, spec.fps), sigma });
  }

  return runs.filter((run) => run.sigma >= 1);
}

/** The blur chain applied over a whip's composed frames (timestamps start at 0), or a passthrough. */
export function whipBlur(spec: WhipSpec): string {
  const vertical = spec.type === 'whip-up' || spec.type === 'whip-down';
  const runs = blurRuns(spec, vertical ? spec.height : spec.width);

  if (runs.length === 0) return 'null';

  return runs
    .map((run) => {
      const [h, v] = vertical ? [CROSS_SIGMA, run.sigma] : [run.sigma, CROSS_SIGMA];

      return `gblur=sigma=${fmt(h)}:sigmaV=${fmt(v)}:enable='gte(t,${fmt(run.from)})*lt(t,${fmt(run.to)})'`;
    })
    .join(',');
}
