import type { Filter, LookInput } from '@/core/types';
import { quantizeStrength } from '@/core/footage/lut-cube';
import { presetLutValue, urlLutValue } from './lut-spec';
import type { Grade, BackgroundLayer } from '../../schemas/template.schemas';
import { revealEnableExpr } from './text';
import { parseScale, motionToFilters } from './motion';

// motionToFilters lives in ./motion (split out to keep this file under the max-lines budget) and is
// re-exported here so importers keep a single `@/editor/presets/looks` entry point.
export { motionToFilters };

// ---------------------------------------------------------------------------
// lookToFilters
// ---------------------------------------------------------------------------

type LookEntry = Filter[];

// Defensive copies are returned at call-time so downstream managers that mutate
// Filter objects in place cannot corrupt the table. The table must stay
// primitives-only (strings/numbers) so that a shallow spread copy is sufficient.
const LOOK_TABLE: Record<string, LookEntry> = {
  cinematic: [
    { type: 'eq', value: 'contrast=1.12:saturation=1.18:gamma=0.95' },
    { type: 'colorbalance', value: 'bs=0.06:rs=-0.03' },
  ],
  warm: [{ type: 'colorbalance', value: 'rs=0.08:rm=0.05:bs=-0.06' }],
  cool: [{ type: 'colorbalance', value: 'bs=0.08:bm=0.04:rs=-0.05' }],
  vintage: [
    { type: 'curves', value: 'preset=vintage' },
    { type: 'eq', value: 'saturation=0.85' },
  ],
  noir: [
    { type: 'hue', value: 's=0' },
    { type: 'eq', value: 'contrast=1.25:brightness=0.02' },
  ],
  vivid: [{ type: 'eq', value: 'saturation=1.35:contrast=1.08' }],
  dreamy: [
    { type: 'gblur', value: 'sigma=0.8' },
    { type: 'eq', value: 'brightness=0.04:saturation=1.1' },
  ],
  // LUT-backed cinema looks. The value is the LUT *name*; the FormatterManager stages its generated
  // `.cube` and rewrites it to a `lut3d=file='…'`. A single 3D LUT is a bigger, cleaner grade than the
  // eq/curves stacks above and runs on every backend (lut3d is a standard LGPL filter).
  'teal-orange': [{ type: 'lut3d', value: 'teal-orange' }],
  'warm-film': [{ type: 'lut3d', value: 'warm-film' }],
  'mono-film': [{ type: 'lut3d', value: 'mono' }],
  'noir-film': [{ type: 'lut3d', value: 'noir' }],
  'vivid-pop': [{ type: 'lut3d', value: 'vivid' }],
  // Stylized looks (Phase 4): each stays LGPL-safe (no eq/geq/boxblur) — contrast/brightness tweaks go
  // through eqValueToLutyuv instead of the GPL-only `eq` filter.
  duotone: [
    { type: 'hue', value: 's=0' },
    { type: 'colorchannelmixer', value: 'rr=1.1:gg=0.95:bb=0.75:rb=0.1' },
    { type: 'lutyuv', value: eqValueToLutyuv('contrast=1.08') },
  ],
  posterize: [{ type: 'lutyuv', value: "y='floor(val/48)*48':u='floor(val/48)*48':v='floor(val/48)*48'" }],
  sketch: [
    { type: 'edgedetect', value: 'mode=colormix:high=0.3:low=0.1' },
    { type: 'lutyuv', value: eqValueToLutyuv('contrast=1.15:brightness=0.05') },
  ],
  glitch: [
    { type: 'rgbashift', value: 'rh=-5:bh=5:edge=wrap' },
    { type: 'noise', value: 'alls=6:allf=t' },
  ],
  'soft-vignette': [{ type: 'vignette', value: 'angle=PI/5' }],
};

/**
 * Translates a named look preset into an array of Filter objects.
 * Returns [] for undefined or unknown look (Zod rejects unknown values upstream).
 */
export function lookToFilters(look?: LookInput): Filter[] {
  if (!look) {
    return [];
  }

  // `{ preset, strength }` blends a LUT look toward identity inside its generated `.cube` (still one
  // lut3d; strength 0 drops it). The string form and strength 1 lower exactly as before. Strength on a
  // non-LUT preset is rejected by validation (look_strength_unsupported) and ignored here.
  const { preset, strength } = typeof look === 'string' ? { preset: look, strength: undefined } : look;
  const filters = (LOOK_TABLE[preset] ?? []).map((filter) => ({ ...filter }));
  const amount = quantizeStrength(strength);

  if (amount === 1 || !filters.every((filter) => filter.type === 'lut3d')) {
    return filters;
  }

  return amount === 0
    ? []
    : filters.map((filter) => ({ ...filter, value: presetLutValue(String(filter.value), amount) }));
}

// ---------------------------------------------------------------------------
// gradeToFilters
// ---------------------------------------------------------------------------

type EqField = 'brightness' | 'contrast' | 'saturation' | 'gamma';

const EQ_FIELDS: EqField[] = ['brightness', 'contrast', 'saturation', 'gamma'];

type RangeKey = 'shadows' | 'midtones' | 'highlights';
type ChannelKey = 'r' | 'g' | 'b';

const CB_RANGES: [RangeKey, string][] = [
  ['shadows', 's'],
  ['midtones', 'm'],
  ['highlights', 'h'],
];

const CB_CHANNELS: [ChannelKey, string][] = [
  ['r', 'r'],
  ['g', 'g'],
  ['b', 'b'],
];

function buildEqParts(grade: Grade): string[] {
  return EQ_FIELDS.flatMap((field) => {
    const val = grade[field];

    return val === undefined ? [] : [`${field}=${val}`];
  });
}

/**
 * Translate an `eq` filter value (`contrast`/`brightness`/`saturation`/`gamma`) into an equivalent
 * LGPL `lutyuv` expression. The `eq` filter is GPL-only, so the on-device LGPL engine can't run it;
 * lutyuv replicates eq's per-channel LUT math — luma = pow((y-0.5)·contrast+0.5+brightness, 1/gamma),
 * chroma = (c-128)·saturation+128 — within ~50 dB PSNR of eq. Unknown keys fall back to identity.
 */
export function eqValueToLutyuv(eqValue: string): string {
  const params: Record<string, number> = { contrast: 1, brightness: 0, saturation: 1, gamma: 1 };

  for (const part of eqValue.split(':')) {
    const [key, raw] = part.split('=');
    const value = Number(raw);

    if (key in params && Number.isFinite(value)) {
      params[key] = value;
    }
  }

  const luma = `clip(pow(clip((val/255-0.5)*${params.contrast}+0.5+${params.brightness},0,1),1/${params.gamma})*255,0,255)`;
  const chroma = `clip((val-128)*${params.saturation}+128,0,255)`;

  return `y='${luma}':u='${chroma}':v='${chroma}'`;
}

function buildCbParts(grade: Grade): string[] {
  const { colorBalance } = grade;

  if (!colorBalance) {
    return [];
  }

  const parts: string[] = [];

  for (const [range, rangeSuffix] of CB_RANGES) {
    const rangeObj = colorBalance[range];

    for (const [channel, channelPrefix] of CB_CHANNELS) {
      const value = rangeObj?.[channel];

      if (value !== undefined) {
        parts.push(`${channelPrefix}${rangeSuffix}=${value}`);
      }
    }
  }

  return parts;
}

/**
 * Translates a Grade descriptor object into an ordered array of Filter objects.
 * Emission order: eq, hue, colorbalance, gblur, curves.
 * Returns [] for undefined or empty grade.
 */
export function gradeToFilters(grade?: Grade): Filter[] {
  if (!grade) {
    return [];
  }

  // A user LUT (camera Log → Rec.709, a colourist's cube) converts the footage first, so the eq/balance/
  // curves adjustments below work on display-referred pixels.
  const filters: Filter[] = grade.lut ? [{ type: 'lut3d', value: urlLutValue(grade.lut.url, grade.lut.strength) }] : [];
  const eqParts = buildEqParts(grade);

  if (eqParts.length > 0) {
    filters.push({ type: 'eq', value: eqParts.join(':') });
  }

  if (grade.hue !== undefined) {
    filters.push({ type: 'hue', value: `h=${grade.hue}` });
  }

  const cbParts = buildCbParts(grade);

  if (cbParts.length > 0) {
    filters.push({ type: 'colorbalance', value: cbParts.join(':') });
  }

  if (grade.blur !== undefined && grade.blur > 0) {
    filters.push({ type: 'gblur', value: `sigma=${grade.blur}` });
  }

  const grainStrength = grade.grain === undefined ? 0 : Math.round(grade.grain * 20);

  if (grainStrength > 0) {
    filters.push({ type: 'noise', value: `alls=${grainStrength}:allf=t+u` });
  }

  if (grade.curvesPreset) {
    filters.push({ type: 'curves', value: `preset=${grade.curvesPreset}` });
  }

  return filters;
}

// ---------------------------------------------------------------------------
// letterboxToFilters
// ---------------------------------------------------------------------------

type LetterboxContext = {
  /** Output scale as 'W:H', e.g. '1280:720' — used only to decide whether bars are needed. */
  scale: string;
};

/**
 * Translates a Letterbox descriptor into two drawbox filters simulating a wider aspect ratio via
 * horizontal bars, top and bottom. A no-op ([]) when the target aspect is narrower than or equal to
 * the frame's own aspect ratio, OR when it's wide enough that the resulting bar rounds to less than
 * a pixel — FFmpeg's drawbox treats an `h` that truncates to 0 as "full input height", so a
 * sub-pixel bar would fill the ENTIRE frame with the bar colour instead of doing nothing.
 */
export function letterboxToFilters(
  letterbox: { aspect: number; color?: string } | undefined,
  ctx: LetterboxContext
): Filter[] {
  if (!letterbox) {
    return [];
  }

  const { w, h } = parseScale(ctx.scale);

  if (letterbox.aspect <= w / h) {
    return [];
  }

  if ((h - w / letterbox.aspect) / 2 < 1) {
    return [];
  }

  const color = letterbox.color ?? 'black';
  const barHeight = `(ih-iw/${letterbox.aspect})/2`;

  return [
    { type: 'drawbox', values: { x: 0, y: 0, w: 'iw', h: barHeight, c: `${color}@1`, t: 'fill' } },
    { type: 'drawbox', values: { x: 0, y: `ih-${barHeight}`, w: 'iw', h: barHeight, c: `${color}@1`, t: 'fill' } },
  ];
}

// ---------------------------------------------------------------------------
// layersToFilters
// ---------------------------------------------------------------------------

/**
 * Translates an array of BackgroundLayer descriptors into drawbox Filter objects.
 *
 * NOTE: Gradient layers need a `gradients` lavfi source input and an overlay map,
 * which cannot be expressed as a plain section filter — they are intentionally
 * skipped here and compiled by the input/maps pipeline.
 *
 * Layers without a color AND without a border AND without a gradient are also skipped
 * (nothing to draw). A layer with a `border` emits a second drawbox with a numeric
 * thickness `t=<width>` after the fill — or alone for outline-only layers.
 *
 * A layer `reveal` gates the fill AND border drawboxes with `enable='gte(t,delay)'` — drawbox has
 * no alpha expression, so a solid layer POPS in at the reveal delay (the timeline gate is core
 * LGPL, on-device-safe). Gradient layers get the full fade/slide entrance instead, via the
 * overlay-motion machinery in MapManager.addGradientOverlay.
 */
// Drawbox filters for a single background layer: nothing for a gradient (compiled by the input/maps
// pipeline), a `fill` drawbox for a color, and a numeric-thickness drawbox for a border — each gated
// by the layer `reveal` timeline. See layersToFilters for the full contract.
function layerToDrawboxFilters(layer: BackgroundLayer): Filter[] {
  if (layer.gradient) {
    // Gradient layers are compiled by the input/maps pipeline, not as section filters.
    return [];
  }

  const opacity = layer.opacity ?? 1;
  const geometry = {
    x: layer.x ?? 0,
    y: layer.y ?? 0,
    w: layer.w ?? 'iw',
    h: layer.h ?? 'ih',
  };
  const enable = revealEnableExpr(layer.reveal);
  const gate = enable === undefined ? {} : { enable };

  const filters: Filter[] = [];

  if (layer.color) {
    filters.push({
      type: 'drawbox',
      values: { ...geometry, c: `${layer.color}@${opacity}`, t: 'fill', ...gate },
    });
  }

  if (layer.border) {
    filters.push({
      type: 'drawbox',
      values: { ...geometry, c: `${layer.border.color}@${opacity}`, t: layer.border.width, ...gate },
    });
  }

  return filters;
}

export function layersToFilters(layers: BackgroundLayer[] | undefined): Filter[] {
  if (!layers || layers.length === 0) {
    return [];
  }

  const filters: Filter[] = [];

  for (const layer of layers) {
    filters.push(...layerToDrawboxFilters(layer));
  }

  return filters;
}
