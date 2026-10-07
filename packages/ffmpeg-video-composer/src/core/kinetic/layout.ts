// Kinetic typography layout (docs/plans/motion-system.md §4.1): measure, wrap and place a block of
// text so each word or glyph can be drawn — and animated — on its own. Widths come from the generated
// advance table of the bundled fonts, so layout is synchronous and identical on every platform.

import { EMOJI_SCALE } from '../emoji-assets';
import { hasEmoji, splitEmoji } from '../emoji-clusters';
import { FIRST_CODE_POINT, FONT_ADVANCES, LAST_CODE_POINT, type FontAdvanceTable } from '../font-advances.generated';

export type KineticUnit = 'line' | 'word' | 'glyph';
export type KineticAlign = 'left' | 'center' | 'right';

export interface LayoutPiece {
  text: string;
  /** Left edge of the piece, output px. */
  x: number;
  /** Top of the piece's line box (drawtext y), output px. */
  y: number;
  width: number;
  line: number;
  /** Word index across the whole block (glyphs inherit their word's), for accent lookups. */
  word: number;
}

export interface LayoutInput {
  text: string;
  /** Bundled font file, e.g. "BebasNeue.ttf". */
  font: string;
  size: number;
  unit: KineticUnit;
  align: KineticAlign;
  /** Anchor x: left edge (left), centre (center) or right edge (right) of every line. */
  x: number;
  /** Top of the first line. */
  y: number;
  maxWidth: number;
  lineHeight: number;
}

export interface Layout {
  pieces: LayoutPiece[];
  lines: Array<{ text: string; x: number; y: number; width: number }>;
  height: number;
}

/** The code points of `text`: the unit drawtext advances by (combining sequences are not split further). */
export function codePoints(text: string): string[] {
  const points: string[] = [];

  for (const point of text) points.push(point);

  return points;
}

type AdvanceTable = FontAdvanceTable;

// Decoded advance runs (see font-advances.generated.ts), by encoded string: -1 = no glyph.
const decoded = new Map<string, number[]>();

function decodeRun(encoded: string): number[] {
  let values = decoded.get(encoded);

  if (!values) {
    values = encoded.split(',').map((token) => (token === '' ? -1 : parseInt(token, 36)));
    decoded.set(encoded, values);
  }

  return values;
}

// A code point's advance in font units, -1 when the table has no glyph for it: the Latin range, then
// the font's extra script blocks (Hebrew, Arabic).
export function advanceOf(table: AdvanceTable, cp: number): number {
  if (cp >= FIRST_CODE_POINT && cp <= LAST_CODE_POINT) return decodeRun(table.advances)[cp - FIRST_CODE_POINT];

  for (const block of table.extra ?? []) {
    const values = decodeRun(block.advances);

    if (cp >= block.start && cp < block.start + values.length) return values[cp - block.start];
  }

  return -1;
}

function advanceUnits(table: AdvanceTable, text: string): number | null {
  let units = 0;

  for (const char of text) {
    const advance = advanceOf(table, char.codePointAt(0) ?? 0);

    if (advance < 0) return null;

    units += advance;
  }

  return units;
}

// An emoji cluster is drawn as a colour image EMOJI_SCALE em wide (editor/emoji), not by the font.
function emojiAwareUnits(table: AdvanceTable, text: string): number | null {
  let units = 0;

  for (const segment of splitEmoji(text)) {
    const run = segment.emoji ? EMOJI_SCALE * table.unitsPerEm : advanceUnits(table, segment.text);

    if (run === null) return null;

    units += run;
  }

  return units;
}

/** Width of `text` in px, or null when the font isn't bundled or lacks a glyph (emoji count as images). */
export function measureBundled(font: string, text: string, size: number): number | null {
  const table = FONT_ADVANCES[font] as AdvanceTable | undefined;

  if (!table) return null;

  const units = hasEmoji(text) ? emojiAwareUnits(table, text) : advanceUnits(table, text);

  return units === null ? null : (units / table.unitsPerEm) * size;
}

// The glyph unit's pieces: code points, except that an emoji cluster stays whole (one image).
function glyphUnits(word: string): string[] {
  if (!hasEmoji(word)) return codePoints(word);

  return splitEmoji(word).flatMap((segment) => (segment.emoji ? [segment.text] : codePoints(segment.text)));
}

/** Greedy wrap on spaces; explicit "\n" always breaks. A word wider than maxWidth gets its own line. */
export function wrapLines(text: string, font: string, size: number, maxWidth: number): string[] | null {
  const lines: string[] = [];

  for (const paragraph of text.split('\n')) {
    let current = '';

    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = current ? `${current} ${word}` : word;
      const width = measureBundled(font, candidate, size);

      if (width === null) return null;

      if (width > maxWidth && current) {
        lines.push(current);
        current = word;

        continue;
      }

      current = candidate;
    }

    lines.push(current);
  }

  return lines;
}

function lineX(align: KineticAlign, anchor: number, width: number): number {
  if (align === 'left') return anchor;

  return align === 'center' ? anchor - width / 2 : anchor - width;
}

// Words of one line with their left offsets. Offsets measure the prefix including spaces, so spacing
// matches what drawtext would lay out for the whole line.
function lineWords(line: string, font: string, size: number): Array<{ text: string; offset: number }> {
  const words = line.split(' ');

  return words.map((word, index) => ({
    text: word,
    offset: measureBundled(font, words.slice(0, index).join(' ') + (index > 0 ? ' ' : ''), size) ?? 0,
  }));
}

function glyphPieces(word: string, font: string, size: number): Array<{ text: string; offset: number; width: number }> {
  const glyphs = glyphUnits(word);

  return glyphs.map((glyph, index) => ({
    text: glyph,
    offset: measureBundled(font, glyphs.slice(0, index).join(''), size) ?? 0,
    width: measureBundled(font, glyph, size) ?? 0,
  }));
}

function piecesOfLine(
  input: LayoutInput,
  line: Layout['lines'][number],
  lineIndex: number,
  firstWord: number
): LayoutPiece[] {
  if (input.unit === 'line') {
    return [{ text: line.text, x: line.x, y: line.y, width: line.width, line: lineIndex, word: firstWord }];
  }

  return lineWords(line.text, input.font, input.size).flatMap((word, index) => {
    const wordX = line.x + word.offset;
    const wordIndex = firstWord + index;

    if (input.unit === 'word') {
      const width = measureBundled(input.font, word.text, input.size) ?? 0;

      return [{ text: word.text, x: wordX, y: line.y, width, line: lineIndex, word: wordIndex }];
    }

    return glyphPieces(word.text, input.font, input.size).map((glyph) => ({
      text: glyph.text,
      x: wordX + glyph.offset,
      y: line.y,
      width: glyph.width,
      line: lineIndex,
      word: wordIndex,
    }));
  });
}

/** Lays out the block, or null when it can't be measured (font not bundled, missing glyph). */
export function layoutKinetic(input: LayoutInput): Layout | null {
  const wrapped = wrapLines(input.text, input.font, input.size, input.maxWidth);

  if (!wrapped) return null;

  const lines = wrapped.map((text, index) => {
    const width = measureBundled(input.font, text, input.size) ?? 0;

    return { text, width, x: lineX(input.align, input.x, width), y: input.y + index * input.lineHeight };
  });
  const pieces: LayoutPiece[] = [];
  let word = 0;

  for (const [index, line] of lines.entries()) {
    pieces.push(...piecesOfLine(input, line, index, word));
    word += line.text.split(' ').filter(Boolean).length;
  }

  return { pieces, lines, height: lines.length * input.lineHeight };
}
