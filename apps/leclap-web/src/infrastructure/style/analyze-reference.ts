// Runs the engine's reference-style analyzer in the browser. The analyzer (k-means, contrast, pacing)
// is imported on demand, so it ships as its own chunk and costs nothing until a reference is analysed.
import type { ReferenceStructure } from 'ffmpeg-video-composer/src/core/structure/types.ts';
import type { StyleAnalysis, StyleFrame } from 'ffmpeg-video-composer/src/core/style/types.ts';
import { clipFrames, imageFrame } from './reference-frames';

export interface ReferenceFiles {
  image?: File | null;
  clip?: File | null;
}

export interface ReferenceStyle {
  analysis: StyleAnalysis;
  /** The clip's format (shots, rhythm, layout); absent for a still. */
  structure?: ReferenceStructure;
  /** Binding keep / avoid rules, then the format for a clip, for a generation prompt. */
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

/** The style rules, followed by the binding format when the reference is a clip. */
export async function referencePromptRules(styleRules: string, structure?: ReferenceStructure): Promise<string> {
  if (!structure) return styleRules;

  const { structurePromptRules } = await import('ffmpeg-video-composer/src/core/structure/prompt.ts');

  return `${styleRules}\n\n${structurePromptRules(structure)}`;
}

export async function analyzeReference(files: ReferenceFiles, signal?: AbortSignal): Promise<ReferenceStyle> {
  const image = files.image ? await imageFrame(files.image) : null;
  const clip = files.clip ? await clipFrames(files.clip, signal) : null;
  signal?.throwIfAborted();
  const { analyzeStyle, styleGuidePromptRules } = await import('ffmpeg-video-composer/src/core/style/index.ts');
  const analysis = analyzeStyle(analyzerInput(image, clip));
  const structure =
    clip && clip.frames.length > 1
      ? (await import('ffmpeg-video-composer/src/core/structure/analyze.ts')).analyzeStructure(clip)
      : undefined;

  return {
    analysis,
    ...(structure ? { structure } : {}),
    promptRules: await referencePromptRules(styleGuidePromptRules(analysis), structure),
  };
}
