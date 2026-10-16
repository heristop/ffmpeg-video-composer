// A reference clip's structure: its shots (from the boundaries), each with its traits, and the rhythm.

import type { StyleFrame } from '../style/types';
import { anchorOf, groundOf, motionOf } from './shot-traits';
import { DEFAULT_FRAME_INTERVAL, findBoundaries, frameTime } from './shots';
import type { ReferenceStructure, Shot, StructureInput } from './types';

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clipDuration(frames: readonly StyleFrame[], duration: number | undefined): number {
  if (duration !== undefined && duration > 0) return round2(duration);

  const last = frameTime(frames, frames.length - 1);
  const interval = frames.length > 1 ? last / (frames.length - 1) : DEFAULT_FRAME_INTERVAL;

  return round2(last + interval);
}

function framesWithin(frames: readonly StyleFrame[], start: number, end: number): StyleFrame[] {
  const inside = frames.filter((_, k) => frameTime(frames, k) >= start && frameTime(frames, k) < end);

  return inside.length > 0 ? inside : [frames[0]];
}

export function analyzeStructure(input: StructureInput): ReferenceStructure {
  const { frames } = input;

  if (frames.length < 2) throw new Error('A reference structure needs a clip (at least 2 frames), not a still.');

  const duration = clipDuration(frames, input.duration);
  const boundaries = findBoundaries(frames).filter((b) => b.time < duration);
  const starts = [0, ...boundaries.map((b) => b.time)];
  const shots: Shot[] = starts.map((start, index) => {
    const end = boundaries[index]?.time ?? duration;
    const inside = framesWithin(frames, start, end);

    return {
      index,
      start,
      end,
      duration: round2(end - start),
      transitionIn: index === 0 ? null : (boundaries[index - 1]?.transition ?? 'cut'),
      ground: groundOf(inside),
      anchor: anchorOf(inside),
      motion: motionOf(inside),
    };
  });
  const lengths = shots.map((shot) => shot.duration);

  return {
    duration,
    shots,
    rhythm: {
      shots: shots.length,
      avgShot: round2(duration / shots.length),
      shortest: Math.min(...lengths),
      longest: Math.max(...lengths),
      cutsPerMinute: round2((boundaries.length / duration) * 60),
    },
  };
}
