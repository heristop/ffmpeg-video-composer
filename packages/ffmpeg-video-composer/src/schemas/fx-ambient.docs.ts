// The prose of the bloom, vignette-breathe and grain rows (fx-ambient.schemas.ts): a row of FX_DOCS each
// (fx-docs.ts).
import type { FxDoc } from './fx-primitives.schemas';
import type { BLOOM, VIGNETTE_BREATHE, GRAIN } from './fx-ambient.schemas';

export const bloomDoc = {
  params: {
    threshold:
      'Luma (0..1 of the video range) above which highlights halate (default 0.68–0.78 from the seed). Lower = more of the picture glows; 0.9 = only speculars and skies.',
    knee: 'Softness of the threshold, in luma (default 0.12): small = only clipped highlights, large = gradual.',
    radius:
      "Halation spread (gaussian σ) as a fraction of the target's short side (default ~0.011, i.e. 12 px at 1080p, from the seed). 0.03+ = a dreamy haze.",
    ramp: 'Seconds of fade-in and fade-out at both ends of the life (default 0.5).',
  },
  intent: {
    summary:
      'Highlight halation: the brightest parts of the picture bleed a soft, warm glow into their surroundings, as film does. Built from the frame itself, so it follows the footage.',
    useWhen: 'bright skies, windows, product speculars; a filmic, warm finish on photos or footage',
    avoidWhen: 'on flat UI cards or text-only sections (nothing to bloom); stacked with leak and vignette at once',
    vary: 'threshold and knee choose what glows; radius sets how far; color (warm white, gold, the accent) tints the halo; intensity ≤ 1 keeps it ≤ 0.12.',
    reduced: 'absent',
  },
} satisfies FxDoc<(typeof BLOOM)['params']>;

export const vignetteBreatheDoc = {
  params: {
    angle: 'Lens angle in radians: how far in the falloff reaches (default 0.55–0.7 from the seed; PI/5 ≈ 0.63).',
    swing: 'Breathing amplitude of the angle in radians (default 0.04; 0 = a still vignette).',
    period: 'Seconds per breath (default 5.4–6.6 from the seed). Keep ≥ 4 s: it should never be noticed.',
    focus: "Centre of attention as fractions of the target (e.g. the speaker's face); the falloff rings it.",
  },
  intent: {
    summary:
      'A slow, barely-there vignette that breathes: the edges of the target darken a little and the falloff drifts in and out, steering the eye to a focus point.',
    useWhen: 'interviews, portraits, photo backdrops: a quiet focus on the subject',
    avoidWhen: 'bright, graphic cards where dark corners read as dirt; together with another darkening grade',
    vary: 'angle sets the reach; focus moves the centre onto the subject; swing and period set the breath; color (default near-black) can warm it; intensity ≤ 1 keeps corners ≤ 12 % darker.',
    reduced: 'absent',
  },
} satisfies FxDoc<(typeof VIGNETTE_BREATHE)['params']>;

export const grainDoc = {
  params: {
    size: 'Grain size in px at 1080p, scaled with the frame (default 1: fine; 2–3 = 16 mm-like).',
    animated: 'A new grain pattern every frame, like film (default true); false = a still texture.',
    ramp: 'Seconds of fade-in and fade-out at both ends of the life (default 0.3).',
  },
  intent: {
    summary:
      'Fine, seeded, luma-only film grain under a low ceiling (noise strength 12 at intensity 1): binds mixed footage and flat cards into one texture.',
    useWhen: 'mixed sources (phone footage, screenshots, renders) cut together; a filmic finish',
    avoidWhen: 'crisp UI demos and text-heavy cards; on top of grade.grain',
    vary: 'size sets fine vs. coarse; intensity ≤ 1 sets the amount (below ~0.7 a standard encode smooths it away on flat areas); animated false gives a paper-like still texture; seed re-rolls the pattern.',
    reduced: 'absent',
  },
} satisfies FxDoc<(typeof GRAIN)['params']>;
