// HTML layer constants, apart from the layout code so the validation rules import nothing else.

/** The largest box side, in output pixels. */
export const HTML_LAYER_MAX_SIZE = 1920;

/** Pixels rendered per output pixel: the PNG is drawn at 2× and scaled into its box by the overlay. */
export const HTML_LAYER_DENSITY = 2;

/** Bumped whenever the layout rules change what a layer draws, so cached renders are not reused. */
export const HTML_LAYOUT_VERSION = 1;

// ── animated cards (an html input's `motion` map, editor/html/stage-html-sequence.ts) ──────────────────

/** A `data-motion` name in the markup, and a key of the input's `motion` map. */
export const HTML_MOTION_NAME = /^[a-z][a-z0-9-]{0,31}$/;

/** Words generic descriptor walkers key on anywhere, so no element may be named one. */
export const HTML_MOTION_RESERVED_NAMES: readonly string[] = ['ease', 'easing', 'animate'];

/** The one rule for an element's motion name: the name pattern, and not a reserved word. */
export function isMotionName(name: string): boolean {
  return HTML_MOTION_NAME.test(name) && !HTML_MOTION_RESERVED_NAMES.includes(name);
}

/** The tracks an element of an animated card takes (offsets in pixels, degrees, multipliers). */
export const ELEMENT_MOTION_TRACKS = ['x', 'y', 'scale', 'rotate', 'opacity'] as const;

/** Motion names one card's `motion` map may hold. */
export const HTML_MOTION_MAX_NAMES = 16;

/** Elements carrying a `data-motion` name in one card. */
export const HTML_MOTION_MAX_TARGETS = 48;

/** Seconds from a card's first key to its last, staggers included. */
export const HTML_MOTION_MAX_SPAN = 8;

/** Distinct frames one animated card may draw. */
export const HTML_MOTION_MAX_FRAMES = 240;

/** Pixels one animated card may draw, every frame together, at HTML_LAYER_DENSITY. */
export const HTML_MOTION_MAX_PIXELS = 500_000_000;

/** Bytes of one card's drawn frames: past it the card is staged as a still. */
export const HTML_MOTION_MAX_BYTES = 48 * 1024 * 1024;

/** Frames the first (lead) frame of a card may last: an animated PNG stores a frame's delay in 16 bits. */
export const HTML_MOTION_MAX_LEAD_TICKS = 0xffff;

/** The furthest an element may be offset, in output pixels, either way. */
export const HTML_MOTION_MAX_OFFSET = 20_000;

/** The furthest an element may be turned, in degrees, either way. */
export const HTML_MOTION_MAX_TURN = 36_000;

/** Milliseconds one card's frames may take to draw before it is staged as a still. */
export const HTML_MOTION_DEADLINE_MS = 120_000;

/** Bumped whenever the frame plan or the sequence format changes what an animated card draws. */
export const HTML_MOTION_VERSION = 1;

/** The staged url prefix of an animated card (a still card is `html:<hash>`). */
export const HTML_SEQUENCE_SCHEME = 'html-seq:';
