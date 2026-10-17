// A subtitle plan sampled on the output frame grid into the distinct looks the HTML caption renderer
// rasterises: per frame, which cue shows, which word is spoken (word / pop), how many are lit (fill),
// how far a pop has bumped and how far the cue's entrance has played. Runs of identical frames merge
// into slides, so a caption costs one raster per distinct look, not per frame.
//
// Continuous motion is quantised to keep the raster count bounded: an entrance to ENTRANCE_LEVELS
// steps of its eased progress, a pop to POP_LEVELS steps of its bump. A frame whose entrance has not
// made anything visible yet is left blank. Times follow drawtext's `enable` gates: a state starts on
// the first frame whose time reaches it. Pure.

import { parseEasing } from '../motion/easing';
import { activeWindow, POP_EASE, POP_SECONDS, type ActiveSpan } from './karaoke';
import type { PlacedCue, SubtitlePlan } from './plan';

/** Steps an entrance is sampled into (the settled cue is the last). */
export const ENTRANCE_LEVELS = 4;
/** Steps a pop's bump is sampled into (the peak is the last). */
export const POP_LEVELS = 2;

export interface CaptionState {
  /** Index of the cue in the plan. */
  cue: number;
  /** The spoken word (word / pop karaoke), counted across the cue's lines; -1 when none. */
  active: number;
  /** Words lit so far (fill karaoke). */
  filled: number;
  /** Pop bump, 0..POP_LEVELS. */
  bump: number;
  /** Entrance progress, ENTRANCE_LEVELS when settled (above it while a spring overshoots). */
  reveal: number;
}

export interface CaptionSlide {
  /** First frame (inclusive). */
  from: number;
  /** Last frame (exclusive). */
  to: number;
  state: CaptionState;
}

type Plan = Pick<SubtitlePlan, 'cues' | 'style'>;

/** The pop bump at `elapsed` seconds into the word's active window: 0 → 1 (peak) → 0, eased like drawtext's. */
function popBump(elapsed: number): number {
  if (elapsed < 0 || elapsed >= POP_SECONDS) return 0;

  return Math.sin(Math.PI * POP_EASE.fn(elapsed / POP_SECONDS));
}

/** The first frame whose time reaches `seconds`. */
export function frameAt(seconds: number, fps: number): number {
  return Math.ceil(seconds * fps - 1e-9);
}

function windows(cue: PlacedCue): ActiveSpan[] {
  const words = cue.lines.flatMap((line) => line.words);

  return words.map((_, index) => activeWindow(cue, words, index));
}

interface CueTiming {
  cue: PlacedCue;
  index: number;
  spans: ActiveSpan[];
}

function karaokeState(plan: Plan, timing: CueTiming, t: number): Pick<CaptionState, 'active' | 'filled' | 'bump'> {
  const mode = plan.style.karaoke;

  if (timing.cue.crowned || mode === false) return { active: -1, filled: 0, bump: 0 };

  if (mode === 'fill') return { active: -1, filled: timing.spans.filter((span) => span.from <= t).length, bump: 0 };

  const active = timing.spans.findIndex((span) => span.from <= t && t < span.to);

  if (mode !== 'pop' || active === -1) return { active, filled: 0, bump: 0 };

  return { active, filled: 0, bump: Math.round(popBump(t - timing.spans[active].from) * POP_LEVELS) };
}

function revealLevel(plan: Plan, cue: PlacedCue, t: number): number {
  const { entrance } = plan.style.dna;

  if (entrance.type === 'none' || entrance.duration <= 0) return ENTRANCE_LEVELS;

  const progress = Math.min(1, Math.max(0, (t - cue.start) / entrance.duration));

  return Math.round(parseEasing(entrance.easing).fn(progress) * ENTRANCE_LEVELS);
}

/** A state's identity: two states with the same key draw the same raster. */
export function stateKey(state: CaptionState): string {
  return `${state.cue}:${state.active}:${state.filled}:${state.bump}:${state.reveal}`;
}

function sameState(a: CaptionState, b: CaptionState): boolean {
  return (
    a.cue === b.cue && a.active === b.active && a.filled === b.filled && a.bump === b.bump && a.reveal === b.reveal
  );
}

/** The frames of every cue as slides of one look each, in frame order; frames without a caption are absent. */
export function captionSlides(plan: Plan, fps: number): CaptionSlide[] {
  const frames = new Map<number, CaptionState>();

  for (const [index, cue] of plan.cues.entries()) {
    const timing: CueTiming = { cue, index, spans: windows(cue) };

    // A later cue wins a frame both claim, as its filters are drawn last.
    for (let frame = frameAt(cue.start, fps); frame < frameAt(cue.end, fps); frame++) {
      const t = frame / fps;
      const reveal = revealLevel(plan, cue, t);

      frames.delete(frame);

      if (reveal > 0) frames.set(frame, { cue: index, ...karaokeState(plan, timing, t), reveal });
    }
  }

  const slides: CaptionSlide[] = [];

  for (const frame of [...frames.keys()].sort((a, b) => a - b)) {
    const state = frames.get(frame) as CaptionState;
    const last = slides.at(-1);

    if (last?.to === frame && sameState(last.state, state)) {
      last.to = frame + 1;

      continue;
    }

    slides.push({ from: frame, to: frame + 1, state });
  }

  return slides;
}
