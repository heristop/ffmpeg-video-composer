// Per-unit choreography: the keyframe tracks one word / glyph / line follows, by preset. Tracks are
// P1 `animate` keys (core/motion/tracks.ts), so every preset inherits springs, tokens and the exact
// Hermite lowering. Values are offsets from the unit's resting place (px) or plain multipliers.

import type { EasingSpec } from '../motion/easing';
import type { TrackKey } from '../motion/tracks';
import type { LayoutPiece } from './layout';
import type { ResolvedExit, ResolvedKinetic } from './resolve';

export interface UnitTracks {
  x: TrackKey[];
  y: TrackKey[];
  opacity: TrackKey[];
  scale?: TrackKey[];
}

export interface UnitTiming {
  start: number;
  arrive: number;
  /** When this unit starts leaving, or null when the block holds to the cut. */
  leave: number | null;
}

const FADE_IN = 0.18;

function enter(start: number, arrive: number, from: number, ease: EasingSpec): TrackKey[] {
  return [
    { t: start, v: from },
    { t: arrive, v: 0, ease },
  ];
}

function slideOffset(direction: ResolvedKinetic['direction'], distance: number): { x: number; y: number } {
  const table = {
    left: { x: distance, y: 0 },
    right: { x: -distance, y: 0 },
    up: { x: 0, y: distance },
    down: { x: 0, y: -distance },
  };

  return table[direction];
}

// Where a unit starts, as an offset from its resting place, per preset.
function entranceOffset(settings: ResolvedKinetic, piece: LayoutPiece, lineCenter: number): { x: number; y: number } {
  const d = settings.distance;
  const center = piece.x + piece.width / 2;

  switch (settings.preset) {
    case 'cascade':
    case 'rise':
    case 'highlight':
    case 'wave':
      return { x: 0, y: d };
    case 'drop':
      return { x: 0, y: -d };
    case 'slide':
      return slideOffset(settings.direction, d);
    case 'split':
      return { x: center < lineCenter ? -d : d, y: 0 };
    case 'tracking-in':
      return { x: (center - lineCenter) * (d / settings.size), y: 0 };
    default:
      return { x: 0, y: 0 };
  }
}

const SCALE_FROM: Record<string, number> = { pop: 0.3, impact: 1.8 };

function exitOffset(exit: ResolvedExit): { x: number; y: number } {
  if (exit.preset === 'rise' || exit.preset === 'cascade') return { x: 0, y: -exit.distance };

  if (exit.preset === 'drop') return { x: 0, y: exit.distance };

  return exit.preset === 'slide' ? { x: -exit.distance, y: 0 } : { x: 0, y: 0 };
}

function withExit(
  keys: TrackKey[],
  leave: number | null,
  exit: ResolvedExit | null,
  to: number,
  rest: number
): TrackKey[] {
  if (leave === null || !exit) return keys;

  return [...keys, { t: leave, v: rest }, { t: leave + exit.duration, v: to, ease: exit.ease }];
}

/** The tracks one unit follows for its preset, entrance and exit. */
export function unitTracks(
  settings: ResolvedKinetic,
  piece: LayoutPiece,
  lineCenter: number,
  timing: UnitTiming,
  exit: ResolvedExit | null
): UnitTracks {
  const from = entranceOffset(settings, piece, lineCenter);
  const out = exit ? exitOffset(exit) : { x: 0, y: 0 };
  const fadeEnd =
    settings.preset === 'typewriter'
      ? timing.start + 0.001
      : timing.start + Math.min(FADE_IN, timing.arrive - timing.start);
  const opacityIn: TrackKey[] = [
    { t: timing.start, v: 0 },
    { t: Math.max(fadeEnd, timing.start + 0.001), v: 1 },
  ];
  const scaleFrom = Object.hasOwn(SCALE_FROM, settings.preset) ? SCALE_FROM[settings.preset] : undefined;
  const shrinks = exit?.preset === 'shrink';
  const tracks: UnitTracks = {
    x: withExit(enter(timing.start, timing.arrive, from.x, settings.ease), timing.leave, exit, out.x, 0),
    y: withExit(enter(timing.start, timing.arrive, from.y, settings.ease), timing.leave, exit, out.y, 0),
    opacity: withExit(opacityIn, timing.leave, exit, 0, 1),
  };

  if (scaleFrom !== undefined || shrinks) {
    const scaleIn: TrackKey[] = [
      { t: timing.start, v: scaleFrom ?? 1 },
      { t: timing.arrive, v: 1, ease: settings.ease },
    ];
    tracks.scale = withExit(scaleIn, timing.leave, exit, shrinks ? 0.4 : 1, 1);
  }

  return tracks;
}
