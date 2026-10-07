// Easing choices shared by the Entrance and Exit controls. The segmented control offers the four
// historical curves; a motion-system curve authored in the template JSON (a spring, a cubic-bezier, a
// $token…) shows up as one extra, selected segment labelled with its spec, so the editor displays it
// faithfully and only replaces it when the author explicitly picks a preset.
import type { TFunction } from 'i18next';
import { REVEAL_EASINGS } from 'ffmpeg-video-composer/src/schemas/effects.schemas.ts';
import type { EasingSpec } from 'ffmpeg-video-composer/src/core/motion/easing.ts';
import type { SegmentOption } from './controls';

export type PresetEasing = (typeof REVEAL_EASINGS)[number];
export const CUSTOM_EASING = 'custom';
export type EasingChoice = PresetEasing | typeof CUSTOM_EASING;

const EASING_LABEL_KEYS: Record<PresetEasing, string> = {
  linear: 'easingLinear',
  'ease-out': 'easingEaseOut',
  'ease-in-out': 'easingEaseInOut',
  'ease-out-back': 'easingEaseOutBack',
};

function isPreset(easing: EasingSpec | undefined): easing is PresetEasing {
  return typeof easing === 'string' && (REVEAL_EASINGS as readonly string[]).includes(easing);
}

/** The spec as authored: `spring(300, 14)`, `$snappy`, or `points(3)` for a custom point curve. */
export function customEasingLabel(easing: EasingSpec): string {
  return typeof easing === 'string' ? easing : `points(${easing.points.length})`;
}

export function easingLabel(t: TFunction<'admin'>, easing: EasingSpec): string {
  return isPreset(easing) ? t(`reveal.${EASING_LABEL_KEYS[easing]}`) : customEasingLabel(easing);
}

export function easingChoice(easing: EasingSpec | undefined): EasingChoice {
  if (easing === undefined) return 'linear';

  return isPreset(easing) ? easing : CUSTOM_EASING;
}

export function easingOptions(
  t: TFunction<'admin'>,
  easing: EasingSpec | undefined
): ReadonlyArray<SegmentOption<EasingChoice>> {
  const presets = REVEAL_EASINGS.map((value) => ({ value, label: easingLabel(t, value) }));

  if (easing === undefined || isPreset(easing)) return presets;

  return [...presets, { value: CUSTOM_EASING, label: customEasingLabel(easing) }];
}
