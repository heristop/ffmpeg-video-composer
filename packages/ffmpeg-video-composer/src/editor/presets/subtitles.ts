// Subtitles → drawtext / drawbox filters. The plan (core/captions/plan.ts) decides what is on screen
// and where; this writes it: per cue an optional plate per line, then the words.
//
// Karaoke modes, per word of a cue shown in [start, end):
// - false: each line drawn once in the base colour.
// - word: every word in the base colour, except while it is spoken, when it is drawn in the active colour
//   (and the DNA's active scale) instead.
// - fill: a word is base-coloured until it is spoken, then active-coloured until the cue leaves.
// - pop: like word, and the spoken word's size bumps up and settles back on an eased curve.
// The crown cue is drawn larger in the crown colour without karaoke: the one line that should land.

import type { Filter } from '@/core/types';
import { easedProgressExpr, fmt } from '@/core/motion/hermite';
import { parseEasing } from '@/core/motion/easing';
import type { Subtitles } from '../../schemas/subtitles.schemas';
import { planSubtitles, type PlacedCue, type PlacedLine, type PlacedWord } from '@/core/captions/plan';
import type { SubtitleStyle } from '@/core/captions/style';
import {
  baselineY,
  paintedEffect,
  painter,
  plateFilters,
  textFilter,
  windowExpr,
  type CueLook,
  type Paint,
} from './subtitle-draw';
import type { SugarContext } from './sugar-context';

/** A silence shorter than this keeps the previous word active, so the highlight doesn't flicker. */
const ACTIVE_BRIDGE = 0.25;
const POP_SECONDS = 0.24;
const POP_PEAK = 1.2;
const POP_EASE = parseEasing('ease-out-cubic');

interface Palette {
  base: string;
  active: string;
  crown: string;
  plate: string | undefined;
}

type ActiveSpan = { from: number; to: number };

interface CueDraw {
  cue: PlacedCue;
  style: SubtitleStyle;
  look: CueLook;
  palette: Palette;
}

// When the word is the active one: from its start to its end (or on to the next word across a short
// silence), inside the cue.
function activeWindow(cue: PlacedCue, words: readonly PlacedWord[], index: number): ActiveSpan {
  const word = words[index];
  const next = words.at(index + 1);
  const bridged = next && next.start - word.end < ACTIVE_BRIDGE ? next.start : word.end;

  return { from: Math.max(cue.start, word.start), to: Math.min(cue.end, Math.max(bridged, word.start + 0.04)) };
}

function staticLine(draw: CueDraw, line: PlacedLine, color: string): Filter {
  return textFilter(
    {
      text: line.text,
      font: draw.style.font,
      size: draw.cue.size,
      color,
      x: fmt(line.x),
      y: baselineY(line.baseline),
      enable: windowExpr(draw.cue.start, draw.cue.end),
    },
    draw.look
  );
}

function wordText(draw: CueDraw, word: PlacedWord, line: PlacedLine, color: string, enable: string): Filter {
  const draws = { text: word.text, font: draw.style.font, size: draw.cue.size, color, enable };

  return textFilter({ ...draws, x: fmt(word.x), y: baselineY(line.baseline) }, draw.look);
}

// The spoken word, scaled around its own centre on the shared baseline.
function activeText(draw: CueDraw, word: PlacedWord, line: PlacedLine, window: ActiveSpan): Filter {
  const { size } = draw.cue;
  const mode = draw.style.karaoke;
  // pop always bumps: a DNA whose active word keeps its size pops to POP_PEAK.
  const scale = draw.style.dna.activeScale;
  const peak = mode === 'pop' && scale === 1 ? POP_PEAK : scale;
  const enable = windowExpr(window.from, window.to);

  if (peak === 1) return wordText(draw, word, line, draw.palette.active, enable);

  let fontsize: number | string = Math.round(size * peak);

  if (mode === 'pop') {
    const progress = easedProgressExpr(POP_EASE, { delay: window.from, duration: POP_SECONDS });
    fontsize = `'${fmt(size)}*(1+${fmt(peak - 1)}*sin(3.14159265*(${progress})))'`;
  }

  return textFilter(
    {
      text: word.text,
      font: draw.style.font,
      size: fontsize,
      color: draw.palette.active,
      x: `'${fmt(word.x + word.width / 2)}-text_w/2'`,
      y: baselineY(line.baseline),
      enable,
    },
    draw.look
  );
}

function karaokeWord(draw: CueDraw, word: PlacedWord, line: PlacedLine, window: ActiveSpan): Filter[] {
  const { cue, palette } = draw;

  if (draw.style.karaoke === 'fill') {
    const active = wordText(draw, word, line, palette.active, windowExpr(window.from, cue.end));

    if (window.from <= cue.start) return [active];

    return [wordText(draw, word, line, palette.base, windowExpr(cue.start, window.from)), active];
  }

  const base = wordText(draw, word, line, palette.base, windowExpr(cue.start, cue.end, window));

  return window.to > window.from ? [base, activeText(draw, word, line, window)] : [base];
}

// The words of one cue. Active windows are computed across lines, so the highlight bridges a line break.
function cueText(draw: CueDraw): Filter[] {
  const { cue, style } = draw;

  if (cue.crowned) return cue.lines.map((line) => staticLine(draw, line, draw.palette.crown));

  if (style.karaoke === false) return cue.lines.map((line) => staticLine(draw, line, draw.palette.base));

  const placed = cue.lines.flatMap((line) => line.words.map((word) => ({ word, line })));
  const words = placed.map((entry) => entry.word);

  return placed.flatMap(({ word, line }, index) => karaokeWord(draw, word, line, activeWindow(cue, words, index)));
}

function cueFilters(draw: CueDraw): Filter[] {
  const { cue, style, palette } = draw;
  const box = style.dna.box;
  const plates =
    box && palette.plate
      ? cue.lines.flatMap((line) =>
          plateFilters(line, cue.size, box, palette.plate as string, windowExpr(cue.start, cue.end))
        )
      : [];

  return [...plates, ...cueText(draw)];
}

function palette(subtitles: Subtitles, style: SubtitleStyle, paint: Paint): Palette {
  const { dna } = style;

  return {
    base: paint(subtitles.color ?? dna.color),
    active: paint(subtitles.activeColor ?? dna.activeColor),
    crown: paint(dna.crown.color),
    plate: dna.box ? paint(dna.box.color) : undefined,
  };
}

/** The filters for a section's subtitle track; empty without a track, a motion context or a bundled font. */
export function subtitlesToFilters(subtitles: Subtitles | undefined, ctx: SugarContext): Filter[] {
  if (!subtitles || !ctx.motion) return [];

  const [width, height] = ctx.scale.split(':').map(Number);
  const plan = planSubtitles(subtitles, {
    frame: { width, height },
    platform: ctx.platform,
    resolveText: ctx.motion.resolveText,
    sectionCase: (text) => ctx.motion?.resolveText({ text }) ?? text,
  });

  if (!plan) return [];

  const paint = painter(ctx.theme);
  const colors = palette(subtitles, plan.style, paint);
  const effect = paintedEffect(plan.style.dna.effect, paint);

  return plan.cues.flatMap((cue) =>
    cueFilters({ cue, style: plan.style, palette: colors, look: { dna: plan.style.dna, effect, start: cue.start } })
  );
}
