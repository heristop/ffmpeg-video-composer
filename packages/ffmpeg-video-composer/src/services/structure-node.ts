// Node host for the reference-structure analyzer: decode the clip with the style sampler (ffmpeg, rgb24,
// 160 px, every 0.25 s), then analyse its shots. A still has no structure.

import path from 'node:path';
import { analyzeStructure, type ReferenceStructure } from '../core/structure';
import { extractStyleFrames, type StyleFramesOptions } from './style-frames-node';

/**
 * Frames decoded for a structure: five minutes at the 0.25 s grid. The style sampler's 240 would space
 * a long clip's samples out (0.6 s on a two-minute clip) and merge a short shot into its neighbours.
 * Memory grows with it: a five-minute portrait clip (1200 frames of 160×348 rgb24, about 200 MB decoded,
 * plus the stdout chunks and the luma planes) peaked at about 650 MB resident; a 15 s landscape clip at
 * about 100 MB.
 */
export const STRUCTURE_MAX_FRAMES = 1200;

export async function analyzeStructureFile(
  file: string,
  options: StyleFramesOptions = {}
): Promise<ReferenceStructure> {
  const decoded = await extractStyleFrames(file, { maxFrames: STRUCTURE_MAX_FRAMES, ...options });

  if (decoded.kind === 'image') throw new Error(`${path.basename(file)} is a still: a structure needs a clip.`);

  return analyzeStructure({ frames: decoded.frames, duration: decoded.duration });
}
