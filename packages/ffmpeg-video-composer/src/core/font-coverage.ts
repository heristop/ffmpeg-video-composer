// Which characters a bundled font can draw. drawtext exits 0 and draws an empty box (or nothing) for a
// code point its font has no glyph for, so this is the only place the gap can be caught before a render.
import { FONTS, type FontEntry } from './fonts';
import { FONT_COVERAGE } from './font-coverage.generated';

/**
 * Inclusive [start, end] code-point pairs (flattened, ascending) as a compact string: per range, the gap
 * since the previous range and its length minus one, in base 36, comma-separated. Well under half the
 * size of the plain number list, which matters because the table ships in the browser bundle.
 */
export function encodeRanges(ranges: number[]): string {
  const parts: string[] = [];
  let previousEnd = -1;

  for (let i = 0; i < ranges.length; i += 2) {
    parts.push((ranges[i] - previousEnd - 1).toString(36), (ranges[i + 1] - ranges[i]).toString(36));
    previousEnd = ranges[i + 1];
  }

  return parts.join(',');
}

export function decodeRanges(encoded: string): number[] {
  const tokens = encoded === '' ? [] : encoded.split(',').map((token) => Number.parseInt(token, 36));
  const ranges: number[] = [];
  let previousEnd = -1;

  for (let i = 0; i < tokens.length; i += 2) {
    const start = previousEnd + 1 + tokens[i];

    previousEnd = start + tokens[i + 1];
    ranges.push(start, previousEnd);
  }

  return ranges;
}

const decoded = new Map<string, number[]>();

function rangesOf(file: string): number[] {
  const cached = decoded.get(file);

  if (cached) return cached;

  const ranges = decodeRanges(FONT_COVERAGE[file] ?? '');

  decoded.set(file, ranges);

  return ranges;
}

/** Whether `file` is a bundled font whose coverage is known. */
export function isCoverageKnown(file: string): boolean {
  return Object.hasOwn(FONT_COVERAGE, file);
}

/** Whether the bundled font `file` has a glyph for `codePoint` (binary search over its ranges). */
export function fontCovers(file: string, codePoint: number): boolean {
  const ranges = rangesOf(file);
  let low = 0;
  let high = ranges.length / 2 - 1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const start = ranges[mid * 2];
    const end = ranges[mid * 2 + 1];

    if (codePoint >= start && codePoint <= end) return true;

    if (codePoint < start) high = mid - 1;

    if (codePoint > end) low = mid + 1;
  }

  return false;
}

/** A coverage predicate for a bundled font (`font` as a drawtext fontfile), or undefined when unknown. */
export function coverageFor(font: unknown): ((codePoint: number) => boolean) | undefined {
  return typeof font === 'string' && isCoverageKnown(font) ? (codePoint) => fontCovers(font, codePoint) : undefined;
}

/** The bundled fonts that have a glyph for every one of `chars`. */
export function fontsCovering(chars: string[]): FontEntry[] {
  return FONTS.filter((font) => chars.every((char) => fontCovers(font.file, char.codePointAt(0) as number)));
}

// Variation selectors pick a presentation; they are never drawn on their own.
function isVariationSelector(codePoint: number): boolean {
  return (codePoint >= 0xfe00 && codePoint <= 0xfe0f) || (codePoint >= 0xe0100 && codePoint <= 0xe01ef);
}

/** Characters that draw nothing themselves: whitespace, controls, format characters (ZWJ…), selectors. */
export function isInvisible(char: string): boolean {
  return /^[\p{White_Space}\p{Cc}\p{Cf}]$/u.test(char) || isVariationSelector(char.codePointAt(0) as number);
}

const COMBINING_KEYCAP = 0x20e3;

/**
 * Pictographic emoji and their building blocks (skin tones, flags, the keycap mark), one code point at
 * a time. Whole emoji clusters (ZWJ sequences, flags, keycaps, skin tones) come from core/emoji-clusters.
 */
export function isEmoji(char: string): boolean {
  return (
    /^[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}]$/u.test(char) ||
    char.codePointAt(0) === COMBINING_KEYCAP
  );
}
