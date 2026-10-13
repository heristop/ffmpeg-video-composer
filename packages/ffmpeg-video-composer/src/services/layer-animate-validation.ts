// invalid_keyframes findings for a layer input's tracks (inputs[].options.animate, lowered by
// editor/presets/layer-keyframes.ts): tracks on an input that is not a layer, relative keys where only an
// absolute value means something, values out of range, a scale/rotate track on a layer whose box is
// unknown, and the key timing rules every track shares (motion-validation.ts).

import type { TrackKey } from '@/core/motion/tracks';
import { LAYER_TRANSFORM_TRACKS } from '../schemas/layer-animate.schemas';
import type { ValidationError } from './validation/types';

/** Where a layer's tracks sit: `sections[i].inputs[j].options.animate`. */
export const LAYER_ANIMATE_PATH = /^sections\[(\d+)\]\.inputs\[(\d+)\]\.options\.animate$/;

const LAYER_TYPES = new Set(['image', 'animation', 'html']);

const RANGES: Record<string, readonly [number, number]> = {
  opacity: [0, 1],
  scale: [0, 10],
  scaleX: [0, 10],
  scaleY: [0, 10],
};

type Bag = Record<string, unknown>;

// The layer box the transforms scale and turn about: an html layer's width/height, or a pixel scale.
function hasBox(input: Bag): boolean {
  const scale = (input.options as Bag | undefined)?.scale;

  return input.type === 'html' || (typeof scale === 'string' && /^\s*[1-9]\d*\s*:\s*[1-9]\d*\s*$/.test(scale));
}

function valueError(axis: string, keys: TrackKey[]): string | null {
  if (!Object.hasOwn(RANGES, axis)) return null;

  const range = RANGES[axis];

  if (keys.some((key) => typeof key.v === 'string')) return `${axis} keys take plain numbers, not relative offsets`;

  const out = keys.find((key) => (key.v as number) < range[0] || (key.v as number) > range[1]);

  return out ? `${axis} keys take values from ${range[0]} to ${range[1]} (got ${String(out.v)})` : null;
}

function boxError(axis: string, input: Bag): ValidationError | null {
  if (!(LAYER_TRANSFORM_TRACKS as readonly string[]).includes(axis) || hasBox(input)) return null;

  return {
    path: '',
    message: `a ${axis} track needs the layer size: set options.scale to "W:H" pixels`,
    code: 'invalid_keyframes',
    hint: 'Give the layer a pixel box, e.g. options.scale "240:120", so it can scale and turn about its origin.',
    kind: 'judgement',
  };
}

/**
 * The findings of one layer input's `animate`. `timingError` checks a track's key times (shared with the
 * drawtext tracks) and returns null when they are in order.
 */
export function layerAnimateErrors(
  path: string,
  animate: Record<string, TrackKey[]>,
  input: Bag,
  timingError: (keys: TrackKey[]) => string | null
): ValidationError[] {
  if (!LAYER_TYPES.has(String(input.type))) {
    return [{ path, message: 'animate tracks apply to image, animation and html inputs', code: 'invalid_keyframes' }];
  }

  return Object.entries(animate).flatMap(([axis, keys]) => {
    const at = `${path}.${axis}`;
    const box = boxError(axis, input);

    if (box) return [{ ...box, path: at }];

    const message = valueError(axis, keys) ?? timingError(keys);

    return message ? [{ path: at, message, code: 'invalid_keyframes' }] : [];
  });
}
