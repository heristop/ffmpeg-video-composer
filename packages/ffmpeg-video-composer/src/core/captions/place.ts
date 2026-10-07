// Caption geometry: a fitted cue's lines centred in the caption area and stacked from their anchor,
// every word at its measured x on its line's shared baseline (the kinetic layout's approach: drawtext
// places a string by its own glyph box, so a baseline shared through `max_glyph_a` keeps words of
// different heights from jittering). Pure.

import type { WordTiming } from './grouping';
import type { CaptionArea, CaptionFrame, SubtitleStyle } from './style';
import { measureText } from './wrap';

/** Baseline below the line top, as a fraction of the font size (same as kinetic's BASELINE). */
export const CAPTION_BASELINE = 0.8;

export interface PlacedWord extends WordTiming {
  /** Left edge, output px. */
  x: number;
  width: number;
}

export interface PlacedLine {
  words: PlacedWord[];
  text: string;
  x: number;
  width: number;
  /** Top of the line box. */
  top: number;
  /** Shared baseline of every word on the line. */
  baseline: number;
}

export interface PlacedCue {
  /** Index of the cue in the track's own order. */
  source: number;
  start: number;
  end: number;
  size: number;
  crowned: boolean;
  lines: PlacedLine[];
}

interface FittedCue {
  source: number;
  start: number;
  end: number;
  size: number;
  crowned: boolean;
  lines: WordTiming[][];
}

function blockTop(style: SubtitleStyle, area: CaptionArea, frame: CaptionFrame, height: number): number {
  if (style.position === 'top') return area.top;

  if (style.position === 'center') return (frame.height - height) / 2;

  return frame.height - area.bottom - height;
}

function placeLine(words: readonly WordTiming[], font: string, size: number, center: number, top: number): PlacedLine {
  const text = words.map((word) => word.text).join(' ');
  const width = measureText(font, text, size) ?? 0;
  const x = center - width / 2;
  const placed = words.map((word, index) => {
    const prefix = words
      .slice(0, index)
      .map((w) => `${w.text} `)
      .join('');

    return {
      ...word,
      x: x + (index > 0 ? (measureText(font, prefix, size) ?? 0) : 0),
      width: measureText(font, word.text, size) ?? 0,
    };
  });

  return { words: placed, text, x, width, top, baseline: top + size * CAPTION_BASELINE };
}

export function placeCue(cue: FittedCue, style: SubtitleStyle, area: CaptionArea, frame: CaptionFrame): PlacedCue {
  const lineHeight = cue.size * style.lineHeight;
  const top = blockTop(style, area, frame, cue.lines.length * lineHeight);
  const center = (area.left + frame.width - area.right) / 2;
  // Each line box is lineHeight tall; the glyphs sit centred in it.
  const inset = (lineHeight - cue.size) / 2;

  return {
    source: cue.source,
    start: cue.start,
    end: cue.end,
    size: cue.size,
    crowned: cue.crowned,
    lines: cue.lines.map((words, i) => placeLine(words, style.font, cue.size, center, top + i * lineHeight + inset)),
  };
}
