// Descriptor rules for footage edits (options.clip / speedRamp / freeze / focus) beyond their zod shapes,
// checked after motion tokens and time references resolve, as in the build:
//
// - speed_ramp_unordered / focus_keys_unordered: key times must strictly increase.
// - freeze_overlap: a freeze starts before the previous hold ends (holds are laid in section order).
// - freeze_outside_clip: the frozen frame is at or past the end of the edited clip or the declared
//   duration, so it would never be seen.
// - unknown_motion_token / invalid_easing: a ramp or focus ease that does not resolve to a curve.
//
// A clip range past the end of a probed clip is a render-time error (director/footage-durations.ts).

import type { TemplateDescriptor } from '../schemas/template.schemas';
import { resolveMotionDescriptor } from '@/core/motion/tokens';
import { easingError, type EasingSpec } from '@/core/motion/easing';
import { resolveTimeRefs } from '@/core/timing/resolve';
import DefaultConfig from '@/core/default.config';
import { footagePlan, type FootageOptions } from '@/core/footage/plan';
import type { ValidationError } from './validation/types';

type Bag = Record<string, unknown>;

const FOOTAGE_TYPES = new Set(['video', 'project_video']);

function keyList(value: unknown): Bag[] {
  return Array.isArray(value) ? (value as Bag[]) : [];
}

function orderErrors(keys: Bag[], field: 'at' | 't', path: string, code: string): ValidationError[] {
  return keys.flatMap((key, index) => {
    const previous = keys[index - 1]?.[field];
    const time = key[field];

    if (index === 0 || typeof time !== 'number' || typeof previous !== 'number' || time > previous) return [];

    return [
      {
        path: `${path}[${index}].${field}`,
        code,
        message: `key ${index} (${time} s) is not after key ${index - 1} (${previous} s)`,
        hint: 'list keys in time order, each strictly after the previous one',
        kind: 'judgement' as const,
      },
    ];
  });
}

function easeErrors(keys: Bag[], path: string): ValidationError[] {
  return keys.flatMap((key, index) => {
    if (key.ease === undefined) return [];

    const ease = key.ease as EasingSpec;
    const unknownToken = typeof ease === 'string' && ease.startsWith('$');
    const message = unknownToken ? `unknown motion token "${ease}"` : easingError(ease);

    if (!message) return [];

    return [
      { path: `${path}[${index}].ease`, code: unknownToken ? 'unknown_motion_token' : 'invalid_easing', message },
    ];
  });
}

// The section time a freeze must start before: the declared duration, and the edited clip end when the
// out-point fixes it (the ramped clip plus the holds laid before this freeze).
function freezeLimit(options: Bag, index: number, fps: number): number | undefined {
  const declared = typeof options.duration === 'number' ? options.duration : undefined;
  const plan = safePlan(options, fps);

  if (plan?.length === undefined) return declared;

  const holds = plan.freezes.map((freeze) => freeze.frames / fps);
  const clipEnd = plan.length - holds.reduce((a, b) => a + b, 0) + holds.slice(0, index).reduce((a, b) => a + b, 0);

  return declared === undefined ? clipEnd : Math.min(declared, clipEnd);
}

function safePlan(options: FootageOptions, fps: number) {
  try {
    return footagePlan(options, undefined, fps);
  } catch {
    return null;
  }
}

function freezeErrors(options: Bag, path: string, fps: number): ValidationError[] {
  const freezes = keyList(options.freeze);

  return freezes.flatMap((freeze, index): ValidationError[] => {
    const at = freeze.at;
    const previous = index > 0 ? freezes[index - 1] : undefined;

    if (typeof at !== 'number') return [];

    const previousEnd = typeof previous?.at === 'number' ? previous.at + Number(previous.hold) : undefined;

    if (previousEnd !== undefined && at < previousEnd) {
      return [
        {
          path: `${path}.freeze[${index}].at`,
          code: 'freeze_overlap',
          message: `freeze ${index} at ${at} s starts before freeze ${index - 1} ends at ${previousEnd} s`,
          hint: 'freeze times are on the final section timeline: start each one after the previous hold',
          suggestion: previousEnd,
          kind: 'judgement',
        },
      ];
    }

    const limit = freezeLimit(options, index, fps);

    if (limit === undefined || at < limit) return [];

    return [
      {
        path: `${path}.freeze[${index}].at`,
        code: 'freeze_outside_clip',
        message: `freeze ${index} at ${at} s is not before the end of the clip (${Number(limit.toFixed(3))} s)`,
        hint: 'move the freeze inside the clip, or lengthen the clip range / options.duration',
        kind: 'judgement',
      },
    ];
  });
}

function sectionFootageErrors(section: Bag, path: string, fps: number): ValidationError[] {
  const options = section.options as Bag | undefined;

  if (!options) return [];

  const focus = keyList(options.focus);
  const reframe = [
    ...orderErrors(focus, 't', `${path}.focus`, 'focus_keys_unordered'),
    ...easeErrors(focus, `${path}.focus`),
  ];

  if (!FOOTAGE_TYPES.has(String(section.type))) return reframe;

  const ramp = keyList(options.speedRamp);

  return [
    ...orderErrors(ramp, 'at', `${path}.speedRamp`, 'speed_ramp_unordered'),
    ...easeErrors(ramp, `${path}.speedRamp`),
    ...reframe,
    ...freezeErrors(options, path, fps),
  ];
}

export function validateFootage(template: TemplateDescriptor): ValidationError[] {
  const { descriptor } = resolveTimeRefs(resolveMotionDescriptor(template));
  const fps = descriptor.global?.fps ?? DefaultConfig.FPS;
  const sections = (descriptor.sections ?? []) as unknown as Bag[];

  return sections.flatMap((section, index) => sectionFootageErrors(section, `sections[${index}].options`, fps));
}
