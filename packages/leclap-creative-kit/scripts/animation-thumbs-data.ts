// The stage and the per-entry tuning of the animation-library thumbnails rendered by
// gen-animation-thumbs.ts: each engine entry's graphics are tuned to read at 320×180 and to loop cleanly
// within the 2 s clip; each legacy sample names the showcase render (made with the real APNG) its still
// is cut from. Ids match src/editor/animation-library.ts (tests/animation-thumbs.test.ts checks them).

// The stage: a #1A1D24 frame with a mid-grey rounded card (the "subject" masked effects live on), 70 % of
// the frame and centred (so it reads on a small picker card, with room around it for marks that leave it), carrying a few UI blocks (a title bar, two text lines, an accent button) so
// effects that act on the picture itself (resolve, bloom, glass) have edges and highlights to work with.
export const SUBJECT = { x: 192, y: 108, w: 896, h: 504, radius: 44 };

function panel(name: string, box: { x: number; y: number; w: number; h: number; r: number }, color: string) {
  return {
    name,
    type: 'image',
    url: `panel:w=${box.w},h=${box.h},r=${box.r},c=${color},o=1`,
    options: { position: `${box.x}:${box.y}` },
  };
}

export const STAGE_INPUTS = [
  panel('subject', { x: SUBJECT.x, y: SUBJECT.y, w: SUBJECT.w, h: SUBJECT.h, r: SUBJECT.radius }, '6b7280'),
  panel('title', { x: 264, y: 184, w: 448, h: 64, r: 16 }, 'd1d5db'),
  panel('line1', { x: 264, y: 290, w: 640, h: 28, r: 14 }, '9ca3af'),
  panel('line2', { x: 264, y: 342, w: 500, h: 28, r: 14 }, '9ca3af'),
  panel('button', { x: 264, y: 486, w: 240, h: 64, r: 32 }, '8e9bff'),
];

const ACCENT = '#8E9BFF';

export type Kind = 'fx' | 'graphic' | 'sample';

export interface ManifestEntry {
  id: string;
  label: string;
  thumb: string;
  poster: string;
  kind: Kind;
}

export interface EngineThumb {
  id: string;
  label: string;
  kind: Exclude<Kind, 'sample'>;
  /** The section's graphics (the effect tuned to read at 320×180, looping cleanly within 2 s). */
  graphics: Record<string, unknown>[];
  /** Seconds into the clip of the poster frame (the effect's peak). */
  peak: number;
  /** Show only this 640×360 window of the frame (2×), for textures too fine to read at 320×180. */
  zoom?: { x: number; y: number };
}

export interface SampleThumb {
  id: string;
  label: string;
  /** The showcase render that used the real APNG, and the moment it reads best. */
  showcase: string;
  at: number;
}

const T = SUBJECT;
const fx = (effect: string, fields: Record<string, unknown>) => ({ type: 'fx', effect, target: T, ...fields });
const onFrame = (effect: string, fields: Record<string, unknown>) => ({
  type: 'fx',
  effect,
  target: 'frame',
  at: 0,
  duration: 2,
  ...fields,
});
const thumb = (
  id: string,
  label: string,
  peak: number,
  graphics: Record<string, unknown>[],
  kind: EngineThumb['kind'] = 'fx'
): EngineThumb => ({ id, label, kind, peak, graphics });
const stacked = (graphic: Record<string, unknown>) => [1, 2, 3].map((seed) => ({ ...graphic, seed }));
const zoomed = (entry: EngineThumb, x = 320, y = 180): EngineThumb => ({ ...entry, zoom: { x, y } });

const STROKE_TIMING = { at: 0.1, until: 1.85, exit: 'fade' };

export const ENGINE_THUMBS: EngineThumb[] = [
  thumb('sheen', 'Sheen', 0.5, [fx('sheen', { at: 0.15, repeat: 2, every: 1, intensity: 1, width: 0.14 })]),
  thumb('glint-orbit', 'Orbit glint', 0.9, [
    fx('glint', { path: 'orbit', at: 0.1, duration: 1.8, size: 84, trail: 0.8 }),
  ]),
  thumb('edge-glow', 'Edge glow', 1, [fx('edge-glow', { at: 0, duration: 2, intensity: 1, period: 2, spread: 28 })]),
  thumb('leak', 'Light leak', 0.9, [onFrame('leak', { edge: 'top-left', size: 1.5, stretch: 1.4, intensity: 1 })]),
  // Ambient textures sit at ≤ 0.12 alpha by design, which no 320×180 preview can show: their thumbs zoom in
  // 2× and stack three seeded copies so the texture reads (a preview of its character, not of its strength).
  zoomed(
    thumb('bloom', 'Bloom', 1, stacked(onFrame('bloom', { intensity: 1, threshold: 0.7, radius: 0.06, ramp: 0.3 }))),
    176,
    120
  ),
  thumb('ripple', 'Pulse ring', 0.45, [
    fx('ripple', { at: 0.1, repeat: 2, every: 0.95, rings: 2, radius: 0.5, stroke: 6, halo: 14, color: '#FFFFFF' }),
  ]),
  thumb('ripple-tap', 'Tap', 0.4, [
    fx('ripple', {
      variant: 'tap',
      origin: { x: 0.21, y: 0.81 },
      dot: 0.14,
      radius: 0.45,
      at: 0.15,
      repeat: 2,
      every: 0.95,
      color: '#FFFFFF',
    }),
  ]),
  thumb('resolve', 'Resolve', 0.25, [fx('resolve', { at: 0.1, duration: 1.1, blur: 0.12 })]),
  thumb('glass', 'Glass', 1, [
    {
      type: 'fx',
      effect: 'glass',
      target: { x: 600, y: 380, w: 600, h: 260, radius: 28 },
      at: 0,
      duration: 2,
      ramp: 0.6,
      highlight: 1,
    },
  ]),
  thumb('vignette-breathe', 'Breathing vignette', 1, [
    fx('vignette-breathe', { at: 0, duration: 2, angle: 1, swing: 0.15, period: 2, intensity: 1 }),
  ]),
  thumb('confetti', 'Confetti', 0.7, [
    fx('confetti', { at: 0.05, duration: 1.9, origin: { x: 0.5, y: 0.8 }, count: 32, size: 56, speed: 1.4 }),
  ]),
  thumb('glint', 'Glints', 0.5, [
    fx('glint', { path: 'corners', at: 0.1, repeat: 2, every: 0.95, count: 4, size: 90 }),
  ]),
  thumb(
    'frame',
    'Frame',
    1,
    [
      {
        type: 'frame',
        target: T,
        clearance: 20,
        radius: 60,
        thickness: 6,
        trace: 'path',
        duration: 0.7,
        color: '#FFFFFF',
        ...STROKE_TIMING,
      },
    ],
    'graphic'
  ),
  thumb(
    'corners',
    'Corner brackets',
    1,
    [
      {
        type: 'corners',
        target: T,
        clearance: 24,
        thickness: 8,
        length: 96,
        trace: 'clockwise',
        color: ACCENT,
        ...STROKE_TIMING,
        exit: 'expand',
      },
    ],
    'graphic'
  ),
  thumb(
    'underline',
    'Underline',
    1,
    [
      {
        type: 'underline',
        x: 384,
        y: 640,
        width: 512,
        thickness: 14,
        caps: 'round',
        color: ACCENT,
        ...STROKE_TIMING,
        at: 0.15,
      },
    ],
    'graphic'
  ),
  thumb('bokeh', 'Bokeh', 1, [onFrame('bokeh', { intensity: 1, speed: 0.15 })]),
  zoomed(
    thumb('dust', 'Dust', 1, stacked(onFrame('dust', { intensity: 1, size: 4, count: 40, speed: 0.08, clear: 0 }))),
    0,
    0
  ),
  zoomed(thumb('grain', 'Grain', 1, [onFrame('grain', { intensity: 1, size: 2 })])),
];

export const SAMPLE_THUMBS: SampleThumb[] = [
  { id: 'shine-sweep', label: 'Shine sweep', showcase: 'product-spotlight', at: 1.4 },
  { id: 'confetti', label: 'Confetti', showcase: 'celebration-burst', at: 0.7 },
  { id: 'sparkle', label: 'Sparkle', showcase: 'celebration-burst', at: 1.1 },
  { id: 'corner-brackets', label: 'Corner brackets', showcase: 'focus-lock', at: 1.2 },
  { id: 'pulse-ring', label: 'Pulse ring', showcase: 'focus-lock', at: 0.8 },
  { id: 'tap-pulse', label: 'Tap pulse', showcase: 'interface-focus', at: 1 },
  { id: 'light-leak', label: 'Light leak', showcase: 'light-pass', at: 0.9 },
  { id: 'white-border', label: 'White border', showcase: 'frame-reveal', at: 1.4 },
  { id: 'glow-border', label: 'Glow border', showcase: 'present-yourself', at: 4.4 },
  { id: 'rounded-border', label: 'Rounded border', showcase: 'drink-and-code', at: 2 },
];
