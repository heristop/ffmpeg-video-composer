import type { Filter } from '@/core/types';
import { deriveSeed } from '@/core/determinism/hash';
import { resolveSeed } from '@/core/determinism/contract';

// D3: every `noise` filter (grain grades, the glitch look, authored grain) gets an
// explicit `all_seed` derived from `global.seed` and the filter's own path. FFmpeg's built-in default
// seed is a constant, so without this every grain layer in a film would show the identical pattern, and
// a new seed could not reshuffle it.

// noise's all_seed is a signed int (-1 = random), so keep derived seeds in 0..INT_MAX.
const INT_MAX = 0x7fffffff;

export function seedNoiseFilters(filters: Filter[], globalSeed: number, sectionName: string): Filter[] {
  return filters.map((filter, index) => {
    if (filter.type !== 'noise' || typeof filter.value !== 'string' || filter.value.includes('all_seed')) {
      return filter;
    }

    const seed = deriveSeed(globalSeed, `sections.${sectionName}.filters[${index}]`) & INT_MAX;

    return { ...filter, value: `${filter.value}:all_seed=${seed}` };
  });
}

interface ChainSource {
  global?: { seed?: number } | null;
}

/**
 * The section chain: a leading CFR `fps` conform, so every frame sits on the
 * output grid and `t` in an animated expression is always an exact frame time (variable-frame-rate
 * phone footage can't shift a keyframe by a frame), and seeded `noise`.
 */
export function conformMotionChain(
  filters: Filter[],
  descriptor: ChainSource,
  fps: number,
  sectionName: string
): Filter[] {
  // A chain that already opens on the same conform (e.g. a background that sets its own rate) keeps one.
  const conformed = filters.at(0)?.type === 'fps' && Number(filters.at(0)?.value) === fps;
  const conform: Filter[] = conformed ? [] : [{ type: 'fps', value: fps }];

  return [...conform, ...seedNoiseFilters(filters, resolveSeed(descriptor), sectionName)];
}

/**
 * The motion inputs a section's sugar needs (kinetic typography): the energy dial and per-element
 * seeds derived from `global.seed` and the section name.
 */
export function motionSugarContext(
  descriptor: ChainSource & { global?: { motion?: { energy?: number } } | null },
  sectionName: string
): { energy: number; seedFor: (path: string) => number } {
  const seed = resolveSeed(descriptor);

  return {
    energy: descriptor.global?.motion?.energy ?? 1,
    seedFor: (path) => deriveSeed(seed, `sections.${sectionName}.${path}`),
  };
}

export { cameraEndOfChain, framedCamera } from './camera';
// The chain's head: footage edits (clip range / ramp / freeze) and the reframe scale, both prepended by
// SegmentBuilder ahead of the conform above.
export { sectionFootageHead } from '../utils/footage-section';
export { reframeFilters } from '../utils/reframe';
