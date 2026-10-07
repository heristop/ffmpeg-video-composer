// Pure: text overlays -> drawtext filters for the descriptor. Shared by the video/color/image
// section builders.
import type { Section } from 'ffmpeg-video-composer/src/core/types.d.ts';
import type { VideoFilterStage } from './video-filter-types';
import { findFont } from '../fonts';
import { resolveAccentBar, type AccentBar } from './accent-bar';
import type { TextEffect, TextOverlay } from './model';
import type { RawPosition } from './raw-position';

type StoredFilter = NonNullable<Section['filters']>[number];
type StoredValues = NonNullable<StoredFilter['values']>;

// Mirrors applyTextEffect in the engine (editor/presets/text.ts) — kept local because that module
// resolves through the engine's `@/` alias, which the web bundle cannot import. The kit round-trip
// test pins these exact defaults so any engine-side change is caught.
const SHADOW_DEFAULTS = { color: '#000000@0.6', dx: 2, dy: 2 };
const OUTLINE_DEFAULTS = { color: '#000000', width: 2 };

// The boxborderw the kit has always emitted; overlays without an authored boxPadding keep it, and
// a parsed value equal to it collapses back to an absent field (see overlayParsing). Exported so
// the web canvas preview pads its CSS box with the exact same default.
export const DEFAULT_BOX_PADDING = 12;

// Lower a TextEffect to the drawtext shadow/border keys; empty when the overlay has no effect,
// so older overlays keep emitting the exact same filter values.
function effectValues(
  effect: TextEffect | undefined
): Pick<StoredValues, 'shadowcolor' | 'shadowx' | 'shadowy' | 'bordercolor' | 'borderw'> {
  if (!effect) return {};

  const values: Pick<StoredValues, 'shadowcolor' | 'shadowx' | 'shadowy' | 'bordercolor' | 'borderw'> = {};

  if (effect.shadow) {
    const shadow = effect.shadow === true ? SHADOW_DEFAULTS : { ...SHADOW_DEFAULTS, ...effect.shadow };
    values.shadowcolor = shadow.color;
    values.shadowx = shadow.dx;
    values.shadowy = shadow.dy;
  }

  if (effect.outline) {
    const outline = effect.outline === true ? OUTLINE_DEFAULTS : { ...OUTLINE_DEFAULTS, ...effect.outline };
    values.bordercolor = outline.color;
    values.borderw = outline.width;
  }

  return values;
}

// Clamp a 0–1 position fraction and round to 3 decimals for stable filter expressions.
function roundFraction(value: number): number {
  const clamped = Math.min(1, Math.max(0, value));

  return Math.round(clamped * 1000) / 1000;
}

// fontcolor with the optional watermark alpha riding as a `@a` suffix — the same token boxcolor
// uses — instead of the drawtext `alpha` option, which FilterManager.bakeTextAnimation overwrites
// with the reveal/exit expression. Opacity-less overlays keep emitting the bare color unchanged.
function fontcolorFrom(overlay: TextOverlay): string {
  if (overlay.textOpacity === undefined) return overlay.fontcolor;

  return `${overlay.fontcolor}@${overlay.textOpacity}`;
}

// The stored expression wins only while the fraction it was parsed into is still the overlay's fraction.
function positionExpr(raw: RawPosition['rawX'], fraction: number, anchor: string): string | number {
  if (raw?.fraction === fraction) return raw.expr;

  return `${anchor}*${roundFraction(fraction)}`;
}

// A drawtext filter for one overlay. Box keys are only added when the overlay
// opts into a background box; boxcolor carries the author-set opacity suffix.
function drawtextFilterFrom(overlay: TextOverlay & RawPosition): StoredFilter {
  return {
    type: 'drawtext',
    values: {
      text: { en: overlay.text },
      fontsize: overlay.fontsize,
      fontcolor: fontcolorFrom(overlay),
      fontfile: findFont(overlay.font)?.file ?? 'Rubik.ttf',
      x: positionExpr(overlay.rawX, overlay.x, '(w-text_w)'),
      y: positionExpr(overlay.rawY, overlay.y, '(h-text_h)'),
      ...(overlay.box
        ? {
            box: 1,
            boxcolor: `${overlay.boxcolor}@${overlay.boxOpacity}`,
            boxborderw: overlay.boxPadding ?? DEFAULT_BOX_PADDING,
          }
        : {}),
      ...effectValues(overlay.effect),
    },
    // The entrance/exit animations ride as sibling `reveal`/`exit` the engine bakes onto the drawtext;
    // x/y stay the base fractions so the overlay still round-trips through overlayFrom.
    ...(overlay.reveal ? { reveal: overlay.reveal } : {}),
    ...(overlay.exit ? { exit: overlay.exit } : {}),
  };
}

// Default reveal delay, mirroring the engine's DEFAULT_DELAY (editor/presets/text.ts). The kit
// round-trip test pins the emitted gate so an engine-side change is caught.
const REVEAL_DEFAULT_DELAY = 0.3;

// The timeline gate keeping the accent bar in step with its drawtext's reveal: drawbox has no alpha
// expression, so the bar pops in at the reveal delay (`enable='gte(t,delay)'`, pre-quoted because
// the expression holds a comma) instead of sitting on screen before its text. No reveal / `none` /
// a zero delay emit nothing, so existing descriptors stay byte-identical.
function accentEnable(reveal: TextOverlay['reveal']): string | undefined {
  if (!reveal) return undefined;

  const obj = typeof reveal === 'string' ? { type: reveal } : reveal;

  if (obj.type === 'none') return undefined;

  const delay = 'delay' in obj && obj.delay !== undefined ? obj.delay : REVEAL_DEFAULT_DELAY;

  // A time reference ("title.end + 0.2") only resolves inside the engine; the bar then shows from the
  // section start rather than guessing its number here.
  if (typeof delay === 'string' || delay <= 0) return undefined;

  return `'gte(t,${Number(delay.toFixed(4))})'`;
}

// The bar's x expression for one alignment. drawbox cannot reference text_w, so exact text-edge
// alignment is impossible; instead each mode anchors an edge of the bar on the overlay's x anchor
// LINE (iw*fx — the frame point the drawtext's own `(w-text_w)*fx` layout passes through):
// 'center' keeps the historic fraction-aligned form (the same (iw-W)*fx layout the text uses),
// 'left' hangs the bar rightward from the anchor, 'right' ends it on the anchor.
function accentX(align: Required<AccentBar>['align'], barW: number, fx: number): string {
  if (align === 'left') return `iw*${fx}`;

  if (align === 'right') return `iw*${fx}-${barW}`;

  return `(iw-${barW})*${fx}`;
}

// The bar's y expression: 'below' sits one approximated text height (fontsize*1.2) plus the gap
// under the drawtext y anchor (the historical underline); 'above' sits gap + bar height over it.
function accentY(
  position: Required<AccentBar>['position'],
  textH: number,
  gap: number,
  barH: number,
  fy: number
): string {
  if (position === 'above') return `(ih-${textH})*${fy}-${gap + barH}`;

  return `(ih-${textH})*${fy}+${textH + gap}`;
}

// The accent bar riding the text — the title-card treatment (engine text-blocks.ts accentBar) for
// a positionable overlay. The kit never knows the output size, so the geometry uses the drawbox
// expression vocabulary (iw/ih) mirroring the drawtext `(w-text_w)*fraction` anchor. length and
// thickness are em (multiples of the fontsize) so the bar scales with the text; the defaults
// (below / 6em / 0.12em floored at 4px / center) reproduce the historical hardcoded bar exactly,
// keeping a bare colour string byte-identical in the emitted filters. The bar is emitted right
// AFTER its drawtext so overlayParsing can recover the pair by adjacency. A revealed overlay gates
// the bar with the reveal delay (accentEnable) so it enters with its text.
function accentBarFilters(overlay: TextOverlay): StoredFilter[] {
  if (!overlay.accent) return [];

  const bar = resolveAccentBar(overlay.accent);
  const textH = Math.round(overlay.fontsize * 1.2);
  const barW = Math.round(overlay.fontsize * bar.length);
  const barH = Math.max(4, Math.round(overlay.fontsize * bar.thickness));
  const gap = Math.round(overlay.fontsize * 0.25);
  const enable = accentEnable(overlay.reveal);

  return [
    {
      type: 'drawbox',
      values: {
        x: accentX(bar.align, barW, roundFraction(overlay.x)),
        y: accentY(bar.position, textH, gap, barH, roundFraction(overlay.y)),
        w: barW,
        h: barH,
        c: `${bar.color}@1`,
        t: 'fill',
        ...(enable === undefined ? {} : { enable }),
      },
    },
  ];
}

// Non-empty text overlays → drawtext filters (each followed by its optional accent bar), in author
// order. Shared by video/color/image sections; tolerant of an absent list (older states / sections
// built before overlays existed on this kind).
export function overlayFiltersFrom(overlays: TextOverlay[] | undefined): StoredFilter[] {
  return (overlays ?? []).flatMap((o) => {
    if (o.text.trim() === '') {
      return [];
    }

    return [drawtextFilterFrom(o), ...accentBarFilters(o)];
  });
}

// Reinsert advanced native filters at their retained text slots. If the author deletes text,
// stages keep their boundary at the next surviving import slot (or the end).
export function videoFiltersFrom(overlays: TextOverlay[], stages: VideoFilterStage[] | undefined): StoredFilter[] {
  const filters: StoredFilter[] = [];

  for (let index = 0; index <= overlays.length; index++) {
    for (const stage of stages ?? []) {
      const anchor = overlays.findIndex(
        (overlay) => overlay.filterSlot !== undefined && overlay.filterSlot >= stage.beforeOverlay
      );
      let position = overlays.length;

      if (anchor >= 0) position = anchor;

      if (stage.beforeOverlay === 0) position = 0;

      if (position === index) {
        filters.push(...(JSON.parse(JSON.stringify(stage.filters)) as StoredFilter[]));
      }
    }

    if (index < overlays.length) filters.push(...overlayFiltersFrom([overlays[index]]));
  }

  return filters;
}
