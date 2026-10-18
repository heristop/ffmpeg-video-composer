// A layer with a blend mode and/or motion blur (inputs[].options.blend / motionBlur), as the one filtergraph
// MapManager splices in place of its plain overlay map. With motion blur, the layer's input is split into the
// sharp leg and one supersampled leg per moving span, each conformed to the section rate first so its clock
// starts on the same frame as the base's; the base is split the same way. The sharp composite runs every
// frame; each span's composite runs on the shutter clock (motion-blur.ts), is averaged back and laid over
// the sharp result for the span's frames only. Null when neither feature applies on this build.

import { fmt } from '@/core/motion/hermite';
import type Segment from '../../core/models/Segment';
import type { Filter, MapAnimationInput } from '@/core/types';
import type { LayerAnimate } from '../../schemas/layer-animate.schemas';
import { resolveMotionBlur, type BlendMode, type ResolvedMotionBlur } from '../../schemas/layer-composite.schemas';
import { assertSafePadLabel } from '../utils/filter-option-guard';
import { BLEND_FILTER_MODES, BLEND_UNAVAILABLE_WARNING, blendOver } from './layer-blend';
import { blurGate, blurHead, blurPad, blurRebase, blurTail, planBlur, type BlurPlan } from './motion-blur';
import { clipSpans, layerSpans } from './motion-spans';

export interface LayerCompositeRequest {
  /** The input name: pad prefix and the output pad. */
  name: string;
  base: string;
  /** The layer's raw input stream, e.g. "3:v". */
  raw: string;
  /** The sharp leg's filters (MapManager.overlayPlan). */
  legFilters: string[];
  /** Overlay options that place the layer (position or x/y expressions, eof_action, enable). */
  overlay: string;
  blend: BlendMode;
  motionBlur: ResolvedMotionBlur | null;
  animate: LayerAnimate | undefined;
  fps: number;
  /** The section's length in seconds, when known: motion keyed past it is not budgeted. */
  duration?: number;
  /** The input's own filters, rendered, after the composite. */
  tail: string[];
  has: (filter: string) => boolean;
  warn: (message: string) => void;
}

function pads(prefix: string, count: number): string {
  return Array.from({ length: count }, (_, i) => `[${prefix}${i}]`).join('');
}

function modeOf(request: LayerCompositeRequest): BlendMode {
  const { blend } = request;

  if (blend === 'normal') return blend;

  if (!Object.hasOwn(BLEND_FILTER_MODES, blend)) throw new Error(`Unknown blend mode "${blend}"`);

  if (request.has('blend')) return blend;

  request.warn(BLEND_UNAVAILABLE_WARNING);

  return 'normal';
}

function blurOf(request: LayerCompositeRequest): BlurPlan | null {
  if (request.motionBlur === null) return null;

  const spans = clipSpans(layerSpans(request.animate, request.fps), Math.ceil((request.duration ?? 0) * request.fps));

  return planBlur(spans, request.motionBlur, request.fps, request);
}

function legChains(request: LayerCompositeRequest, blur: BlurPlan | null): string[] {
  const p = request.name;
  const sharp = request.legFilters.length > 0 ? request.legFilters.join(',') : 'null';

  if (blur === null) return [`[${request.raw}]${sharp}[${p}_src]`];

  const transforms = request.legFilters.filter((filter, i) => !(i === 0 && filter.startsWith('fps=')));

  return [
    `[${request.raw}]split=${blur.spans.length + 1}${pads(`${p}_cl`, blur.spans.length + 1)}`,
    `[${p}_cl0]${sharp}[${p}_src]`,
    ...blur.spans.map((span, k) => {
      const filters = [`fps=${fmt(request.fps)}`, ...blurHead(span, blur.shutter), ...transforms];

      return `[${p}_cl${k + 1}]${filters.join(',')}[${p}_lb${k}]`;
    }),
  ];
}

// The base copy of span k, ahead of its blurred branch: split off the frames before the span when it starts
// late (see blurPad), joined back in front of the averaged frames.
function spanLead(request: LayerCompositeRequest, blur: BlurPlan, k: number): { pre: string[]; head: string } {
  const p = request.name;
  const pad = blurPad(blur.spans[k], blur.shutter);

  if (pad.length === 0) return { pre: [], head: `${p}_cb${k + 1}` };

  return {
    pre: [`[${p}_cb${k + 1}]split=2[${p}_cp${k}][${p}_cq${k}]`, `[${p}_cp${k}]${pad.join(',')}[${p}_pp${k}]`],
    head: `${p}_cq${k}`,
  };
}

function spanTail(request: LayerCompositeRequest, blur: BlurPlan, k: number, padded: boolean): string[] {
  const p = request.name;
  const tail = blurTail(blur.shutter);

  if (!padded) return [`[${p}_bc${k}]${tail.join(',')}[${p}_bt${k}]`];

  return [
    `[${p}_bc${k}]${[...tail, blurRebase].join(',')}[${p}_bq${k}]`,
    `[${p}_pp${k}][${p}_bq${k}]concat=n=2:v=1:a=0[${p}_bt${k}]`,
  ];
}

function blurChains(request: LayerCompositeRequest, blur: BlurPlan, mode: BlendMode): string[] {
  const p = request.name;

  return blur.spans.flatMap((span, k) => {
    const lead = spanLead(request, blur, k);

    return [
      ...lead.pre,
      `[${lead.head}]${blurHead(span, blur.shutter).join(',')}[${p}_bh${k}]`,
      ...blendOver({
        base: `${p}_bh${k}`,
        leg: `${p}_lb${k}`,
        overlay: request.overlay,
        mode,
        prefix: `${p}_m${k}`,
        out: `${p}_bc${k}`,
      }),
      ...spanTail(request, blur, k, lead.pre.length > 0),
      `[${k === 0 ? `${p}_sharp` : `${p}_mg${k - 1}`}][${p}_bt${k}]overlay=0:0:eof_action=pass:${blurGate(span, blur.shutter)}[${p}_mg${k}]`,
    ];
  });
}

function sharpChains(request: LayerCompositeRequest, count: number, mode: BlendMode): string[] {
  const p = request.name;
  const split = count === 0 ? [] : [`[${request.base}]split=${count + 1}${pads(`${p}_cb`, count + 1)}`];
  const base = count === 0 ? request.base : `${p}_cb0`;

  return [
    ...split,
    ...blendOver({ base, leg: `${p}_src`, overlay: request.overlay, mode, prefix: `${p}_s`, out: `${p}_sharp` }),
  ];
}

/** The layer's composite graph, or null when the plain overlay map should run. */
export function layerComposite(request: LayerCompositeRequest): string | null {
  for (const label of [request.name, request.base, request.raw]) assertSafePadLabel(label);

  const mode = modeOf(request);
  const blur = blurOf(request);

  if (mode === 'normal' && blur === null) return null;

  const count = blur?.spans.length ?? 0;
  const last = count === 0 ? `${request.name}_sharp` : `${request.name}_mg${count - 1}`;
  const tail = request.tail.length > 0 ? request.tail.join(',') : 'null';

  return [
    ...legChains(request, blur),
    ...sharpChains(request, count, mode),
    ...(blur ? blurChains(request, blur, mode) : []),
    `[${last}]${tail}[${request.name}]`,
  ].join(';');
}

/** What MapManager hands over for one animation input; the FilterManager supplies rate, build and rendering. */
export interface CompositeContext {
  input: MapAnimationInput;
  inputIndex: number;
  base: string;
  legFilters: string[];
  overlay: string;
  segment: Pick<Segment, 'filtersMapList' | 'mapsList'>;
  filters: {
    frameRate: () => number;
    /** The section's length in seconds, when known. */
    sectionDuration?: () => number;
    supports: (filter: string) => boolean;
    advise: (message: string) => void;
    addFilter: (filter: Filter) => string;
  };
}

/** Splices an input's composite graph into the segment; false when the plain overlay map should run. */
export function compositeLayer(context: CompositeContext): boolean {
  const { input, filters, segment } = context;
  const blend = input.options.blend ?? 'normal';
  const motionBlur = resolveMotionBlur(input.options.motionBlur);

  // A plain layer never reaches the FilterManager here: its overlay map renders the input filters itself.
  if (blend === 'normal' && motionBlur === null) return false;

  const graph = layerComposite({
    name: input.name,
    base: context.base,
    raw: `${context.inputIndex}:v`,
    legFilters: context.legFilters,
    overlay: context.overlay,
    blend,
    motionBlur,
    animate: input.options.animate,
    fps: filters.frameRate(),
    duration: filters.sectionDuration?.(),
    tail: (input.filters ?? []).map((filter) => filters.addFilter(filter)),
    has: filters.supports,
    warn: filters.advise,
  });

  if (graph === null) return false;

  segment.filtersMapList.push(graph);
  segment.mapsList.push(input.name);

  return true;
}
