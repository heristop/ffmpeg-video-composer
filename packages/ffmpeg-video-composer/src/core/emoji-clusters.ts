// Emoji clusters: the code-point sequences a reader sees as ONE emoji. drawtext advances code point by
// code point and draws monochrome outlines, so a ZWJ family, a flag or a skin-toned thumb comes out as a
// row of boxes. Splitting text into plain runs and whole emoji clusters is what lets the lowering swap
// each cluster for a bundled colour image (editor/emoji) and the validator reason about them.
//
// The grammar is the practical subset of UTS #51 the bundled set needs, applied left to right:
//   flag      = regional-indicator regional-indicator
//   keycap    = [0-9#*] U+FE0F? U+20E3
//   element   = (pictographic | skin-tone) (U+FE0E | U+FE0F)? skin-tone? tag*
//   cluster   = element (U+200D pictographic-element)*
// A lone pictograph with a TEXT default presentation (©, ®, ™, ↔…) and no U+FE0F is plain text unless
// the drawing font lacks it; the caller decides through `covered`.

export interface TextSegment {
  text: string;
  /** True for an emoji cluster, false for a run of plain text. */
  emoji: boolean;
}

/** Whether the drawing font has a glyph for a code point (bundled-font coverage), when known. */
export type GlyphCovered = (codePoint: number) => boolean;

const ZWJ = 0x200d;
const VS15 = 0xfe0e;
const VS16 = 0xfe0f;
const KEYCAP = 0x20e3;
// Text-default pictographs below this (©, ®, ‼, ⁉, ™, ℹ) stay text when no font coverage is known;
// from the arrows block on, a bare pictograph is drawn as an emoji by every platform.
const TEXT_PICTOGRAPH_LIMIT = 0x2190;

const PICTOGRAPHIC = /^\p{Extended_Pictographic}$/u;
const PRESENTATION = /^\p{Emoji_Presentation}$/u;
const KEYCAP_BASE = /^[0-9#*]$/;

function pointAt(chars: string[], index: number): number {
  return chars[index]?.codePointAt(0) ?? -1;
}

/** A Fitzpatrick skin-tone modifier (U+1F3FB..U+1F3FF). */
export function isSkinTone(codePoint: number): boolean {
  return codePoint >= 0x1f3fb && codePoint <= 0x1f3ff;
}

function isRegionalIndicator(codePoint: number): boolean {
  return codePoint >= 0x1f1e6 && codePoint <= 0x1f1ff;
}

function isTag(codePoint: number): boolean {
  return codePoint >= 0xe0020 && codePoint <= 0xe007f;
}

function isElementStart(char: string | undefined): boolean {
  return char !== undefined && (PICTOGRAPHIC.test(char) || isSkinTone(char.codePointAt(0) ?? -1));
}

// One element: the base, an optional presentation selector, an optional skin tone and any tag run.
function elementEnd(chars: string[], start: number): number {
  let end = start + 1;

  if (pointAt(chars, end) === VS15 || pointAt(chars, end) === VS16) end++;

  if (isSkinTone(pointAt(chars, end))) end++;

  while (isTag(pointAt(chars, end))) end++;

  return end;
}

function keycapEnd(chars: string[], start: number): number {
  const selector = pointAt(chars, start + 1) === VS16 ? 1 : 0;

  return pointAt(chars, start + 1 + selector) === KEYCAP ? start + 2 + selector : start;
}

function sequenceEnd(chars: string[], start: number): number {
  let end = elementEnd(chars, start);

  while (pointAt(chars, end) === ZWJ && isElementStart(chars[end + 1])) {
    end = elementEnd(chars, end + 1);
  }

  return end;
}

// Exclusive end of the emoji cluster starting at `start`, or `start` when none starts there.
function clusterEnd(chars: string[], start: number): number {
  const point = pointAt(chars, start);

  if (isRegionalIndicator(point)) return isRegionalIndicator(pointAt(chars, start + 1)) ? start + 2 : start + 1;

  if (KEYCAP_BASE.test(chars[start])) return keycapEnd(chars, start);

  return isElementStart(chars[start]) ? sequenceEnd(chars, start) : start;
}

// A single text-presentation pictograph (no U+FE0F, no modifier) is drawn by the font when it can be.
function drawnAsEmoji(cluster: string[], covered: GlyphCovered | undefined): boolean {
  const base = cluster[0];
  const point = base.codePointAt(0) ?? 0;
  const textDefault = !PRESENTATION.test(base) && !isSkinTone(point);
  const bare = cluster.length === 1 || (cluster.length === 2 && pointAt(cluster, 1) === VS15);

  if (!textDefault || !bare) return true;

  if (pointAt(cluster, 1) === VS15) return false;

  return covered ? !covered(point) : point >= TEXT_PICTOGRAPH_LIMIT;
}

function pushText(segments: TextSegment[], text: string): void {
  const last = segments.at(-1);

  if (last && !last.emoji) {
    last.text += text;

    return;
  }

  segments.push({ text, emoji: false });
}

function toChars(text: string): string[] {
  const chars: string[] = [];

  for (const char of text) chars.push(char);

  return chars;
}

/** Splits `text` into plain runs and whole emoji clusters, in order. Joining the parts gives `text` back. */
export function splitEmoji(text: string, covered?: GlyphCovered): TextSegment[] {
  const chars = toChars(text);
  const segments: TextSegment[] = [];
  let index = 0;

  while (index < chars.length) {
    const end = clusterEnd(chars, index);

    if (end === index) {
      pushText(segments, chars[index]);
      index++;
      continue;
    }

    const cluster = chars.slice(index, end);
    const isEmoji = drawnAsEmoji(cluster, covered);

    if (isEmoji) segments.push({ text: cluster.join(''), emoji: true });

    if (!isEmoji) pushText(segments, cluster.join(''));

    index = end;
  }

  return segments;
}

// Every emoji code point sits above U+00A8, so text made only of lower code points (ASCII, most of
// Latin-1) needs no split at all — the common case for every caption.
function beyondLatin1(text: string): boolean {
  for (const char of text) {
    if ((char.codePointAt(0) ?? 0) > 0xa8) return true;
  }

  return false;
}

/** True when `text` holds at least one emoji cluster. A cheap pre-check skips pure ASCII. */
export function hasEmoji(text: string, covered?: GlyphCovered): boolean {
  if (!beyondLatin1(text)) return false;

  return splitEmoji(text, covered).some((segment) => segment.emoji);
}

/** The emoji clusters of `text`, in order (duplicates kept). */
export function emojiClusters(text: string, covered?: GlyphCovered): string[] {
  return splitEmoji(text, covered)
    .filter((segment) => segment.emoji)
    .map((segment) => segment.text);
}

/** A cluster's code points as lowercase hex joined by '-' (the bundled assets' file naming). */
export function clusterKey(cluster: string): string {
  return toChars(cluster)
    .map((char) => (char.codePointAt(0) ?? 0).toString(16))
    .join('-');
}

export { VS16, ZWJ };
