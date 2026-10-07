// Runs the engine's reference-style analyzer in the browser. The analyzer (k-means, contrast, pacing)
// is imported on demand, so it ships as its own chunk and costs nothing until a reference is analysed.
import type { StyleAnalysis, StyleFrame } from 'ffmpeg-video-composer/src/core/style/types.ts';
import { clipFrames, imageFrame } from './reference-frames';

export interface ReferenceFiles {
  image?: File | null;
  clip?: File | null;
}

export interface ReferenceStyle {
  analysis: StyleAnalysis;
  /** Binding keep / avoid rules for a generation prompt. */
  promptRules: string;
}

/** Which frames feed the palette and which the pacing, from the files the user supplied. */
export function analyzerInput(
  image: StyleFrame | null,
  clip: { frames: StyleFrame[]; duration: number } | null
): { frames: StyleFrame[]; paletteFrames?: StyleFrame[]; duration?: number } {
  if (clip && clip.frames.length > 0) {
    // A still sets the palette when given; the clip always sets the pacing.
    return { frames: clip.frames, duration: clip.duration, ...(image ? { paletteFrames: [image] } : {}) };
  }

  if (image) return { frames: [image] };

  throw new Error('Add a reference image or clip first');
}

export async function analyzeReference(files: ReferenceFiles, signal?: AbortSignal): Promise<ReferenceStyle> {
  const image = files.image ? await imageFrame(files.image) : null;
  const clip = files.clip ? await clipFrames(files.clip, signal) : null;
  signal?.throwIfAborted();
  const { analyzeStyle, styleGuidePromptRules } = await import('ffmpeg-video-composer/src/core/style/index.ts');
  const analysis = analyzeStyle(analyzerInput(image, clip));

  return { analysis, promptRules: styleGuidePromptRules(analysis) };
}
