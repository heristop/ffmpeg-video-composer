// The caption sugar's layout numbers, as numbers — no FFmpeg, no filters, no imports.
//
// Two modules need to agree on where a caption lands: `captions.ts`, which lowers a caption into a
// drawtext filter, and `services/geometry/text-boxes.ts`, which predicts where that drawtext will
// paint so `leclap validate` can warn about overflow and collisions. Before this module existed the
// second copy was transcribed by hand and had already drifted — it modelled the default size as
// `height * 0.055` (39.6px landscape, 70.4px portrait) against a real, orientation-independent 46px,
// and the anchors as fractions of the frame against real fixed pixel offsets. Sharing the constants
// is the only version of "kept in sync" that survives contact with the next edit.

export interface CaptionStyleValues {
  fontfile: string;
  fontsize: number;
  fontcolor: string;
  box?: number;
  boxcolor?: string;
  boxborderw?: number;
}

// Fixed look per style preset. `bar` is a boxed lower-third; `subtle`/`bold` draw no background box.
export const CAPTION_STYLE_VALUES: Record<string, CaptionStyleValues> = {
  bar: {
    fontfile: 'Oswald.ttf',
    fontsize: 46,
    fontcolor: '#f5f5f0',
    box: 1,
    boxcolor: '#141416@0.8',
    boxborderw: 18,
  },
  subtle: {
    fontfile: 'Rubik.ttf',
    fontsize: 44,
    fontcolor: '#ffffff',
  },
  bold: {
    fontfile: 'BebasNeue.ttf',
    fontsize: 72,
    fontcolor: '#ffffff',
  },
};

export const CAPTION_DEFAULT_STYLE = 'bar';
export const CAPTION_DEFAULT_POSITION = 'lower-third';
export const CAPTION_DEFAULT_ALIGN = 'center';

// `left`/`right` use an 80px margin to match the premium templates' convention.
export const CAPTION_ALIGN_MARGIN = 80;

// Box defaults applied when the caption explicitly turns a box ON but the preset had none.
export const CAPTION_DEFAULT_BOX_COLOR = '#000000';
export const CAPTION_DEFAULT_BOX_OPACITY = 0.8;
export const CAPTION_DEFAULT_BOX_BORDER = 18;

// Vertical placement as an anchored edge plus an offset in output pixels. `captions.ts` renders this
// as a drawtext expression (`(h-text_h)-110`); the geometry model resolves it against a measured
// text height. Both start here, so neither can quietly become a ratio again.
export interface CaptionAnchorY {
  edge: 'top' | 'center' | 'bottom';
  offset: number;
}

export const CAPTION_ANCHOR_Y: Record<string, CaptionAnchorY> = {
  top: { edge: 'top', offset: 60 },
  center: { edge: 'center', offset: 0 },
  bottom: { edge: 'bottom', offset: 60 },
  'lower-third': { edge: 'bottom', offset: 110 },
};

// Extra pixels kept between a platform's bottom safe zone and the default caption's text, so the box
// padding (`boxborderw`, 18px for the bar style) also clears the app UI.
export const CAPTION_PLATFORM_CLEARANCE = 24;

// The default (`lower-third`) caption's distance from the bottom edge once a delivery platform covers
// `bottomFraction` of a frame `height` px tall: the preset's own offset, or enough to clear the UI.
export function platformCaptionOffset(height: number, bottomFraction: number): number {
  const preset = CAPTION_ANCHOR_Y[CAPTION_DEFAULT_POSITION].offset;

  return Math.max(preset, Math.ceil(height * bottomFraction) + CAPTION_PLATFORM_CLEARANCE);
}

// `Object.hasOwn` rather than `TABLE[key] ?? fallback`: a plain object inherits `toString`,
// `constructor` and `__proto__`, all of which are truthy, so `??` never reaches the fallback — it
// hands back a Function, and every coordinate derived from it becomes NaN. NaN then fails every
// comparison in the rules, so a descriptor that skipped schema validation would silently pass.
export function captionStyleValues(style: string | undefined): CaptionStyleValues {
  const key = style ?? CAPTION_DEFAULT_STYLE;

  return Object.hasOwn(CAPTION_STYLE_VALUES, key)
    ? CAPTION_STYLE_VALUES[key]
    : CAPTION_STYLE_VALUES[CAPTION_DEFAULT_STYLE];
}

export function captionAnchorY(position: string | undefined): CaptionAnchorY {
  const key = position ?? CAPTION_DEFAULT_POSITION;

  return Object.hasOwn(CAPTION_ANCHOR_Y, key) ? CAPTION_ANCHOR_Y[key] : CAPTION_ANCHOR_Y[CAPTION_DEFAULT_POSITION];
}
