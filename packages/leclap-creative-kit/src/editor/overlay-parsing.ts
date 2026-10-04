// Reverse the drawtext encoding buildDescriptor emits: recover a TextOverlay (position fractions,
// box color/opacity) from a stored section's drawtext filter values.
import type { Section } from 'ffmpeg-video-composer/src/core/types.d.ts';
import type { VideoFilterStage } from './video-filter-types';
import { ACCENT_BAR_DEFAULTS, type AccentBar } from './accent-bar';
import type { RawPosition } from './raw-position';
import { fontIdFromFile, type TextEffect, type TextOverlay, type EditorSection } from './model';
import { DEFAULT_BOX_PADDING } from './overlay-filters';

type StoredFilter = NonNullable<Section['filters']>[number];
type DrawtextValues = NonNullable<StoredFilter['values']>;

// Recover the [0,1] position fraction from a stored drawtext x/y expression of the
// `(w-text_w)*<frac>` form; the legacy `(…)/2` centered form (or anything unparseable) → 0.5.
export function parseFraction(value?: string | number): number {
  if (typeof value !== 'string') return 0.5;

  const match = /\)\s*\*\s*(\d*\.?\d+)/.exec(value);

  if (!match) return 0.5;

  const fraction = Number(match[1]);

  if (!Number.isFinite(fraction)) return 0.5;

  return Math.min(1, Math.max(0, fraction));
}

// Keep the stored expression when the fraction form cannot reproduce it, so a builder save leaves
// absolute and offset positions untouched. Canonical `(w-text_w)*<frac>` values need no raw copy.
function rawPositionFrom(value?: string | number): RawPosition['rawX'] {
  if (typeof value === 'string' && /^\((w-text_w|h-text_h)\)\s*\*\s*(\d*\.?\d+)$/.test(value.trim())) return undefined;

  if (value === undefined) return undefined;

  return { expr: value, fraction: parseFraction(value) };
}

function positionFrom(v: DrawtextValues): Pick<TextOverlay, 'x' | 'y'> & RawPosition {
  return {
    x: parseFraction(v.x),
    y: parseFraction(v.y),
    ...(rawPositionFrom(v.x) ? { rawX: rawPositionFrom(v.x) } : {}),
    ...(rawPositionFrom(v.y) ? { rawY: rawPositionFrom(v.y) } : {}),
  };
}

// Recover a [0,1] opacity from a `<hex>@<opacity>` color token; undefined when the token carries
// no alpha suffix or the suffix is unparseable. Shared by the boxcolor and fontcolor paths.
function parseOpacityToken(color: string | undefined): number | undefined {
  const match = /@(\d*\.?\d+)/.exec(color ?? '');

  if (!match) return undefined;

  const value = Number(match[1]);

  if (!Number.isFinite(value)) return undefined;

  return Math.min(1, Math.max(0, value));
}

// Box opacity keeps its historical 0.5 default when the stored boxcolor has no alpha suffix.
function parseOpacity(boxcolor: string | undefined): number {
  return parseOpacityToken(boxcolor) ?? 0.5;
}

// Recover the authored boxPadding from a stored boxborderw: undefined when the box is off, the
// value is absent, equals the historical 12 default, or is non-numeric (the FFmpeg n8.0 per-side
// "up|right|down|left" string — hand-authored only; regenerated builds fall back to uniform padding).
function parseBoxPadding(v: DrawtextValues): number | undefined {
  if (v.box === undefined || v.boxborderw === undefined) return undefined;

  const padding = Number(v.boxborderw);

  if (!Number.isFinite(padding)) return undefined;

  if (padding === DEFAULT_BOX_PADDING) return undefined;

  return Math.max(0, padding);
}

// The engine defaults applyTextEffect bakes in (editor/presets/text.ts); values equal to these
// collapse back to `shadow: true` / `outline: true` so a default effect round-trips unchanged.
const SHADOW_DEFAULTS = { color: '#000000@0.6', dx: 2, dy: 2 };
const OUTLINE_DEFAULTS = { color: '#000000', width: 2 };

// A stored numeric drawtext value, tolerating string encodings; the default when absent/unparseable.
function numOr(value: number | string | undefined, fallback: number): number {
  const n = Number(value);

  if (!Number.isFinite(n)) return fallback;

  return n;
}

// Recover the shadow half of a TextEffect from stored drawtext keys: absent → undefined,
// all-default → true, otherwise an object carrying only the overridden fields.
function parseShadow(v: DrawtextValues): TextEffect['shadow'] {
  if (v.shadowcolor === undefined) return undefined;

  const dx = numOr(v.shadowx, SHADOW_DEFAULTS.dx);
  const dy = numOr(v.shadowy, SHADOW_DEFAULTS.dy);
  const shadow = {
    ...(v.shadowcolor === SHADOW_DEFAULTS.color ? {} : { color: v.shadowcolor }),
    ...(dx === SHADOW_DEFAULTS.dx ? {} : { dx }),
    ...(dy === SHADOW_DEFAULTS.dy ? {} : { dy }),
  };

  if (Object.keys(shadow).length === 0) return true;

  return shadow;
}

// Recover the outline half of a TextEffect from stored drawtext keys — same collapse rules as parseShadow.
function parseOutline(v: DrawtextValues): TextEffect['outline'] {
  if (v.bordercolor === undefined && v.borderw === undefined) return undefined;

  const width = numOr(v.borderw, OUTLINE_DEFAULTS.width);
  const outline = {
    ...(v.bordercolor === undefined || v.bordercolor === OUTLINE_DEFAULTS.color ? {} : { color: v.bordercolor }),
    ...(width === OUTLINE_DEFAULTS.width ? {} : { width }),
  };

  if (Object.keys(outline).length === 0) return true;

  return outline;
}

// Recover the overlay's TextEffect; undefined when the drawtext carries no shadow/border keys, so
// overlays saved before the effect existed round-trip without a spurious field.
function parseEffect(v: DrawtextValues): TextEffect | undefined {
  const shadow = parseShadow(v);
  const outline = parseOutline(v);

  if (shadow === undefined && outline === undefined) return undefined;

  return { ...(shadow === undefined ? {} : { shadow }), ...(outline === undefined ? {} : { outline }) };
}

export function overlayFrom(dt: {
  values?: DrawtextValues;
  reveal?: TextOverlay['reveal'];
  exit?: TextOverlay['exit'];
}): TextOverlay {
  const v = dt.values ?? {};
  const effect = parseEffect(v);
  // Watermark alpha rides the fontcolor as `#hex@a`; absent suffix → no field, so overlays saved
  // before text opacity existed round-trip without a spurious key.
  const textOpacity = parseOpacityToken(v.fontcolor);
  // Non-default boxborderw rides back as boxPadding; the 12 default collapses to an absent field so
  // overlays saved before the padding control existed round-trip unchanged.
  const boxPadding = parseBoxPadding(v);

  return {
    text: v.text?.en ?? '',
    ...positionFrom(v),
    fontsize: Number(v.fontsize ?? 48),
    fontcolor: (v.fontcolor ?? '#ffffff').split('@')[0],
    font: fontIdFromFile(v.fontfile),
    box: v.box !== undefined,
    boxcolor: (v.boxcolor ?? '#000000').split('@')[0],
    boxOpacity: parseOpacity(v.boxcolor),
    ...(boxPadding === undefined ? {} : { boxPadding }),
    ...(textOpacity === undefined ? {} : { textOpacity }),
    ...(dt.reveal ? { reveal: dt.reveal } : {}),
    ...(dt.exit ? { exit: dt.exit } : {}),
    ...(effect ? { effect } : {}),
  };
}

// The x forms accentBarFilters emits, one per alignment: centered `(iw-W)*f`, left `iw*f`,
// right `iw*f-W`. Anything else (a numeric offset, a hand-authored expression) is not a kit bar.
const ACCENT_CENTER_X = /^\(iw-(\d+)\)\*(\d*\.?\d+)$/;
const ACCENT_LEFT_X = /^iw\*(\d*\.?\d+)$/;
const ACCENT_RIGHT_X = /^iw\*(\d*\.?\d+)-(\d+)$/;
// The y form: `(ih-textH)*f` plus the below (+) / above (-) offset.
const ACCENT_Y = /^\(ih-\d+\)\*\d*\.?\d+([+-])\d+$/;

// The alignment encoded by a bar's x expression, cross-checked against the stored width so a
// hand-authored drawbox whose x disagrees with its w is never claimed. undefined = not a kit form.
function accentAlignFrom(x: unknown, barW: number): Required<AccentBar>['align'] | undefined {
  if (typeof x !== 'string') return undefined;

  const center = ACCENT_CENTER_X.exec(x);

  if (center) return Number(center[1]) === barW ? 'center' : undefined;

  if (ACCENT_LEFT_X.test(x)) return 'left';

  const right = ACCENT_RIGHT_X.exec(x);

  if (!right) return undefined;

  return Number(right[2]) === barW ? 'right' : undefined;
}

// The vertical side encoded by a bar's y expression sign. undefined = not a kit form.
function accentPositionFrom(y: unknown): Required<AccentBar>['position'] | undefined {
  const match = typeof y === 'string' ? ACCENT_Y.exec(y) : null;

  if (!match) return undefined;

  return match[1] === '+' ? 'below' : 'above';
}

// px → em at 3 decimals: a finer grid than the builder sliders, and close enough that re-emitting
// the rounded value reproduces the same rounded px (error ≤ fontsize*0.0005 < 0.5 for the whole
// authoring range), so rebuilds never drift.
function emOf(px: number, fontsize: number): number {
  return Math.round((px / fontsize) * 1000) / 1000;
}

// The raw bar a kit-emitted accent drawbox describes: the colour plus its px geometry. undefined
// when `filter` is not a kit bar — the extended adjacency signature requires a solid fill, string
// colour, numeric w/h AND the expression-form x/y anchors, so a hand-authored wash (numeric
// offsets, foreign expressions) stays unclaimed.
function accentBarValuesFrom(filter: StoredFilter | undefined):
  | {
      color: string;
      barW: number;
      barH: number;
      align: Required<AccentBar>['align'];
      position: Required<AccentBar>['position'];
    }
  | undefined {
  if (filter?.type !== 'drawbox') return undefined;

  const v = filter.values ?? {};

  if (v.t !== 'fill' || typeof v.c !== 'string') return undefined;

  const barW = Number(v.w);
  const barH = Number(v.h);

  if (!Number.isFinite(barW) || !Number.isFinite(barH)) return undefined;

  const align = accentAlignFrom(v.x, barW);
  const position = accentPositionFrom(v.y);

  if (align === undefined || position === undefined) return undefined;

  return { color: v.c.split('@')[0], barW, barH, align, position };
}

// The accent when `filter` is a kit-emitted accent bar. Geometry is read back in em against the
// paired drawtext's fontsize; fields matching the defaults IN PIXELS drop out (the default h for
// fontsize 48 is 6px = 0.125em, not 0.12 — the px compare is what collapses it), so an untouched
// bar returns the minimal plain colour string.
function accentFrom(filter: StoredFilter | undefined, fontsize: number): string | AccentBar | undefined {
  const raw = accentBarValuesFrom(filter);

  if (raw === undefined) return undefined;

  const defaultW = Math.round(fontsize * ACCENT_BAR_DEFAULTS.length);
  const defaultH = Math.max(4, Math.round(fontsize * ACCENT_BAR_DEFAULTS.thickness));
  const bar: AccentBar = {
    color: raw.color,
    ...(raw.position === ACCENT_BAR_DEFAULTS.position ? {} : { position: raw.position }),
    ...(raw.barW === defaultW ? {} : { length: emOf(raw.barW, fontsize) }),
    ...(raw.barH === defaultH ? {} : { thickness: emOf(raw.barH, fontsize) }),
    ...(raw.align === ACCENT_BAR_DEFAULTS.align ? {} : { align: raw.align }),
  };

  if (Object.keys(bar).length === 1) return bar.color;

  return bar;
}

// Section filters → TextOverlays: each drawtext becomes an overlay, and a kit accent drawbox
// immediately after it rides back as the overlay's accent (colour, plus any non-default geometry).
// Other filter types pass silently (they never described overlays). Shared by the video/color/image
// section importers.
export function overlaysFromFilters(filters: Section['filters']): TextOverlay[] {
  const list = filters ?? [];

  return list.flatMap((filter, index) => {
    if (filter.type !== 'drawtext') return [];

    const base = overlayFrom(filter);
    // The bar's em geometry is measured against ITS drawtext's fontsize — the same scale the
    // lowering multiplied by.
    const accent = accentFrom(list[index + 1], base.fontsize);

    return [{ ...base, ...(accent === undefined ? {} : { accent }) }];
  });
}

// Keep native video processing in its original order relative to editable text. Kit accent bars
// remain part of their text overlay, so they are not also retained as raw filters.
export function filterStagesFromFilters(filters: Section['filters']): VideoFilterStage[] {
  const list = filters ?? [];
  const stages: VideoFilterStage[] = [];
  let beforeOverlay = 0;

  for (const [index, filter] of list.entries()) {
    if (filter.type === 'drawtext') {
      beforeOverlay++;
      continue;
    }
    const previous: StoredFilter | undefined = list.at(index - 1);

    if (
      index > 0 &&
      previous?.type === 'drawtext' &&
      accentFrom(filter, Number(previous.values?.fontsize ?? 48)) !== undefined
    ) {
      continue;
    }

    let stage = stages.at(-1);

    if (!stage || stage.beforeOverlay !== beforeOverlay) {
      stage = { beforeOverlay, filters: [] };
      stages.push(stage);
    }
    // Filter descriptors are plain JSON; this also works on native runtimes without structuredClone.
    stage.filters.push(JSON.parse(JSON.stringify(filter)) as StoredFilter);
  }

  return stages;
}

export function videoFilterStateFrom(
  filters: Section['filters']
): Pick<Extract<EditorSection, { kind: 'video' }>, 'overlays' | 'filterStages'> {
  const filterStages = filterStagesFromFilters(filters);

  return {
    overlays: overlaysFromFilters(filters).map((overlay, filterSlot) =>
      filterStages.length > 0 ? { ...overlay, filterSlot } : overlay
    ),
    ...(filterStages.length > 0 ? { filterStages } : {}),
  };
}
