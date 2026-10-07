// Advisory findings for footage edits (fit / focus / speed ramps / clip range), surfaced with the motion
// warnings: they never fail validation — the template renders — but say what will look wrong.
//
// - extreme_speed: an authored ramp key below 0.25x or above 4x: frames are duplicated (a visible stutter)
//   or dropped (strobing), and stretched sound smears.
// - focus_ignored: a focus on a fit that does not crop (letterbox / blur / off).
// - blur_fit_overlaid: fit blur on a section that composites animation overlays or a chroma key, whose
//   base leg is cover-normalized first, so the whole picture is already cropped.
// - footage_shortens_section: a video section whose clip range ends before options.duration; the section
//   renders for the shorter, edited length.

import { expandPartialsSafe } from '@/core/partials';
import { footageLength } from '@/core/footage/plan';
import DefaultConfig from '@/core/default.config';
import type { MotionWarning } from './motion-lint';

type Bag = Record<string, unknown>;

export const EXTREME_SLOW = 0.25;
export const EXTREME_FAST = 4;

function warn(path: string, code: string, message: string, hint: string): MotionWarning {
  return { path, code, message, severity: 'warn', hint };
}

function speedWarnings(options: Bag, path: string): MotionWarning[] {
  const keys = Array.isArray(options.speedRamp) ? (options.speedRamp as Bag[]) : [];

  return keys.flatMap((key, index) => {
    const speed = Number(key.speed);

    if (!(speed < EXTREME_SLOW || speed > EXTREME_FAST)) return [];

    return [
      warn(
        `${path}.speedRamp[${index}].speed`,
        'extreme_speed',
        `ramp speed ${speed}x is outside ${EXTREME_SLOW}x..${EXTREME_FAST}x: frames are ${speed < 1 ? 'repeated (stutter)' : 'skipped (strobe)'}`,
        'Keep slow motion at 0.25x or faster unless the source was shot at a high frame rate; use rampAudio "mute" for extreme speeds.'
      ),
    ];
  });
}

function fitOf(options: Bag): string {
  if (typeof options.fit === 'string') return options.fit;

  if (options.forceOriginalAspectRatio) return 'letterbox';

  return options.forceAspectRatio === false ? 'off' : 'cover';
}

function reframeWarnings(section: Bag, options: Bag, path: string): MotionWarning[] {
  const fit = fitOf(options);
  const overlaid = (Array.isArray(section.inputs) && section.inputs.length > 0) || section.chromaKey !== undefined;
  const focus =
    options.focus !== undefined && options.focus !== 'center' && fit !== 'cover'
      ? [
          warn(
            `${path}.focus`,
            'focus_ignored',
            `focus only anchors a cover crop; fit is "${fit}"`,
            'Remove focus, or use fit "cover".'
          ),
        ]
      : [];
  const blur =
    fit === 'blur' && overlaid
      ? [
          warn(
            `${path}.fit`,
            'blur_fit_overlaid',
            'fit "blur" under overlay inputs or a chroma key: the clip is cover-normalized before compositing',
            'Drop the overlay inputs (use graphics / kinetic instead), or use fit "cover".'
          ),
        ]
      : [];

  return [...focus, ...blur];
}

function lengthWarnings(section: Bag, options: Bag, path: string): MotionWarning[] {
  const declared = typeof options.duration === 'number' ? options.duration : undefined;

  if (section.type !== 'video' || declared === undefined || options.clip === undefined) return [];

  let edited: number | undefined;

  try {
    edited = footageLength(options, undefined, DefaultConfig.FPS);
  } catch {
    return [];
  }

  if (edited === undefined || edited >= declared) return [];

  return [
    warn(
      `${path}.clip`,
      'footage_shortens_section',
      `the edited clip runs ${edited} s, shorter than options.duration (${declared} s); the section renders ${edited} s`,
      'Widen the clip range, or set options.duration to the edited length.'
    ),
  ];
}

function sectionAdvisories(section: Bag, index: number): MotionWarning[] {
  const options = section.options as Bag | undefined;

  if (!options) return [];

  const path = `sections[${index}].options`;
  const footage = section.type === 'video' || section.type === 'project_video';

  return [
    ...reframeWarnings(section, options, path),
    ...(footage ? [...speedWarnings(options, path), ...lengthWarnings(section, options, path)] : []),
  ];
}

/** Every footage advisory of the template (partials expanded). Never throws. */
export function footageAdvisories(template: unknown): MotionWarning[] {
  const expansion = expandPartialsSafe(template);
  const sections = (expansion.ok ? (expansion.data as { sections?: unknown } | null)?.sections : undefined) ?? [];

  if (!Array.isArray(sections)) return [];

  return sections.flatMap((section, index) =>
    section !== null && typeof section === 'object' ? sectionAdvisories(section as Bag, index) : []
  );
}
