// Script detection for drawn copy. Two properties matter to the renderer:
// - right-to-left (Hebrew, Arabic, Syriac, Thaana, N'Ko): a line's visual order differs from its
//   logical order, which only libfribidi (drawtext `text_shaping`) reorders;
// - shaping: glyphs join or reorder by context (Arabic letter forms, Indic conjuncts and vowel signs,
//   Thai/Lao/Khmer/Myanmar/Tibetan clusters). Drawing such text one code point at a time breaks every
//   join, so kinetic typography animates it a whole line at a time.
// Pure and table-driven; ranges are inclusive Unicode blocks.

const RTL_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0590, 0x05ff], // Hebrew
  [0x0600, 0x06ff], // Arabic
  [0x0700, 0x074f], // Syriac
  [0x0750, 0x077f], // Arabic Supplement
  [0x0780, 0x07bf], // Thaana
  [0x07c0, 0x07ff], // N'Ko
  [0x0860, 0x08ff], // Syriac Supplement, Arabic Extended-B/A
  [0xfb1d, 0xfb4f], // Hebrew presentation forms
  [0xfb50, 0xfdff], // Arabic Presentation Forms-A
  [0xfe70, 0xfeff], // Arabic Presentation Forms-B
];

// Left-to-right scripts whose glyphs still change shape or order by context.
const SHAPED_LTR_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0900, 0x0dff], // Devanagari, Bengali, Gurmukhi, Gujarati, Oriya, Tamil, Telugu, Kannada, Malayalam, Sinhala
  [0x0e00, 0x0eff], // Thai, Lao
  [0x0f00, 0x0fff], // Tibetan
  [0x1000, 0x109f], // Myanmar
  [0x1780, 0x17ff], // Khmer
  [0xa8e0, 0xa8ff], // Devanagari Extended
];

function inRanges(cp: number, ranges: ReadonlyArray<readonly [number, number]>): boolean {
  return ranges.some(([start, end]) => cp >= start && cp <= end);
}

function some(text: string, test: (cp: number) => boolean): boolean {
  for (const char of text) {
    if (test(char.codePointAt(0) ?? 0)) return true;
  }

  return false;
}

/** True when the text holds right-to-left letters (needs bidi reordering to read correctly). */
export function hasRtl(text: string): boolean {
  return some(text, (cp) => inRanges(cp, RTL_RANGES));
}

/** True when the text holds a script drawn wrong glyph by glyph: any RTL script or a shaped LTR one. */
export function needsShaping(text: string): boolean {
  return some(text, (cp) => inRanges(cp, RTL_RANGES) || inRanges(cp, SHAPED_LTR_RANGES));
}

/** The text of a drawn value as authored: a plain string, or every locale of a translation. */
export function textValues(text: unknown): string[] {
  if (typeof text === 'string') return [text];

  if (text && typeof text === 'object') {
    return Object.values(text).filter((value): value is string => typeof value === 'string');
  }

  return [];
}
