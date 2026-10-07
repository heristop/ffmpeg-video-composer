// Pure playback sampling for the NON-TEXT elements the program monitor animates: still-image /
// shape overlays (show window + `motion` entrance) and background layers (`reveal`). Both reuse
// overlayVisibilityAt so an image and a caption with the same reveal settle identically; the extra
// rules here mirror the ENGINE lowering:
//   - an image's show window lowers to the overlay filter's timeline enable → hard hide outside it,
//     and the motion clock stays scene-relative (both `t`s are the section timestamp).
//   - a SOLID layer lowers to a drawbox timeline gate (drawbox has no alpha expression) → it POPS
//     at the reveal delay; only gradient layers (overlaid lavfi legs) get the full fade/slide.
import type { AnimationOverlay, BackgroundLayer, ImageOverlay, Reveal } from '../templateEditorModel';
import { overlayVisibilityAt, REVEAL_DEFAULTS, type OverlayVisibility } from './overlay-visibility.logic';

const HIDDEN: OverlayVisibility = { phase: 'before', progress: 0, opacity: 0, translateX: 0, translateY: 0 };
const RESTING: OverlayVisibility = { phase: 'hold', progress: 1, opacity: 1, translateX: 0, translateY: 0 };

// The reveal's start delay, honouring the engine default; undefined when the reveal never fires.
function revealDelay(reveal: Reveal | undefined): number | undefined {
  if (!reveal) return undefined;

  const obj = typeof reveal === 'string' ? { type: reveal } : reveal;

  if (obj.type === 'none') return undefined;

  return typeof reveal === 'string' ? REVEAL_DEFAULTS.delay : (reveal.delay ?? REVEAL_DEFAULTS.delay);
}

/**
 * Where a still-image / shape overlay sits at `localT` seconds into a `duration`-second scene:
 * hidden outside its start/end show window (0 = unbounded on that side, matching the editor
 * model), otherwise its `motion` entrance sampled on the scene clock.
 */
export function imageVisibilityAt(
  image: Pick<ImageOverlay, 'motion' | 'start' | 'end'>,
  localT: number,
  duration: number
): OverlayVisibility {
  const start = image.start ?? 0;

  if (localT < start) return HIDDEN;

  if (image.end !== undefined && image.end > 0 && localT >= image.end) return HIDDEN;

  return overlayVisibilityAt(image.motion, undefined, localT, duration);
}

/**
 * Where an animation file sits at `localT`: the engine delays its input by `start` (-itsoffset) and cuts it
 * after `duration` seconds (-t), unless `persistent` holds its last frame; its `motion` entrance runs on the
 * scene clock like an image's.
 */
export function animationVisibilityAt(
  animation: Pick<AnimationOverlay, 'motion' | 'start' | 'duration' | 'persistent'>,
  localT: number,
  duration: number
): OverlayVisibility {
  const start = animation.start ?? 0;
  const cut = animation.duration !== undefined && animation.duration > 0 && !animation.persistent;

  return imageVisibilityAt(
    { motion: animation.motion, start, end: cut ? start + (animation.duration ?? 0) : undefined },
    localT,
    duration
  );
}

/**
 * Where a background layer sits at `localT`: gradient layers animate their full reveal (the engine
 * overlays them with the animation-overlay motion machinery); solid layers pop in at the reveal
 * delay (the engine gates their drawbox with `enable='gte(t,delay)'`).
 */
export function layerVisibilityAt(layer: BackgroundLayer, localT: number, duration: number): OverlayVisibility {
  if (!layer.reveal) return RESTING;

  if (layer.gradient) return overlayVisibilityAt(layer.reveal, undefined, localT, duration);

  const delay = revealDelay(layer.reveal);

  if (delay === undefined) return RESTING;

  return localT < delay ? HIDDEN : RESTING;
}
