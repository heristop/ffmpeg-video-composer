// Layer inputs on the motion timeline: an image, animation or html input with keyframe tracks
// (options.animate) is one `animate` event from its first key to its last, visible over the layer's
// start/duration window.

import { resolveKeyTimes, type TrackKey } from './tracks';
import { easeKey, round, type ElementFrame, type MotionEvent } from './timeline-model';

interface LayerInput {
  type?: string;
  options?: { start?: number; duration?: number; animate?: Record<string, TrackKey[] | undefined> };
}

function layerEvent(input: LayerInput, index: number, frame: ElementFrame): MotionEvent[] {
  const timed = Object.values(input.options?.animate ?? {})
    .filter((keys): keys is TrackKey[] => Array.isArray(keys))
    .map((keys) => resolveKeyTimes(keys));
  const times = timed.flatMap((keys) => keys.map((key) => key.at));

  if (times.length === 0) return [];

  const from = input.options?.start ?? 0;
  const until = input.options?.duration === undefined ? frame.duration : from + input.options.duration;

  return [
    {
      path: `${frame.prefix}.inputs[${index}].options.animate`,
      element: `inputs[${index}]`,
      kind: 'animate',
      start: round(Math.min(...times)),
      end: round(Math.max(...times)),
      ease: easeKey(timed.flat().find((key) => key.ease !== undefined)?.ease),
      visibleFrom: round(from),
      visibleUntil: round(Math.min(until, frame.duration)),
      // A track may move a layer that is already on screen: not counted as an entrance.
      entrance: false,
      text: false,
    },
  ];
}

/** The keyframed layer inputs of a section. */
export function layerEvents(inputs: unknown[] | undefined, frame: ElementFrame): MotionEvent[] {
  return (inputs ?? []).flatMap((input, index) => layerEvent(input as LayerInput, index, frame));
}
