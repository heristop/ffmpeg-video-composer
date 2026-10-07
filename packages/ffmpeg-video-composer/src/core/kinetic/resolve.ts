// Turns an authored kinetic block into fully resolved settings: preset defaults, energy-scaled travel,
// physics-derived durations, frame-relative placement and per-unit timing windows. Pure.

import type { KineticBlock, KineticExit } from '../../schemas/kinetic.schemas';
import { isLegacyEasing, parseEasing, type EasingSpec } from '../motion/easing';
import { seededRandom } from '../determinism/hash';
import { findFont } from '../fonts';
import { seconds } from '../timing/seconds';
import { needsShaping } from '../text-scripts';
import { KINETIC_PRESET_DEFAULTS } from './presets';
import { COPY_COUNTER_SECONDS } from './counter-copy';
import type { KineticAlign, KineticUnit, LayoutPiece } from './layout';

export interface KineticFrame {
  width: number;
  height: number;
  fps: number;
  /** Section length in seconds (exit timing). */
  duration: number;
  /** Derived per-block seed (random order, scramble). */
  seed: number;
  energy: number;
}

export interface ResolvedExit {
  preset: string;
  at: number;
  duration: number;
  stagger: number;
  ease: EasingSpec;
  distance: number;
}

export interface ResolvedKinetic {
  preset: string;
  unit: KineticUnit;
  font: string;
  size: number;
  color: string;
  align: KineticAlign;
  x: number;
  maxWidth: number;
  lineHeight: number;
  /** Line breaking: greedy (default) or balanced. */
  wrap: 'greedy' | 'balanced';
  delay: number;
  stagger: number;
  duration: number;
  ease: EasingSpec;
  distance: number;
  direction: 'up' | 'down' | 'left' | 'right';
}

const SAFE_MARGIN = 0.08;
const DEFAULT_COLOR = '#F5F3F7';
const DEFAULT_FONT = 'BebasNeue.ttf';

/** The font file a kinetic block draws with: its bundled id or file, else Bebas Neue. */
export function kineticFontFile(font: string | undefined): string {
  if (!font) return DEFAULT_FONT;

  return findFont(font)?.file ?? font;
}

// A spring's own settle time when no duration is authored, else the preset's.
function unitDuration(authored: number | undefined, ease: EasingSpec, fallback: number): number {
  if (authored !== undefined) return authored;

  if (isLegacyEasing(ease)) return fallback;

  return parseEasing(ease).settle ?? fallback;
}

// A counter without an authored duration rolls for longer the more units it travels: a short count ticks
// briskly (0.6 s), a six-figure one gets time to read (1.6 s).
function presetDuration(block: KineticBlock, fallback: number): number {
  if (block.preset !== 'counter' || !block.counter) return fallback;

  if (block.counter.to === undefined) return COPY_COUNTER_SECONDS;

  const units = Math.abs(block.counter.to - block.counter.from) * 10 ** (block.counter.decimals ?? 0);
  const seconds = 0.5 + 0.25 * Math.log10(Math.max(1, units));

  return Math.round(Math.min(1.6, Math.max(0.6, seconds)) * 100) / 100;
}

function anchorX(block: KineticBlock, align: KineticAlign, frame: KineticFrame): number {
  if (block.x !== undefined) return block.x;

  if (align === 'left') return frame.width * SAFE_MARGIN;

  return align === 'center' ? frame.width / 2 : frame.width * (1 - SAFE_MARGIN);
}

// Typography and placement: everything that doesn't depend on the preset's choreography.
function resolveType(
  block: KineticBlock,
  frame: KineticFrame
): Pick<ResolvedKinetic, 'font' | 'size' | 'color' | 'align' | 'x' | 'maxWidth' | 'lineHeight' | 'wrap'> {
  const size = block.size ?? Math.round(frame.height * 0.11);
  const align = block.align ?? 'center';

  return {
    font: kineticFontFile(block.font),
    size,
    color: block.color ?? DEFAULT_COLOR,
    align,
    x: anchorX(block, align, frame),
    maxWidth: block.maxWidth ?? frame.width * (1 - 2 * SAFE_MARGIN),
    lineHeight: (block.lineHeight ?? 1.05) * size,
    wrap: block.wrap ?? 'greedy',
  };
}

/**
 * True when the block's copy is in a script that joins or reorders glyphs (Arabic, Hebrew, Devanagari…)
 * and would animate per word or glyph: drawing those pieces apart breaks every join and the right-to-
 * left order, so the block is drawn a whole line at a time instead (`kinetic_unit_coarsened`).
 */
export function coarsenedForScript(block: KineticBlock, text: string): boolean {
  return (block.unit ?? KINETIC_PRESET_DEFAULTS[block.preset].unit) !== 'line' && needsShaping(text);
}

/** Settings for the block; `text` (the resolved copy) coarsens shaped scripts to whole lines. */
export function resolveKinetic(block: KineticBlock, frame: KineticFrame, text = ''): ResolvedKinetic {
  const preset = KINETIC_PRESET_DEFAULTS[block.preset];
  const unit = coarsenedForScript(block, text) ? 'line' : (block.unit ?? preset.unit);
  const type = resolveType(block, frame);
  const ease = block.ease ?? preset.ease;

  return {
    ...type,
    preset: block.preset,
    unit,
    delay: seconds(block.delay) ?? 0.2,
    stagger: block.stagger ?? preset.stagger[unit],
    duration: unitDuration(block.duration, ease, presetDuration(block, preset.duration)),
    ease,
    distance: (block.distance ?? preset.travel * type.size) * frame.energy,
    direction: block.direction ?? (block.preset === 'drop' ? 'down' : 'left'),
  };
}

/** Top of the block for a y anchor, keeping it inside the title-safe area. */
export function blockTop(y: KineticBlock['y'], height: number, frame: KineticFrame): number {
  if (typeof y === 'number') return y;

  const margin = frame.height * SAFE_MARGIN;

  if (y === 'top') return margin;

  if (y === 'bottom') return frame.height - margin - height;

  return (frame.height - height) / 2;
}

/** Rank of each piece in the stagger order (0 moves first). */
export function staggerRanks(pieces: readonly LayoutPiece[], order: KineticBlock['order'], seed: number): number[] {
  const n = pieces.length;
  const center = (n - 1) / 2;
  const keys = pieces.map((_, i) => {
    if (order === 'reverse') return n - 1 - i;

    if (order === 'center') return Math.abs(i - center);

    if (order === 'edges') return center - Math.abs(i - center);

    return i;
  });

  if (order === 'random') {
    const random = seededRandom(seed);
    const shuffled = keys.map((_, i) => ({ i, r: random() })).sort((a, b) => a.r - b.r);

    return keys.map((_, i) => shuffled.findIndex((entry) => entry.i === i));
  }

  // Ties (center/edges) share a rank, so symmetric units move together.
  const distinct = [...new Set(keys)].sort((a, b) => a - b);

  return keys.map((key) => distinct.indexOf(key));
}

export function resolveExit(
  block: KineticBlock,
  settings: ResolvedKinetic,
  frame: KineticFrame,
  maxRank: number
): ResolvedExit | null {
  const authored: Partial<KineticExit> = typeof block.exit === 'string' ? { preset: block.exit } : (block.exit ?? {});

  if (!authored.preset || authored.preset === 'none') return null;

  const duration = authored.duration ?? 0.35;
  const stagger = authored.stagger ?? settings.stagger / 2;

  return {
    preset: authored.preset,
    at: seconds(authored.at) ?? Math.max(0, frame.duration - duration - maxRank * stagger - 1 / frame.fps),
    duration,
    stagger,
    ease: authored.ease ?? 'ease-in-cubic',
    distance: (authored.distance ?? settings.size * 0.5) * frame.energy,
  };
}
