// The reference-style analyzer: decoded frames in, a theme and a style guide out. Platform-neutral —
// the CLI and MCP feed it ffmpeg rgb24 frames, the web builder canvas RGBA frames — and deterministic:
// the same pixels and seed always produce the same theme. Palette, texture and pacing only; nothing
// about what the reference depicts is read or reproduced.

import { THEME_COLOR_NAMES, type ThemeColorName, type ThemeColors, type ThemeInput } from '../theme/themes';
import { avoidRules, keepRules, suggestGenre, suggestions, themeMotionFor, type AdviceInput } from './advise';
import { AA_LARGE, AA_TEXT, ratioOf } from './contrast';
import { hexToRgb } from './oklab';
import { analyzePacing, type ClipMotion } from './pacing';
import { extractPalette } from './palette';
import { assignRoles, type RoleResult } from './roles';
import { estimateTexture } from './texture';
import type { ContrastCheck, PaletteCluster, PaletteEntry, StyleAnalysis, StyleInput, ThemeRoles } from './types';

const CONTRAST_PAIRS: Array<[ThemeColorName, ThemeColorName]> = [
  ['fg', 'bg'],
  ['muted', 'bg'],
  ['accent', 'bg'],
  ['accent2', 'bg'],
  ['brand', 'bg'],
  ['fg', 'surface'],
];

function contrastChecks(roles: ThemeRoles): ContrastCheck[] {
  return CONTRAST_PAIRS.map(([a, b]) => {
    const ratio = Math.round(ratioOf(roles[a].hex, hexToRgb(roles[b].hex)) * 100) / 100;

    return { pair: `${a}/${b}`, ratio, aa: ratio >= AA_TEXT, aaLarge: ratio >= AA_LARGE };
  });
}

function paletteEntries(palette: readonly PaletteCluster[], result: RoleResult): PaletteEntry[] {
  return palette.map((cluster, index) => {
    const roles = THEME_COLOR_NAMES.filter((name) => {
      const color = result.roles[name];

      return result.origins[name] === index || (color.source === 'extracted' && color.hex === cluster.hex);
    });

    return { hex: cluster.hex, roles, share: Math.round(cluster.share * 1000) / 1000 };
  });
}

function colorsOf(roles: ThemeRoles): ThemeColors {
  return Object.fromEntries(THEME_COLOR_NAMES.map((name) => [name, roles[name].hex])) as ThemeColors;
}

function confidenceOf(palette: readonly PaletteCluster[], roles: ThemeRoles, frames: number, clip: boolean): number {
  let score = 0.45;

  if (palette.length >= 3) score += 0.15;

  if (roles.accent.source !== 'derived') score += 0.15;

  if (roles.fg.source === 'extracted') score += 0.1;

  if (!clip || frames >= 8) score += 0.15;

  return Math.round(Math.min(1, score) * 100) / 100;
}

function isClip(input: StyleInput): boolean {
  return (input.kind ?? (input.frames.length > 1 ? 'clip' : 'image')) === 'clip' && input.frames.length > 1;
}

/** Analyses a reference image or clip into a `global.theme` object and a style guide. */
export function analyzeStyle(input: StyleInput): StyleAnalysis {
  if (input.frames.length === 0) throw new Error('analyzeStyle needs at least one frame');

  const clip = isClip(input);
  const looks = input.paletteFrames && input.paletteFrames.length > 0 ? input.paletteFrames : input.frames;
  const palette = extractPalette(looks, { seed: input.seed });
  const result = assignRoles(palette);
  const texture = estimateTexture(looks);
  const motion: ClipMotion | null = clip ? analyzePacing(input.frames, input.duration) : null;
  const genre = motion ? suggestGenre(motion, result.roles, texture) : null;
  const advice: AdviceInput = { roles: result.roles, texture, clip: motion, genre };
  const theme: ThemeInput = {
    extends: 'leclap',
    colors: colorsOf(result.roles),
    ...(motion ? { motion: themeMotionFor(motion) } : {}),
  };

  return {
    theme,
    styleGuide: {
      source: {
        kind: clip ? 'clip' : 'image',
        frames: input.frames.length,
        ...(input.duration ? { duration: input.duration } : {}),
      },
      palette: paletteEntries(palette, result),
      roles: result.roles,
      contrast: contrastChecks(result.roles),
      pacing: motion?.pacing ?? null,
      motion: motion ? { energy: motion.energy } : null,
      texture,
      genre,
      rules: { keep: keepRules(advice), avoid: avoidRules(advice) },
      suggestions: suggestions(advice),
    },
    confidence: confidenceOf(palette, result.roles, input.frames.length, clip),
  };
}
