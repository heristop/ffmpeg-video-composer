// The motion timeline: for every rendering section, every animated element with its window, curve,
// visibility and (when cheaply known) resting box. Pure, render-free and built from the same resolvers
// the lowering uses, on the token-resolved descriptor, so agents can reason about pacing before a render.

import type { Camera } from '../../schemas/camera.schemas';
import type { KineticBlock } from '../../schemas/kinetic.schemas';
import type { Graphic } from '../../schemas/graphics.schemas';
import DefaultConfig from '../default.config';
import { DEFAULT_TRANSITION_DURATION } from '../../schemas/effects.schemas';
import { resolveMotionDescriptor } from './tokens';
import { resolveTimeRefs } from '../timing/resolve';
import { resolveKeyTimes } from './tracks';
import { DEFAULT_TRANSITION_EASE, isDesignedTransition } from './transitions';
import { graphicEvent, kineticEvents } from './timeline-elements';
import { drawtextEvents, sugarEvents } from './timeline-text';
import { subtitleEvents } from './timeline-subtitles';
import type { Subtitles } from '../../schemas/subtitles.schemas';
import {
  easeKey,
  round,
  type ElementFrame,
  type MotionEvent,
  type MotionTimeline,
  type SectionTimeline,
  timeOf,
} from './timeline-model';

export type { MotionBox, MotionEvent, MotionKind, MotionTimeline, SectionTimeline } from './timeline-model';

/** Section types that put frames on the timeline. */
export const RENDERING_SECTION_TYPES = new Set([
  'video',
  'project_video',
  'color_background',
  'image_background',
  'effect',
]);
/** Seconds assumed for a section that declares no duration (its clip decides at render time). */
export const ASSUMED_SECTION_DURATION = 3;
const CAMERA_EASE = 'ease-in-out-sine';
const HIT_DECAY = 10;
/** A punch-in has visibly relaxed after this many decay constants. */
const HIT_SETTLE = 3;

type Transition = { type: string; duration?: number; ease?: string };

interface LooseSection {
  name?: string;
  type: string;
  options?: { duration?: number };
  transition?: Transition;
  camera?: Camera;
  kinetic?: KineticBlock[];
  graphics?: Graphic[];
  subtitles?: Subtitles;
  filters?: unknown[];
  motion?: Array<{ type?: string }>;
}

interface LooseDescriptor {
  global?: {
    orientation?: string;
    fps?: number;
    motion?: { energy?: number };
    transition?: Transition;
  };
  sections?: LooseSection[];
}

function frameSize(orientation: string | undefined): { width: number; height: number } {
  const scale = orientation === 'square' ? DefaultConfig.SQUARE_SCALE : DefaultConfig.SCALE;
  const [width, height] = scale.split(':').map(Number);

  return orientation === 'portrait' ? { width: height, height: width } : { width, height };
}

function cameraEvent(element: string, frame: ElementFrame, window: Partial<MotionEvent>): MotionEvent {
  return {
    path: `${frame.prefix}.${element}`,
    element: element.split('.')[0],
    kind: 'camera',
    start: 0,
    end: frame.duration,
    ease: 'linear',
    visibleFrom: 0,
    visibleUntil: frame.duration,
    entrance: false,
    text: false,
    ...window,
  };
}

function presetMove(camera: Camera, frame: ElementFrame): MotionEvent[] {
  if (!camera.preset || camera.preset === 'none' || camera.preset === 'handheld') return [];

  const start = timeOf(camera.delay);
  const end = start + (camera.duration ?? Math.max(0.1, frame.duration - start));

  return [
    cameraEvent('camera', frame, { start: round(start), end: round(end), ease: easeKey(camera.ease ?? CAMERA_EASE) }),
  ];
}

function trackMoves(camera: Camera, frame: ElementFrame): MotionEvent[] {
  return (['zoom', 'x', 'y', 'rotate'] as const).flatMap((axis) => {
    const keys = camera[axis];

    if (!keys || keys.length < 2) return [];

    const timed = resolveKeyTimes(keys);
    const ease = easeKey(timed.find((key) => key.ease !== undefined)?.ease);

    return [
      cameraEvent(`camera.${axis}`, frame, { start: round(timed[0].at), end: round(timed.at(-1)?.at ?? 0), ease }),
    ];
  });
}

function hitMoves(camera: Camera, frame: ElementFrame): MotionEvent[] {
  return (camera.hits ?? []).map((hit, index) => {
    const at = typeof hit === 'object' ? timeOf(hit.at) : timeOf(hit);
    const decay = typeof hit === 'object' ? (hit.decay ?? HIT_DECAY) : HIT_DECAY;

    return cameraEvent(`camera.hits[${index}]`, frame, {
      start: round(at),
      end: round(at + HIT_SETTLE / decay),
      ease: 'hit',
    });
  });
}

function cameraEvents(section: LooseSection, frame: ElementFrame): MotionEvent[] {
  const camera = section.camera;
  const kenburns = (section.motion ?? []).flatMap((effect, index) =>
    effect.type === 'kenburns' ? [cameraEvent(`motion[${index}]`, frame, { ease: 'kenburns', continuous: true })] : []
  );

  if (!camera) return kenburns;

  const shakes = camera.preset === 'handheld' || camera.shake;
  const shake = shakes ? [cameraEvent('camera.shake', frame, { ease: 'shake', continuous: true })] : [];

  return [
    ...presetMove(camera, frame),
    ...trackMoves(camera, frame),
    ...hitMoves(camera, frame),
    ...shake,
    ...kenburns,
  ];
}

interface Boundary {
  type: string;
  duration: number;
  ease: string;
  path: string;
}

function boundary(section: LooseSection, index: number, global: LooseDescriptor['global']): Boundary | null {
  const declared = section.transition ?? global?.transition;

  if (!declared || declared.type === 'cut') return null;

  const duration = declared.duration ?? global?.transition?.duration ?? DEFAULT_TRANSITION_DURATION;
  const ease = isDesignedTransition(declared.type) ? easeKey(declared.ease ?? DEFAULT_TRANSITION_EASE) : 'linear';
  const path = section.transition ? `sections[${index}].transition` : 'global.transition';

  return { type: declared.type, duration, ease, path };
}

function transitionEvent(edge: Boundary, start: number, end: number, element: string): MotionEvent {
  return {
    path: edge.path,
    element,
    kind: 'transition',
    start: round(start),
    end: round(end),
    ease: edge.ease,
    visibleFrom: round(start),
    visibleUntil: round(end),
    entrance: false,
    text: false,
    preset: edge.type,
  };
}

interface SectionInput {
  section: LooseSection;
  index: number;
  outgoing: Boundary | null;
  incoming: Boundary | null;
}

function sectionTimeline(input: SectionInput, base: Omit<ElementFrame, 'duration' | 'prefix'>): SectionTimeline {
  const { section, index, outgoing, incoming } = input;
  // A length still in beats (the grid awaits the music analysis) counts as unknown.
  const declared = typeof section.options?.duration === 'number' ? section.options.duration : undefined;
  const duration = declared ?? ASSUMED_SECTION_DURATION;
  const frame: ElementFrame = { ...base, duration, prefix: `sections[${index}]` };
  const events = [
    ...(incoming ? [transitionEvent(incoming, 0, Math.min(incoming.duration, duration), 'transition-in')] : []),
    ...sugarEvents(section as Parameters<typeof sugarEvents>[0], frame),
    ...drawtextEvents(section.filters, frame),
    ...(section.kinetic ?? []).flatMap((block, k) => kineticEvents(block, k, frame)),
    ...(section.graphics ?? []).map((graphic, k) => graphicEvent(graphic, k, frame)),
    ...subtitleEvents(section.subtitles, frame),
    ...cameraEvents(section, frame),
    ...(outgoing ? [transitionEvent(outgoing, Math.max(0, duration - outgoing.duration), duration, 'transition')] : []),
  ];

  return {
    index,
    name: section.name ?? `section ${index}`,
    type: section.type,
    duration,
    durationKnown: declared !== undefined,
    ...(outgoing && { transition: { type: outgoing.type, duration: outgoing.duration, ease: outgoing.ease } }),
    events: events.sort((a, b) => a.start - b.start),
  };
}

/** Every animated element of every rendering section, on section-local seconds. */
export function motionTimeline(descriptor: unknown): MotionTimeline {
  const resolved = resolveTimeRefs(resolveMotionDescriptor(descriptor as LooseDescriptor & { meta?: unknown }), {
    deferBeatsAnalysis: true,
  }).descriptor;
  const global = resolved.global;
  const size = frameSize(global?.orientation);
  const base = { ...size, fps: global?.fps ?? DefaultConfig.FPS, energy: global?.motion?.energy ?? 1 };
  const rendering = (resolved.sections ?? [])
    .map((section, index) => ({ section, index }))
    .filter(({ section }) => RENDERING_SECTION_TYPES.has(section.type));
  const edges = rendering.map((entry, i) =>
    i < rendering.length - 1 ? boundary(entry.section, entry.index, global) : null
  );
  const sections = rendering.map((entry, i) =>
    sectionTimeline({ ...entry, outgoing: edges[i], incoming: i > 0 ? edges[i - 1] : null }, base)
  );

  return { ...size, fps: base.fps, sections };
}
