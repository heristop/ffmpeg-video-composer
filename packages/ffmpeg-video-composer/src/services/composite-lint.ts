// Advisories for layer blend modes and motion blur, on the motion-warning channel (getMotionWarnings, through
// collectScriptWarnings in script-lint.ts):
// - motion_blur_static: motionBlur on a layer whose position/scale/rotate tracks never change, or on a kinetic
//   block whose preset never travels (fade, typewriter, scramble, counter): nothing to blur;
// - motion_blur_ignored: motionBlur on a kinetic block with a fill or a clip, or on a layer with a clip (their
//   mask graphs stay sharp);
// - blend_unavailable / motion_blur_unavailable: only when the caller names a build without blend / tmix.
// Render-free and never errors, even on templates that skipped validation.

import { expandPartialsSafe } from '@/core/partials';
import { layerSpans } from '../editor/presets/motion-spans';
import { BLEND_UNAVAILABLE_WARNING } from '../editor/presets/layer-blend';
import { MOTION_BLUR_UNAVAILABLE_WARNING } from '../editor/presets/motion-blur';
import { MOTION_BLUR_STILL_PRESETS, resolveMotionBlur } from '../schemas/layer-composite.schemas';
import type { MotionWarning } from './motion-lint';

/** The capabilities this lint reads; structurally a subset of ScriptLintCapabilities (script-lint imports this file). */
export interface CompositeCapabilities {
  blend?: boolean;
  tmix?: boolean;
}

type Bag = Record<string, unknown>;

const MOVING = ['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotate'];

function list(value: unknown): Bag[] {
  return Array.isArray(value) ? value.filter((item): item is Bag => typeof item === 'object' && item !== null) : [];
}

function warning(path: string, code: string, message: string, hint: string): MotionWarning {
  return { path, code, severity: 'warn', message, hint };
}

function plain(message: string): string {
  return message.replace(/^\[[a-z_]+\] /, '');
}

function blurRequested(value: unknown): boolean {
  return resolveMotionBlur(value as Parameters<typeof resolveMotionBlur>[0]) !== null;
}

function moves(animate: unknown): boolean {
  if (typeof animate !== 'object' || animate === null) return false;

  const tracks: Bag = {};

  for (const name of MOVING) {
    const keys = (animate as Bag)[name];

    if (Array.isArray(keys) && keys.every((key) => typeof key === 'object' && key !== null)) tracks[name] = keys;
  }

  try {
    return layerSpans(tracks, 30).length > 0;
  } catch {
    return true;
  }
}

function staticLayer(path: string): MotionWarning {
  return warning(
    `${path}.motionBlur`,
    'motion_blur_static',
    'no x, y, scale or rotate track moves the layer, so there is nothing to blur (entrance `motion` presets are not blurred)',
    'Give the layer an x, y, scale or rotate track, or drop motionBlur.'
  );
}

function ignored(path: string, what: string): MotionWarning {
  return warning(
    `${path}.motionBlur`,
    'motion_blur_ignored',
    `${what} is drawn sharp: motion blur skips masked and clipped elements`,
    'Drop the fill or clip for the blurred beat, or drop motionBlur.'
  );
}

function blendWarnings(options: Bag, path: string, caps?: CompositeCapabilities): MotionWarning[] {
  if (caps?.blend !== false || typeof options.blend !== 'string' || options.blend === 'normal') return [];

  return [
    warning(
      `${path}.blend`,
      'blend_unavailable',
      plain(BLEND_UNAVAILABLE_WARNING),
      'Rebuild the on-device engine (scripts/ffmpeg/build-engine.sh) or keep the layer legible without its blend.'
    ),
  ];
}

function unavailable(path: string, caps?: CompositeCapabilities): MotionWarning[] {
  if (caps?.tmix !== false) return [];

  return [
    warning(
      `${path}.motionBlur`,
      'motion_blur_unavailable',
      plain(MOTION_BLUR_UNAVAILABLE_WARNING),
      'Rebuild the on-device engine (scripts/ffmpeg/build-engine.sh); the move still reads without blur.'
    ),
  ];
}

function blurWarnings(options: Bag, path: string, caps?: CompositeCapabilities): MotionWarning[] {
  if (!blurRequested(options.motionBlur)) return [];

  if (options.clip) return [ignored(path, 'a clipped layer')];

  if (!moves(options.animate)) return [staticLayer(path)];

  return unavailable(path, caps);
}

function layerWarnings(options: Bag, path: string, caps?: CompositeCapabilities): MotionWarning[] {
  return [...blendWarnings(options, path, caps), ...blurWarnings(options, path, caps)];
}

function blockWarnings(block: Bag, path: string, caps?: CompositeCapabilities): MotionWarning[] {
  if (!blurRequested(block.motionBlur)) return [];

  const preset = typeof block.preset === 'string' ? block.preset : '';

  if (MOTION_BLUR_STILL_PRESETS.has(preset)) {
    return [
      warning(
        `${path}.motionBlur`,
        'motion_blur_static',
        `"${preset}" never moves its units, so there is nothing to blur (entrance \`motion\` presets are not blurred)`,
        'Use a travelling preset (slide, rise, drop, impact, cascade) or drop motionBlur.'
      ),
    ];
  }

  if (block.fill) return [ignored(path, 'a filled kinetic block')];

  if (block.clip) return [ignored(path, 'a clipped kinetic block')];

  return unavailable(path, caps);
}

function sectionWarnings(section: Bag, index: number, caps?: CompositeCapabilities): MotionWarning[] {
  const inputs = list(section.inputs).flatMap((input, j) => {
    const options = typeof input.options === 'object' && input.options !== null ? (input.options as Bag) : {};

    return layerWarnings(options, `sections[${index}].inputs[${j}].options`, caps);
  });
  const blocks = list(section.kinetic).flatMap((block, k) =>
    blockWarnings(block, `sections[${index}].kinetic[${k}]`, caps)
  );

  return [...inputs, ...blocks];
}

export function collectCompositeWarnings(template: unknown, caps?: CompositeCapabilities): MotionWarning[] {
  const expansion = expandPartialsSafe(template);

  if (!expansion.ok) return [];

  const sections = (expansion.data as Bag | null)?.sections;

  return Array.isArray(sections)
    ? sections.flatMap((section, i) =>
        typeof section === 'object' && section !== null ? sectionWarnings(section as Bag, i, caps) : []
      )
    : [];
}
