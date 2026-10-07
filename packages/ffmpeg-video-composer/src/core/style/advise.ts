// From measurements to direction: the theme's motion feel, a doctrine genre, keep / avoid rules and
// plain-language suggestions. Deterministic rules only, so the same reference always reads the same way.

import { relativeLuminance } from '../color-contrast';
import type { MotionGenre } from '../motion/catalog-doctrine';
import type { ThemeMotion } from '../theme/themes';
import { hexToRgb } from './oklab';
import type { ClipMotion } from './pacing';
import type { Texture, ThemeRoles } from './types';

function round(value: number, digits = 2): number {
  const f = 10 ** digits;

  return Math.round(value * f) / f;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function easeFor(energy: number): string {
  if (energy >= 1.15) return '$snappy';

  return energy >= 0.85 ? '$smooth' : '$gentle';
}

/** theme.motion from pacing: busier cutting and more motion raise energy and shorten the beat. */
export function themeMotionFor(clip: ClipMotion): ThemeMotion {
  const pace = clamp(clip.pacing.cutsPerMinute / 40, 0, 1);
  const energy = round(clamp(0.55 + 0.45 * clip.energy + 0.4 * pace, 0.5, 1.4));

  return { energy, ease: easeFor(energy), beat: round(clamp(clip.pacing.avgShot / 5, 0.4, 1)) };
}

interface GenreRule {
  genre: MotionGenre;
  when: (clip: ClipMotion, dark: boolean, grain: boolean) => boolean;
}

const GENRE_RULES: GenreRule[] = [
  { genre: 'social-hook', when: (c) => c.pacing.cutsPerMinute >= 30 && c.energy >= 0.35 },
  { genre: 'cinematic-trailer', when: (c, dark, grain) => dark && (grain || c.pacing.cutsPerMinute >= 15) },
  { genre: 'social-hook', when: (c) => c.pacing.cutsPerMinute >= 30 },
  { genre: 'product-launch', when: (c) => c.pacing.cutsPerMinute >= 12 },
  { genre: 'calm-tutorial', when: (c) => c.energy < 0.25 && c.pacing.avgShot >= 5 },
];

export function isDarkHex(hex: string): boolean {
  return relativeLuminance(hexToRgb(hex)) < 0.18;
}

/** The doctrine genre a clip's pacing, energy and palette suggest (`explainer` when nothing stands out). */
export function suggestGenre(clip: ClipMotion, roles: ThemeRoles, texture: Texture): MotionGenre {
  const dark = isDarkHex(roles.bg.hex);
  const rule = GENRE_RULES.find((r) => r.when(clip, dark, texture.look === 'grain'));

  return rule?.genre ?? 'explainer';
}

export interface AdviceInput {
  roles: ThemeRoles;
  texture: Texture;
  clip: ClipMotion | null;
  genre: MotionGenre | null;
}

export function keepRules({ roles, texture, clip }: AdviceInput): string[] {
  const keep = [
    `${isDarkHex(roles.bg.hex) ? 'Dark' : 'Light'} ${roles.bg.hex} canvas ($color.bg) with ${roles.fg.hex} text ($color.fg).`,
    `${roles.accent.hex} ($color.accent) as the one highlight per idea; ${roles.accent2.hex} ($color.accent2) only rarely.`,
    `${roles.muted.hex} ($color.muted) for kickers, captions and labels; ${roles.surface.hex} ($color.surface) for plates and bands.`,
  ];

  if (texture.look === 'grain') keep.push(`Film grain over every section (global.grade.grain ≈ ${texture.grain}).`);

  if (clip) {
    keep.push(
      `Shots of about ${clip.pacing.avgShot} s (${clip.pacing.cutsPerMinute} cuts per minute); motion energy ${clip.energy}.`
    );
  }

  return keep;
}

export function avoidRules({ texture, clip }: AdviceInput): string[] {
  const avoid = [
    'Colours outside this palette, and more than two accented elements per section.',
    'Text below 4.5:1 contrast: muted is for secondary copy only, never on surface plates darker than bg.',
    'Copying subjects, logos, text or framing from the reference: only its palette and pacing carry over.',
  ];

  if (texture.look === 'none') avoid.push('Film grain and heavy noise: the reference is clean.');

  if (clip && clip.energy < 0.3) avoid.push('Overshoot springs and flashy transitions: the reference moves calmly.');

  if (clip && clip.pacing.cutsPerMinute >= 30) avoid.push('Long holds and slow fades: the reference cuts fast.');

  return avoid;
}

export function suggestions(input: AdviceInput): string[] {
  const out: string[] = [];
  const adjusted = (['fg', 'muted', 'accent', 'accent2', 'brand'] as const).filter(
    (name) => input.roles[name].source === 'adjusted'
  );

  if (adjusted.length > 0) {
    out.push(`Lightness adjusted for WCAG AA on bg: ${adjusted.join(', ')}.`);
  }

  if (input.roles.accent.source === 'derived') {
    out.push('No distinct accent hue in the reference: set $color.accent to your brand colour.');
  }

  if (input.texture.look === 'grain') {
    out.push(`Add "grade": { "grain": ${input.texture.grain} } to global for the reference's texture.`);
  }

  if (input.genre) out.push(`Direct it as ${input.genre}: get_motion_catalog lists that genre's doctrine.`);

  out.push('Apply as global.theme (object form); reference the tokens as $color.<role>.');

  return out;
}
