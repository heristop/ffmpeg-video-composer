import type { AnimationOverlay, Orientation } from './templateEditorModel';

const BUNDLED_DEFAULTS: Record<string, Partial<AnimationOverlay>> = {
  'tap_pulse.apng': { loop: false, loops: 1, persistent: false, opacity: 0.8, fit: 'contain' },
  'shine_sweep.apng': { loop: false, loops: 1, persistent: false, opacity: 0.5, fit: 'contain' },
  'confetti.apng': { loop: false, loops: 1, persistent: false, opacity: 0.85, fit: 'contain' },
  'sparkle.apng': { loop: false, loops: 1, persistent: false, opacity: 0.7, fit: 'contain' },
  'corner_brackets.apng': { opacity: 0.5, fit: 'contain' },
  'glow_border.apng': { opacity: 0.28, fit: 'contain' },
};

/** Apply curated playback only to canonical bundled URLs; custom assets keep their authored options. */
export function animationDefaultsForUrl(url: string): Partial<AnimationOverlay> {
  const prefix = '/assets/animations/';

  if (!url.startsWith(prefix)) return {};

  return { ...BUNDLED_DEFAULTS[url.slice(prefix.length)] };
}

export interface AnimationEffectPreset {
  id: string;
  nameKey: string;
  descriptionKey: string;
  build: (orientation: Orientation) => AnimationOverlay[];
}

const FRAME_SIZE: Record<Orientation, [number, number]> = {
  landscape: [1280, 720],
  portrait: [720, 1280],
  square: [1080, 1080],
};

const NATIVE_ASPECTS: Record<string, number> = {
  corner_brackets: 1280 / 720,
  shine_sweep: 1280 / 720,
  confetti: 1280 / 720,
  sparkle: 1280 / 720,
  tap_pulse: 1,
  spec_orbit: 720 / 1280,
  pulse_ring: 1280 / 720,
  light_leak: 1280 / 720,
  white_border: 1280 / 720,
};

// Fit the asset's actual canvas inside the recipe region without distorting circular or drawn shapes.
function centeredLayer(
  orientation: Orientation,
  filename: string,
  region: { width: number; height: number; centerY: number; artworkCenterY?: number },
  playback: { start: number; duration: number; opacity: number }
): AnimationOverlay {
  const [frameW, frameH] = FRAME_SIZE[orientation];
  const ratio = NATIVE_ASPECTS[filename];
  const w = Math.round(Math.min(frameW * region.width, frameH * region.height * ratio));
  const h = Math.round(w / ratio);

  return {
    url: `/assets/animations/${filename}.apng`,
    position: `${Math.round((frameW - w) / 2)}:${Math.round(frameH * region.centerY - h * (region.artworkCenterY ?? 0.5))}`,
    scale: `${w}:${h}`,
    fit: 'contain',
    persistent: false,
    ...playback,
  };
}

/** Portable recipes: existing APNG assets and JSON controls, with at most two finite overlay layers. */
export const ANIMATION_EFFECT_PRESETS: AnimationEffectPreset[] = [
  {
    id: 'interface-focus',
    nameKey: 'animation.effects.interface-focus.name',
    descriptionKey: 'animation.effects.interface-focus.description',
    build: (orientation) => [
      centeredLayer(
        orientation,
        'corner_brackets',
        { width: 0.86, height: 0.68, centerY: 0.52 },
        { start: 0.2, duration: 1.8, opacity: 0.5 }
      ),
      centeredLayer(
        orientation,
        'tap_pulse',
        { width: 0.36, height: 0.34, centerY: 0.52, artworkCenterY: 0.6 },
        { start: 0.4, duration: 2, opacity: 0.75 }
      ),
    ],
  },
  {
    id: 'product-spotlight',
    nameKey: 'animation.effects.product-spotlight.name',
    descriptionKey: 'animation.effects.product-spotlight.description',
    build: (orientation) => [
      centeredLayer(
        orientation,
        'shine_sweep',
        { width: 0.94, height: 0.76, centerY: 0.52 },
        { start: 0.25, duration: 2.52, opacity: 0.5 }
      ),
      centeredLayer(
        orientation,
        'spec_orbit',
        { width: 0.5, height: 0.7, centerY: 0.52 },
        { start: 0.1, duration: 2, opacity: 0.55 }
      ),
    ],
  },
  {
    id: 'celebration-burst',
    nameKey: 'animation.effects.celebration-burst.name',
    descriptionKey: 'animation.effects.celebration-burst.description',
    build: (orientation) => [
      centeredLayer(
        orientation,
        'confetti',
        { width: 1, height: 0.85, centerY: 0.5 },
        { start: 0.18, duration: 2.52, opacity: 0.85 }
      ),
      centeredLayer(
        orientation,
        'sparkle',
        { width: 0.68, height: 0.6, centerY: 0.5 },
        { start: 0.65, duration: 2, opacity: 0.7 }
      ),
    ],
  },
  {
    id: 'focus-lock',
    nameKey: 'animation.effects.focus-lock.name',
    descriptionKey: 'animation.effects.focus-lock.description',
    build: (orientation) => [
      centeredLayer(
        orientation,
        'corner_brackets',
        { width: 0.76, height: 0.64, centerY: 0.52 },
        { start: 0.08, duration: 1.8, opacity: 0.45 }
      ),
      centeredLayer(
        orientation,
        'pulse_ring',
        { width: 0.48, height: 0.4, centerY: 0.52 },
        { start: 0.2, duration: 2, opacity: 0.4 }
      ),
    ],
  },
  {
    id: 'light-pass',
    nameKey: 'animation.effects.light-pass.name',
    descriptionKey: 'animation.effects.light-pass.description',
    build: (orientation) => [
      centeredLayer(
        orientation,
        'light_leak',
        { width: 1, height: 0.88, centerY: 0.5 },
        { start: 0.04, duration: 2, opacity: 0.2 }
      ),
      centeredLayer(
        orientation,
        'sparkle',
        { width: 0.46, height: 0.44, centerY: 0.5 },
        { start: 0.35, duration: 2, opacity: 0.35 }
      ),
    ],
  },
  {
    id: 'frame-reveal',
    nameKey: 'animation.effects.frame-reveal.name',
    descriptionKey: 'animation.effects.frame-reveal.description',
    build: (orientation) => [
      centeredLayer(
        orientation,
        'white_border',
        { width: 0.88, height: 0.72, centerY: 0.52 },
        { start: 0.06, duration: 1.8, opacity: 0.35 }
      ),
      centeredLayer(
        orientation,
        'shine_sweep',
        { width: 0.88, height: 0.72, centerY: 0.52 },
        { start: 0.18, duration: 2.52, opacity: 0.3 }
      ),
    ],
  },
];
