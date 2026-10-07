// The creative kit's library animations (APNG overlays under `animations/`) are SAMPLES: demo assets that
// show what an overlay input can do. They look the same in every template that uses them, so an author
// composes motion with the engine instead (kinetic type, animate tracks, camera, designed transitions,
// graphics and `type: "fx"` primitives tuned to the brief) and treats a sample as a last resort. This
// table tells the catalog, the catalog search and the sameness lint what each sample is and which engine
// primitives produce that idea as the template's own move. Pure data.

export interface LibrarySample {
  /** File stem under animations/ (e.g. "shine_sweep" for animations/shine_sweep.apng). */
  name: string;
  /** What the stock overlay shows. */
  looksLike: string;
  /** The motion-engine primitives that compose the same idea, tuned to the template. */
  composeWith: string;
}

export const LIBRARY_SAMPLE_NOTE =
  'Sample assets, not building blocks: every template that drops one in looks the same. Compose the idea with ' +
  'the motion engine (composeWith) tuned to the creative direction; use a sample only as a last resort.';

export const LIBRARY_ANIMATION_SAMPLES: LibrarySample[] = [
  {
    name: 'shine_sweep',
    looksLike: 'a full-frame light band sweeping across',
    composeWith:
      'graphics { type: "fx", effect: "sheen", target: the card / title it lights } with its profile, width, tilt, ' +
      'direction, colour ("$color.accent") and ease tuned',
  },
  {
    name: 'sparkle',
    looksLike: 'twinkling star glints',
    composeWith:
      'graphics { type: "fx", effect: "glint" } on the product or logo (path, count, size, stagger tuned), or a ' +
      'twin-profile fx sheen with repeat + every on the hero',
  },
  {
    name: 'spec_orbit',
    looksLike: 'a specular glint orbiting a product',
    composeWith: 'an fx glint with path "orbit" around the product, or a crisp fx sheen (width 0.05–0.1) as it lands',
  },
  {
    name: 'light_leak',
    looksLike: 'a warm film light leak over the frame',
    composeWith:
      'graphics { type: "fx", effect: "leak" } at a beat change (edge, size, drift and palette colours tuned), or ' +
      'a warm `look` / grade.colorBalance plus a slow camera drift',
  },
  {
    name: 'confetti',
    looksLike: 'falling confetti',
    composeWith:
      'graphics { type: "fx", effect: "confetti" } once, on the payoff (origin, angle, physics, theme colours), ' +
      'or kinetic pop / drop with an accent word and a camera hit',
  },
  {
    name: 'corner_brackets',
    looksLike: 'viewfinder brackets',
    composeWith: 'graphics { type: "corners" } with inset, length, thickness and a theme colour',
  },
  {
    name: 'glow_border',
    looksLike: 'a glowing frame border',
    composeWith:
      'graphics { type: "fx", effect: "edge-glow" } hugging the card it lights (glow "$color.accent", spread, ' +
      'breathe), or a frame tracing on around it',
  },
  {
    name: 'white_border',
    looksLike: 'a white frame border',
    composeWith: 'graphics { type: "frame" } with inset and thickness in a theme colour',
  },
  {
    name: 'rounded_border',
    looksLike: 'a rounded frame border',
    composeWith: 'a color_background layer card with a radius, or graphics { type: "frame" }',
  },
  {
    name: 'pulse_ring',
    looksLike: 'an expanding pulse ring',
    composeWith:
      'graphics { type: "fx", effect: "ripple" } from the exact point (rings, radius, stroke tuned), or camera ' +
      'hits on the beat',
  },
  {
    name: 'tap_pulse',
    looksLike: 'a tap indicator pulse',
    composeWith:
      'graphics { type: "fx", effect: "ripple", variant: "tap" } on the control being tapped, plus a click sfx',
  },
  {
    name: 'animation_icons',
    looksLike: 'stock animated icons',
    composeWith: 'kinetic type and graphics drawn in the theme; a still image input for a real brand icon',
  },
];

const SAMPLE_URL = /(?:^|\/)animations\/([\w-]+)\.(?:apng|webp|gif|webm)$/i;

/** The library sample a url points at (`/assets/animations/x.apng`, `animations/x.apng`…), or null. */
export function librarySampleOf(url: unknown): { name: string; sample?: LibrarySample } | null {
  if (typeof url !== 'string') return null;

  const name = SAMPLE_URL.exec(url.trim())?.[1];

  if (name === undefined) return null;

  return { name, sample: LIBRARY_ANIMATION_SAMPLES.find((entry) => entry.name === name) };
}
