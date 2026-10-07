// Reference-style analysis: derive a theme and a style guide from a reference image or clip's palette,
// texture and pacing. Pure and platform-neutral; frame decoding lives with each host (ffmpeg on Node,
// <video> + canvas in the browser).
export { analyzeStyle } from './analyze';
export { extractPalette, clusterPalette, samplePixels, DEFAULT_STYLE_SEED, type PaletteOptions } from './palette';
export { assignRoles, type RoleResult } from './roles';
export { enforceContrast, AA_LARGE, AA_TEXT } from './contrast';
export { estimateTexture } from './texture';
export { analyzePacing, detectCuts, frameDifferences, type ClipMotion } from './pacing';
export { themeMotionFor, suggestGenre } from './advise';
export { styleGuideMarkdown, styleGuidePromptRules, STYLE_SCOPE_NOTE } from './markdown';
export { rgbToOklab, oklabToRgb, labToHex, type Lab } from './oklab';
export type {
  ContrastCheck,
  Pacing,
  PaletteCluster,
  PaletteEntry,
  RoleColor,
  RoleSource,
  StyleAnalysis,
  StyleFrame,
  StyleGuide,
  StyleInput,
  Texture,
  ThemeRoles,
} from './types';
