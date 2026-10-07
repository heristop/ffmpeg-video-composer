// Pure helpers for the "Match a reference" panel: which swatches to preview, how each one's contrast
// reads, and how an analysed theme lands in the editor (as global.theme, object form).
import type { StyleAnalysis } from 'ffmpeg-video-composer/src/core/style/types.ts';
import type { EditorMotion } from '../templateEditorModel';

export const PREVIEW_ROLES = ['bg', 'fg', 'muted', 'surface', 'brand', 'accent', 'accent2'] as const;
export type PreviewRole = (typeof PREVIEW_ROLES)[number];
export type ContrastLevel = 'aa' | 'aaLarge' | 'fail';

export interface Swatch {
  role: PreviewRole;
  hex: string;
  source: 'extracted' | 'adjusted' | 'derived';
  /** Contrast against bg (absent for bg itself). */
  contrast?: { ratio: number; level: ContrastLevel };
}

export function contrastLevel(aa: boolean, aaLarge: boolean): ContrastLevel {
  if (aa) return 'aa';

  return aaLarge ? 'aaLarge' : 'fail';
}

/** One swatch per theme role, in token order, with its contrast on bg from the style guide. */
export function swatchesOf(analysis: StyleAnalysis): Swatch[] {
  const { roles, contrast } = analysis.styleGuide;

  return PREVIEW_ROLES.map((role) => {
    const check = contrast.find((c) => c.pair === `${role}/bg`);

    return {
      role,
      hex: roles[role].hex,
      source: roles[role].source,
      ...(check ? { contrast: { ratio: check.ratio, level: contrastLevel(check.aa, check.aaLarge) } } : {}),
    };
  });
}

/** The editor motion settings with the analysed theme set as global.theme (seed / tokens kept). */
export function withReferenceTheme(motion: EditorMotion | undefined, analysis: StyleAnalysis): EditorMotion {
  return { ...motion, theme: structuredClone(analysis.theme) };
}

/** A percentage for display, 0..100. */
export function percent(value: number): number {
  return Math.round(value * 100);
}

const IMAGE_TYPES = /^image\/(png|jpeg|webp|gif|bmp|avif)$/;
const VIDEO_TYPES = /^video\//;

export function isReferenceImage(file: File): boolean {
  return IMAGE_TYPES.test(file.type);
}

export function isReferenceClip(file: File): boolean {
  return VIDEO_TYPES.test(file.type);
}
