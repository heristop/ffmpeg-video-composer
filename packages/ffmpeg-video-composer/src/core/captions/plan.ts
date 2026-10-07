// The subtitle plan: every cue fitted, split, crowned, held and placed, before any filter is written.
// Shared by the lowering (editor/presets/subtitles.ts) and the advisory pass, so `caption_split` /
// `caption_shrunk` describe exactly what renders.
//
// Per cue: shrink the font until the words fit `maxLines` balanced lines (down to `minSize`); a cue
// that still overflows is split into consecutive cues of at most `maxLines` lines, timed by its word
// windows (spoken or shared by character count). The crown cue is refitted larger. Short cues are
// then held to `minDuration` without running into the next one.

import type { Subtitles } from '../../schemas/subtitles.schemas';
import type { WordTiming } from './grouping';
import { holdCues, timedCues } from './cues';
import { fitCaption } from './wrap';
import { placeCue, type PlacedCue } from './place';
import { captionArea, cased, subtitleStyle, type CaptionArea, type CaptionFrame, type SubtitleStyle } from './style';

export type { PlacedCue, PlacedLine, PlacedWord } from './place';

export interface CaptionAdvisory {
  code: 'caption_split' | 'caption_shrunk';
  /** Index of the cue in the track's own order (after grouping / parsing). */
  cue: number;
  message: string;
}

export interface SubtitlePlan {
  style: SubtitleStyle;
  area: CaptionArea;
  cues: PlacedCue[];
  advisories: CaptionAdvisory[];
}

export interface PlanContext {
  frame: CaptionFrame;
  platform?: string;
  resolveText: (text: Record<string, string | undefined>) => string;
  /** The section's own case (options.upperCase / lowerCase), applied to every drawn word. */
  sectionCase?: (text: string) => string;
}

interface Chunk {
  source: number;
  start: number;
  end: number;
  size: number;
  lines: WordTiming[][];
  crowned: boolean;
}

interface Fitter {
  style: SubtitleStyle;
  maxWidth: number;
}

// Lines of strings back onto the timed words they came from.
function regroup(words: readonly WordTiming[], lines: readonly string[][]): WordTiming[][] {
  let cursor = 0;

  return lines.map((line) => {
    const slice = words.slice(cursor, cursor + line.length);
    cursor += line.length;

    return slice;
  });
}

function fitWords(fitter: Fitter, words: readonly WordTiming[], size: number, minSize: number) {
  const fit = fitCaption({
    words: words.map((word) => word.text),
    font: fitter.style.font,
    size,
    minSize,
    maxWidth: fitter.maxWidth,
    maxLines: fitter.style.maxLines,
    mode: 'balanced',
  });

  return fit && { ...fit, lines: regroup(words, fit.lines) };
}

// One timed cue → one chunk, or several when it overflows maxLines at minSize.
function chunksOf(fitter: Fitter, cue: { start: number; end: number; words: WordTiming[] }, source: number) {
  const { size, minSize, maxLines } = fitter.style;
  const fit = fitWords(fitter, cue.words, size, minSize);

  if (!fit) return null;

  if (!fit.overflow) return [{ source, start: cue.start, end: cue.end, size: fit.size, lines: fit.lines }];

  const groups: WordTiming[][] = [];

  for (let i = 0; i < fit.lines.length; i += maxLines) groups.push(fit.lines.slice(i, i + maxLines).flat());

  return groups.map((words, i) => {
    // Every part of a split cue keeps the floor size, so consecutive parts read as one caption.
    const refit = fitWords(fitter, words, fit.size, minSize) ?? fit;
    const next = groups.at(i + 1);

    return {
      source,
      start: i === 0 ? cue.start : words[0].start,
      end: next === undefined ? cue.end : next[0].start,
      size: refit.size,
      lines: refit.lines,
    };
  });
}

function crownIndex(chunks: readonly Chunk[], crown: string | undefined): number {
  if (crown === undefined) return -1;

  const texts = chunks.map((chunk) =>
    chunk.lines
      .flat()
      .map((word) => word.text.toLowerCase())
      .join(' ')
  );

  if (crown === 'auto') {
    const exclaimed = texts.findLastIndex((text) => /!["”’)]*$/.test(text));

    return exclaimed >= 0 ? exclaimed : chunks.length - 1;
  }

  return texts.findIndex((text) => text.includes(crown.toLowerCase()));
}

function crowned(fitter: Fitter, chunk: Chunk): Chunk {
  const { crown } = fitter.style.dna;
  const words = chunk.lines.flat().map((word) => ({ ...word, text: cased(word.text, crown.case) }));
  const fit = fitWords(fitter, words, Math.round(chunk.size * crown.scale), chunk.size);

  return fit ? { ...chunk, size: fit.size, lines: fit.lines, crowned: true } : { ...chunk, crowned: true };
}

function advisories(chunks: readonly Chunk[], style: SubtitleStyle): CaptionAdvisory[] {
  const out: CaptionAdvisory[] = [];
  const counts = Map.groupBy(chunks, (chunk) => chunk.source);

  for (const [source, parts] of counts) {
    const smallest = Math.min(...parts.map((part) => part.size));

    if (parts.length > 1) {
      const message = `cue ${source} does not fit ${style.maxLines} line(s) at ${style.minSize}px: split into ${parts.length} cues`;
      out.push({ code: 'caption_split', cue: source, message });
    }

    if (smallest < style.size && !parts.some((part) => part.crowned)) {
      out.push({ code: 'caption_shrunk', cue: source, message: `cue ${source} shrunk to ${smallest}px` });
    }
  }

  return out;
}

/** The placed cues of a subtitle track, or null when its font is not bundled (no layout possible). */
export function planSubtitles(subtitles: Subtitles, ctx: PlanContext): SubtitlePlan | null {
  const style = subtitleStyle(subtitles, ctx.frame);
  const area = captionArea(ctx.frame, style.position, ctx.platform);
  const padding = (style.dna.box?.padding ?? 0) * style.size;
  const fitter: Fitter = { style, maxWidth: ctx.frame.width - area.left - area.right - 2 * padding };
  const timed = timedCues(subtitles, ctx.resolveText).map((cue) => ({
    ...cue,
    words: cue.words.map((word) => ({ ...word, text: cased(ctx.sectionCase?.(word.text) ?? word.text, style.case) })),
  }));
  const chunks: Chunk[] = [];

  for (const [index, cue] of timed.entries()) {
    const parts = chunksOf(fitter, cue, index);

    if (!parts) return null;

    chunks.push(...parts.map((part) => ({ ...part, crowned: false })));
  }

  const crown = crownIndex(chunks, subtitles.crown);

  if (crown >= 0) chunks[crown] = crowned(fitter, chunks[crown]);

  const held = holdCues(chunks, style.minDuration);

  return {
    style,
    area,
    cues: held.map((chunk) => placeCue(chunk, style, area, ctx.frame)),
    advisories: advisories(chunks, style),
  };
}
