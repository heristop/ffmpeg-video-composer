// Pulls the emoji out of a section's drawtext filters: each emoji cluster leaves the drawn text (a
// measured gap takes its place) and becomes an image overlay at the gap's position, sharing the text's
// `enable` window, its motion and (approximately) its alpha. Filters without emoji are returned as the
// very same objects, so a template without emoji lowers byte-identically.
import type { Filter } from '@/core/types';
import { hasEmoji } from '@/core/emoji-clusters';
import { emojiAssetFile, type EmojiMode } from '@/core/emoji-assets';
import { evaluateExpr } from '../../services/geometry/drawtext-expr';
import { coverageFor, layoutEmojiText, type EmojiTextLayout } from './emoji-text';
import {
  emojiAlphaFilters,
  overlayCoordinate,
  overlayEnable,
  type DrawtextMetrics,
  type FadeWindow,
  type OverlayCoordinate,
} from './emoji-expr';

// drawtext's line box and glyph extents as fractions of the font size — the geometry model's 1.2 line
// height, with the baseline 0.9em below the top of the line.
const LINE_HEIGHT = 1.2;
const ASCENT = 0.9;
const DESCENT = -0.25;
const DRAWTEXT_DEFAULT_FONT_SIZE = 16;
// The image sits centred on the line box, lifted slightly towards the cap height.
const LIFT = 0.05;

/** One emoji image to composite over the section. */
export interface EmojiOverlay {
  /** Bundled image file name, e.g. `1f525.png`. */
  file: string;
  size: number;
  x: string;
  y: string;
  /** True when x/y are time expressions (named, quoted overlay options). */
  moving: boolean;
  /** `:enable='…'` suffix, or ''. */
  enable: string;
  /** Filters on the image leg after scaling (alpha). */
  leg: string[];
}

export interface EmojiContext {
  mode: EmojiMode;
  width: number;
  height: number;
  duration: number;
  fps: number;
  /** The final drawn string of a drawtext `text` (locale, variables, fields, case), or null. */
  resolveText: (text: unknown) => string | null;
  budget: { remaining: number };
  warn: (message: string) => void;
}

export interface EmojiExtraction {
  filters: Filter[];
  overlays: EmojiOverlay[];
  /** The rewritten drawtext filters, by identity (the emoji composite after the last of them). */
  rewritten: Set<Filter>;
}

type Values = Record<string, unknown>;

function frameOf(ctx: EmojiContext): { w: number; h: number } {
  return { w: ctx.width, h: ctx.height };
}

// The font size in px: a constant, or for a scaled kinetic unit its settled (end-of-section) size.
function fontSizeOf(values: Values, ctx: EmojiContext): number | null {
  const authored = values.fontsize ?? DRAWTEXT_DEFAULT_FONT_SIZE;
  const size = evaluateExpr(authored, frameOf(ctx)) ?? evaluateExpr(authored, { ...frameOf(ctx), t: ctx.duration });

  return size !== null && size > 0 ? size : null;
}

function metricsFor(layout: EmojiTextLayout, fontSize: number, ctx: EmojiContext): DrawtextMetrics {
  return {
    ...frameOf(ctx),
    text_w: Math.max(0, ...layout.lineWidths),
    text_h: fontSize * LINE_HEIGHT * layout.lineWidths.length,
    line_h: fontSize * LINE_HEIGHT,
    max_glyph_a: fontSize * ASCENT,
    max_glyph_d: fontSize * DESCENT,
    max_glyph_h: fontSize * (ASCENT - DESCENT),
    max_glyph_w: fontSize,
  };
}

function legFor(values: Values, ctx: EmojiContext): string[] {
  const window: FadeWindow = { duration: ctx.duration, fps: ctx.fps, frame: frameOf(ctx) };

  return emojiAlphaFilters(values.alpha, window);
}

// Every slot's image, or null when the text's position can't be expressed for overlay.
function overlaysFor(values: Values, layout: EmojiTextLayout, fontSize: number, ctx: EmojiContext) {
  const metrics = metricsFor(layout, fontSize, ctx);
  const enable = overlayEnable(values.enable);
  const leg = legFor(values, ctx);
  const overlays: EmojiOverlay[] = [];
  const top = (fontSize * LINE_HEIGHT - layout.size) / 2 - fontSize * LIFT;

  for (const slot of layout.slots) {
    const x = overlayCoordinate(values.x, slot.dx, metrics);
    const y = overlayCoordinate(values.y, slot.line * metrics.line_h + top, metrics);

    if (!x || !y) return null;

    overlays.push(overlayOf(emojiAssetFile(slot.key), layout.size, { x, y }, { enable, leg }));
  }

  return overlays;
}

function overlayOf(
  file: string,
  size: number,
  at: { x: OverlayCoordinate; y: OverlayCoordinate },
  timing: { enable: string; leg: string[] }
): EmojiOverlay {
  const moving = at.x.moving || at.y.moving;

  return { file, size, x: at.x.value, y: at.y.value, moving, enable: timing.enable, leg: timing.leg };
}

function report(layout: EmojiTextLayout, ctx: EmojiContext, text: string): void {
  if (layout.missing.length > 0) {
    ctx.warn(`emoji_missing_asset: no bundled image for ${layout.missing.join(' ')} in "${text}" — stripped`);
  }

  if (layout.capped > 0) {
    ctx.warn(`emoji_overlay_cap: ${layout.capped} emoji past the per-section cap stripped from "${text}"`);
  }

  if (layout.stripped > 0) ctx.warn(`emoji_stripped: ${layout.stripped} emoji removed from "${text}"`);
}

function withText(filter: Filter, text: string): Filter | null {
  return text.trim() === '' ? null : { ...filter, values: { ...filter.values, text } as unknown as Filter['values'] };
}

interface Rewrite {
  filter: Filter | null;
  overlays: EmojiOverlay[];
}

function rewriteDrawtext(filter: Filter, text: string, ctx: EmojiContext): Rewrite {
  const values = filter.values as Values;
  const fontSize = fontSizeOf(values, ctx);
  const base = { font: values.fontfile, fontSize: fontSize ?? DRAWTEXT_DEFAULT_FONT_SIZE, budget: ctx.budget };
  const remaining = ctx.budget.remaining;
  const layout = layoutEmojiText(text, { ...base, strip: ctx.mode === 'strip' || fontSize === null });
  const overlays = fontSize === null ? [] : overlaysFor(values, layout, fontSize, ctx);

  if (overlays === null) {
    // The position reads something overlay can't evaluate: draw the text without its emoji.
    ctx.budget.remaining = remaining;
    ctx.warn(`emoji_unplaceable: emoji in "${text}" stripped (text position can't be measured)`);

    return { filter: withText(filter, layoutEmojiText(text, { ...base, strip: true }).text), overlays: [] };
  }

  report(layout, ctx, text);

  return { filter: withText(filter, layout.text), overlays };
}

function drawnText(filter: Filter, ctx: EmojiContext): string | null {
  const values = filter.values as Values | undefined;

  if (filter.type !== 'drawtext' || values?.text === undefined) return null;

  const text = ctx.resolveText(values.text);

  return text !== null && hasEmoji(text, coverageFor(values.fontfile)) ? text : null;
}

/** Rewrites every drawtext of `filters` that draws emoji; the rest pass through untouched. */
export function extractEmojiOverlays(filters: Filter[], ctx: EmojiContext): EmojiExtraction {
  const extraction: EmojiExtraction = { filters: [], overlays: [], rewritten: new Set() };

  for (const filter of filters) {
    const text = ctx.mode === 'error' ? null : drawnText(filter, ctx);

    if (text === null) {
      extraction.filters.push(filter);
      continue;
    }

    const rewrite = rewriteDrawtext(filter, text, ctx);

    extraction.overlays.push(...rewrite.overlays);

    if (rewrite.filter) {
      extraction.filters.push(rewrite.filter);
      extraction.rewritten.add(rewrite.filter);
    }
  }

  return extraction;
}
