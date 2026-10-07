// Lays a drawn string out around its emoji: every emoji cluster leaves the text and is replaced by a
// gap of no-break spaces about one emoji wide, and the cluster's offset inside its line is recorded so
// the colour image can be composited into that gap. Widths come from the bundled advance table (the
// same one kinetic layout uses), so the result is synchronous and identical on every platform; a font
// outside the table is estimated at 0.5em per glyph.
import { FONT_ADVANCES } from '@/core/font-advances.generated';
import { advanceOf } from '@/core/kinetic/layout';
import { coverageFor, isInvisible } from '@/core/font-coverage';
import { splitEmoji, type GlyphCovered } from '@/core/emoji-clusters';
import { EMOJI_SCALE, emojiAssetKey } from '@/core/emoji-assets';

// U+00A0 rather than a plain space: FFmpeg's option parser trims leading/trailing whitespace from the
// text value, which would close a gap at either end of a line and shift every image after it. Every
// bundled font draws NBSP exactly as wide as a space.
export const GAP_CHAR = ' ';

export { coverageFor };

const ASSUMED_ADVANCE_EM = 0.5;
const LINE_BREAK = /([\n\r\f\v])/;

/** One image to composite: its bundled key, left edge inside the line, and which line. */
export interface EmojiSlot {
  key: string;
  dx: number;
  line: number;
}

export interface EmojiTextLayout {
  /** The string drawtext draws instead: emoji replaced by gaps (or removed when stripped). */
  text: string;
  slots: EmojiSlot[];
  /** Clusters with no bundled image (stripped). */
  missing: string[];
  /** Clusters stripped because the section's overlay budget ran out. */
  capped: number;
  /** Clusters removed by `global.emoji: "strip"`. */
  stripped: number;
  /** Width of each line of `text`, px. */
  lineWidths: number[];
  /** Drawn emoji size, px. */
  size: number;
}

export interface EmojiTextOptions {
  font: unknown;
  fontSize: number;
  /** Remove every emoji instead of leaving a gap (`global.emoji: "strip"`). */
  strip: boolean;
  /** Overlays the section may still composite; decremented per placed image. */
  budget: { remaining: number };
}

function bundledFont(font: unknown): string | null {
  return typeof font === 'string' && Object.hasOwn(FONT_ADVANCES, font) ? font : null;
}

function advancePx(font: string | null, char: string, size: number): number {
  if (isInvisible(char) && char !== ' ' && char !== GAP_CHAR) return 0;

  const point = char.codePointAt(0) ?? 0;
  const table = font === null ? undefined : FONT_ADVANCES[font];
  const advance = table ? advanceOf(table, point) : -1;

  return advance >= 0 && table ? (advance / table.unitsPerEm) * size : ASSUMED_ADVANCE_EM * size;
}

function runWidth(font: string | null, text: string, size: number): number {
  let width = 0;

  for (const char of text) width += advancePx(font, char, size);

  return width;
}

interface LineState {
  text: string;
  x: number;
}

// Places one emoji cluster: a gap and a slot when it has an image and budget remains, nothing otherwise.
function placeCluster(cluster: string, line: number, state: LineState, layout: EmojiTextLayout, ctx: LineContext) {
  if (ctx.options.strip) {
    layout.stripped++;

    return;
  }

  const key = emojiAssetKey(cluster);

  if (key === null) {
    layout.missing.push(cluster);

    return;
  }

  if (ctx.options.budget.remaining <= 0) {
    layout.capped++;

    return;
  }

  const gapAdvance = advancePx(ctx.font, GAP_CHAR, ctx.options.fontSize);
  const count = Math.max(1, Math.round(layout.size / gapAdvance));
  const gap = count * gapAdvance;

  ctx.options.budget.remaining--;
  layout.slots.push({ key, dx: state.x + (gap - layout.size) / 2, line });
  state.text += GAP_CHAR.repeat(count);
  state.x += gap;
}

interface LineContext {
  font: string | null;
  options: EmojiTextOptions;
  covered: GlyphCovered | undefined;
}

function layoutLine(line: string, index: number, layout: EmojiTextLayout, ctx: LineContext): string {
  const state: LineState = { text: '', x: 0 };

  for (const segment of splitEmoji(line, ctx.covered)) {
    if (segment.emoji) {
      placeCluster(segment.text, index, state, layout, ctx);
      continue;
    }

    state.text += segment.text;
    state.x += runWidth(ctx.font, segment.text, ctx.options.fontSize);
  }

  layout.lineWidths.push(state.x);

  return state.text;
}

/** Replaces every emoji cluster of `text` with a measured gap (or nothing) and records where it goes. */
export function layoutEmojiText(text: string, options: EmojiTextOptions): EmojiTextLayout {
  const layout: EmojiTextLayout = {
    text: '',
    slots: [],
    missing: [],
    capped: 0,
    stripped: 0,
    lineWidths: [],
    size: Math.round(options.fontSize * EMOJI_SCALE),
  };
  const ctx: LineContext = { font: bundledFont(options.font), options, covered: coverageFor(options.font) };
  const parts = text.split(LINE_BREAK);
  let line = 0;

  // `split` with a capture group alternates line, separator, line…: odd indices are the separators.
  layout.text = parts.map((part, index) => (index % 2 === 1 ? part : layoutLine(part, line++, layout, ctx))).join('');

  return layout;
}
