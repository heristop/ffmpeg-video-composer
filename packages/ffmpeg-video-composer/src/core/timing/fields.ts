// Where time references may appear inside a section, and the elements they can name. Both walk a plain
// section object; the slots write back in place, so callers walk a clone.

import { LAYER_TRACKS } from '../../schemas/layer-animate.schemas';
import { ELEMENT_MOTION_TRACKS } from '../html/limits';

type Bag = Record<string, unknown>;

/** A time field holding a string that may be a reference. */
export interface TimeSlot {
  path: string;
  value: string;
  /** Id of the element this field starts, so a self-reference reads as a cycle. */
  owner?: string;
  /** Seconds the field's own clock starts after the section (an html layer's `options.start`): a resolved reference is section time, written back relative to it. */
  clockStart?: number;
  write: (seconds: number) => void;
}

/** An element other fields can reference as "<id>.start" / "<id>.end". */
export interface ElementEntry {
  id: string;
  kind: 'kinetic' | 'graphic' | 'drawtext';
  /** Path of the field that sets its start. */
  path: string;
  /** The raw start (seconds, a reference, or undefined for the default). */
  start: unknown;
  node: Bag;
}

function bag(value: unknown): Bag | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Bag) : undefined;
}

function list(value: unknown): Bag[] {
  return Array.isArray(value) ? value.map((item) => bag(item) ?? {}) : [];
}

/** A time field holding plain seconds (the fields a partial `duration` remaps). */
export interface SecondsSlot {
  path: string;
  value: number;
  /** Seconds the field's own clock starts after the section (an html layer's `options.start`). */
  clockStart?: number;
  write: (seconds: number) => void;
}

// One walk serves both slot kinds: `accept` picks which raw values count (reference strings, or plain
// numbers), so the list of time fields lives in one place.
type Accept = (value: unknown) => boolean;
type RawSlot = { path: string; value: unknown; owner?: string; clockStart?: number; write: (seconds: number) => void };

function slot(accept: Accept, owner: Bag | undefined, key: string, path: string, id?: string): RawSlot[] {
  const value = owner?.[key];

  if (!accept(value) || !owner) return [];

  return [{ path: `${path}.${key}`, value, owner: id, write: (seconds) => (owner[key] = seconds) }];
}

function idOf(node: Bag): string | undefined {
  return typeof node.id === 'string' ? node.id : undefined;
}

function trackSlots(accept: Accept, tracks: Bag | undefined, keys: readonly string[], path: string): RawSlot[] {
  return keys.flatMap((axis) =>
    list(tracks?.[axis]).flatMap((key, k) => slot(accept, key, 't', `${path}.${axis}[${k}]`))
  );
}

function hitSlots(accept: Accept, camera: Bag): RawSlot[] {
  const hits = Array.isArray(camera.hits) ? (camera.hits as unknown[]) : [];

  return hits.flatMap((hit, k) => {
    const path = `camera.hits[${k}]`;

    if (bag(hit)) return slot(accept, bag(hit), 'at', path);

    return accept(hit) ? [{ path, value: hit, write: (seconds: number) => (hits[k] = seconds) }] : [];
  });
}

function cameraSlots(accept: Accept, camera: Bag | undefined): RawSlot[] {
  if (!camera) return [];

  return [
    ...slot(accept, camera, 'delay', 'camera'),
    ...hitSlots(accept, camera),
    ...trackSlots(accept, camera, ['zoom', 'x', 'y', 'rotate'], 'camera'),
  ];
}

function filterSlots(accept: Accept, filter: Bag, path: string): RawSlot[] {
  const owner = filter.type === 'drawtext' ? idOf(filter) : undefined;

  return [
    ...slot(accept, bag(filter.reveal), 'delay', `${path}.reveal`, owner),
    ...slot(accept, bag(filter.exit), 'after', `${path}.exit`),
    ...trackSlots(accept, bag(filter.animate), ['x', 'y', 'opacity', 'scale'], `${path}.animate`),
  ];
}

// Footage edits (options.speedRamp keys, freeze frames, focus keyframes): section-time fields. A preset
// ramp or an anchor focus is a string that is not a list, so it holds no slot.
function footageSlots(accept: Accept, options: Bag | undefined): RawSlot[] {
  return [
    ...list(options?.speedRamp).flatMap((key, k) => slot(accept, key, 'at', `options.speedRamp[${k}]`)),
    ...list(options?.freeze).flatMap((freeze, k) => slot(accept, freeze, 'at', `options.freeze[${k}]`)),
    ...list(options?.focus).flatMap((key, k) => slot(accept, key, 't', `options.focus[${k}]`)),
  ];
}

// Audio and captions placed in section time: subtitle cues, cutaways, sfx and volume automation keys.
function cueSlots(accept: Accept, section: Bag): RawSlot[] {
  return [
    ...list(bag(section.subtitles)?.cues).flatMap((cue, i) => [
      ...slot(accept, cue, 'at', `subtitles.cues[${i}]`),
      ...slot(accept, cue, 'end', `subtitles.cues[${i}]`),
    ]),
    ...list(section.cutaways).flatMap((cutaway, i) => slot(accept, cutaway, 'at', `cutaways[${i}]`)),
    ...list(section.sfx).flatMap((cue, i) => slot(accept, cue, 'at', `sfx[${i}]`)),
    ...list(bag(section.options)?.audioAutomation).flatMap((key, i) =>
      slot(accept, key, 'at', `options.audioAutomation[${i}]`)
    ),
  ];
}

// An html input's element tracks (inputs[i].motion.<name>.<track>[k].t) run on the layer's clock, which
// starts at options.start; a reference still names a section moment, so its slot carries that start.
function elementMotionSlots(accept: Accept, input: Bag, i: number): RawSlot[] {
  const motion = input.type === 'html' ? bag(input.motion) : undefined;
  const start = Number(bag(input.options)?.start);
  const clockStart = Number.isFinite(start) && start > 0 ? start : 0;

  return Object.entries(motion ?? {})
    .flatMap(([name, spec]) => trackSlots(accept, bag(spec), ELEMENT_MOTION_TRACKS, `inputs[${i}].motion.${name}`))
    .map((found) => ({ ...found, clockStart }));
}

function collectSlots(section: Bag, accept: Accept): RawSlot[] {
  return [
    ...footageSlots(accept, bag(section.options)),
    ...list(section.kinetic).flatMap((block, i) => [
      ...slot(accept, block, 'delay', `kinetic[${i}]`, idOf(block)),
      ...slot(accept, bag(block.exit), 'at', `kinetic[${i}].exit`),
    ]),
    ...list(section.graphics).flatMap((g, i) => [
      ...slot(accept, g, 'at', `graphics[${i}]`, idOf(g)),
      ...slot(accept, g, 'until', `graphics[${i}]`),
    ]),
    ...cameraSlots(accept, bag(section.camera)),
    ...list(section.filters).flatMap((filter, i) => filterSlots(accept, filter, `filters[${i}]`)),
    ...list(section.inputs).flatMap((input, i) => [
      ...trackSlots(accept, bag(bag(input.options)?.animate), LAYER_TRACKS, `inputs[${i}].options.animate`),
      ...elementMotionSlots(accept, input, i),
    ]),
    ...cueSlots(accept, section),
  ];
}

function isString(value: unknown): boolean {
  return typeof value === 'string';
}

function isSeconds(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Every time field of the section that holds a string. */
export function timeSlots(section: Bag): TimeSlot[] {
  return collectSlots(section, isString) as TimeSlot[];
}

/**
 * Every time field of the section that holds plain seconds, plus the `visibleBy.at` of its assertions
 * (section-local seconds too).
 */
export function secondsSlots(section: Bag): SecondsSlot[] {
  const asserts = list(section.assert).flatMap((entry, i) =>
    slot(isSeconds, bag(entry.visibleBy), 'at', `assert[${i}].visibleBy`)
  );

  // A layer's own start is a section moment, so it remaps like any other.
  const layerStarts = list(section.inputs).flatMap((input, i) =>
    slot(isSeconds, bag(input.options), 'start', `inputs[${i}].options`)
  );

  return [...collectSlots(section, isSeconds), ...asserts, ...layerStarts] as SecondsSlot[];
}

/** Every element of the section that carries an id, in document order. */
export function sectionElements(section: Bag): ElementEntry[] {
  const kinetic = list(section.kinetic).map((node, i) => ({
    kind: 'kinetic' as const,
    node,
    path: `kinetic[${i}].delay`,
    start: node.delay,
  }));
  const graphics = list(section.graphics).map((node, i) => ({
    kind: 'graphic' as const,
    node,
    path: `graphics[${i}].at`,
    start: node.at,
  }));
  const drawtext = list(section.filters)
    .map((node, i) => ({
      kind: 'drawtext' as const,
      node,
      path: `filters[${i}].reveal.delay`,
      start: bag(node.reveal)?.delay,
    }))
    .filter((entry) => entry.node.type === 'drawtext');

  return [...kinetic, ...graphics, ...drawtext].flatMap((entry) => {
    const id = idOf(entry.node);

    return id === undefined ? [] : [{ ...entry, id }];
  });
}
