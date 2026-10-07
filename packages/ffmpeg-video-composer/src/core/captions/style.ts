// A subtitle track's resolved typography and the area it may occupy: the DNA defaults with the track's
// overrides, sizes derived from the frame, and the platform safe zones (global.platform) turned into
// pixel margins. Pure.

import type { Subtitles } from '../../schemas/subtitles.schemas';
import { findFont } from '../fonts';
import { resolvePlatform } from '../platforms';
import { captionDna, type CaptionCase, type CaptionDna, type CaptionKaraoke, type CaptionPosition } from './dna';

export interface CaptionFrame {
  width: number;
  height: number;
}

export interface SubtitleStyle {
  dna: CaptionDna;
  /** Font file, e.g. "Rubik.ttf". */
  font: string;
  size: number;
  minSize: number;
  maxLines: number;
  /** Line spacing as a multiple of the size. */
  lineHeight: number;
  karaoke: CaptionKaraoke;
  position: CaptionPosition;
  case: CaptionCase;
  minDuration: number;
}

const DEFAULT_MAX_LINES = 2;
const DEFAULT_MIN_DURATION = 1;
const MIN_SIZE_RATIO = 0.75;

/** The font file a subtitle track draws with: a bundled id, else the value as given. */
export function subtitleFontFile(font: string): string {
  return findFont(font)?.file ?? font;
}

export function subtitleStyle(subtitles: Subtitles, frame: CaptionFrame): SubtitleStyle {
  const dna = captionDna(subtitles.style);
  const size = subtitles.size ?? Math.round(Math.min(frame.width, frame.height) * dna.size);

  return {
    dna,
    font: subtitleFontFile(subtitles.font ?? dna.font),
    size,
    minSize: Math.min(size, subtitles.minSize ?? Math.round(size * MIN_SIZE_RATIO)),
    maxLines: subtitles.maxLines ?? DEFAULT_MAX_LINES,
    lineHeight: dna.lineHeight,
    karaoke: subtitles.karaoke ?? dna.karaoke,
    position: subtitles.position ?? dna.position,
    case: dna.case,
    minDuration: subtitles.minDuration ?? DEFAULT_MIN_DURATION,
  };
}

/** Pixel margins a caption keeps from each edge. */
export interface CaptionArea {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

// Without a platform: a 6% side margin, anchors as fractions of the height (so portrait and landscape
// read alike). With one: at least the platform's safe zone, plus a little clearance.
const SIDE_MARGIN = 0.06;
const ANCHOR_OFFSET: Record<CaptionPosition, number> = { top: 0.08, center: 0, bottom: 0.07, 'lower-third': 0.16 };
const CLEARANCE = 0.015;

export function captionArea(frame: CaptionFrame, position: CaptionPosition, platform?: string): CaptionArea {
  const safe = resolvePlatform(platform)?.safe;
  // Object.hasOwn: an unvalidated position such as "toString" must not read an inherited member.
  const ratio = Object.hasOwn(ANCHOR_OFFSET, position) ? ANCHOR_OFFSET[position] : ANCHOR_OFFSET['lower-third'];
  const anchor = ratio * frame.height;

  function vertical(edge: number | undefined): number {
    return edge === undefined ? anchor : Math.max(anchor, (edge + CLEARANCE) * frame.height);
  }

  return {
    left: (safe?.left ?? SIDE_MARGIN) * frame.width,
    right: (safe?.right ?? SIDE_MARGIN) * frame.width,
    top: vertical(safe?.top),
    bottom: vertical(safe?.bottom),
  };
}

/** Upper-cases the copy when the case asks for it. */
export function cased(text: string, letterCase: CaptionCase | undefined): string {
  return letterCase === 'upper' ? text.toUpperCase() : text;
}
