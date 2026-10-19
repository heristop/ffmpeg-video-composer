// Clip boxes (schemas/clip.schemas.ts): an element drawn only inside a box, on any background.
//
// The frame is split; the element is drawn on one copy exactly as it would be (same filters, same
// coordinates), that copy is cropped to the box and laid back over the untouched frame at the box. Inside
// the box the result is the element over the frame; outside it the frame is untouched, so nothing of the
// element ever shows past the box, whatever moves underneath it (footage included). Several boxes (one per
// line) each take their own copy with only their own draws. Filters: split, crop, overlay (+ the element's
// own): all on the on-device allowlist. The box is widened to even pixels (4:2:0 chroma).

import type { Filter, FilterGraphChain } from '@/core/types';
import type { ClipBox } from '../../schemas/clip.schemas';
import { assertFiniteNumber } from '@/core/arg-guard';

export interface ClipPart {
  box: ClipBox;
  /** The element's filters drawn inside this box (graph filters allowed). */
  filters: Filter[];
}

/** The authored clip box, every number coerced (library callers skip validation). */
export function finiteBox(clip: ClipBox): ClipBox {
  return {
    x: assertFiniteNumber(clip.x, 'clip x'),
    y: assertFiniteNumber(clip.y, 'clip y'),
    w: assertFiniteNumber(clip.w, 'clip w'),
    h: assertFiniteNumber(clip.h, 'clip h'),
  };
}

/** The box snapped outwards to even pixels and clamped to the frame; null when nothing of it is on screen. */
export function evenBox(box: ClipBox, width: number, height: number): ClipBox | null {
  const x0 = Math.max(0, 2 * Math.floor(box.x / 2));
  const y0 = Math.max(0, 2 * Math.floor(box.y / 2));
  const x1 = Math.min(width, 2 * Math.ceil((box.x + box.w) / 2));
  const y1 = Math.min(height, 2 * Math.ceil((box.y + box.h) / 2));

  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/**
 * The chains that draw `filters` from pad `from` to pad `to`, flattening sub-graph filters (their first
 * chain reads the running pad, their last writes the next one).
 */
export function chainsThrough(filters: Filter[], from: string, to: string, prefix: string): FilterGraphChain[] {
  const chains: FilterGraphChain[] = [];
  let current = from;
  let run: Filter[] = [];

  for (const filter of filters) {
    if (!filter.graph) {
      run.push(filter);

      continue;
    }

    if (run.length > 0) {
      const out = `${prefix}s${chains.length}`;
      chains.push(linear(current, run, out));
      [current, run] = [out, []];
    }

    const out = `${prefix}s${chains.length}`;
    chains.push(...spliced(filter.graph, current, out));
    current = out;
  }

  chains.push(linear(current, run, to));

  return chains;
}

function linear(from: string, filters: Filter[], to: string): FilterGraphChain {
  return { inputs: [from], filters: filters.length > 0 ? filters : [{ type: 'null' }], outputs: [to] };
}

// A sub-graph read from `from` (its first chain) and written to `to` (its last).
function spliced(graph: FilterGraphChain[], from: string, to: string): FilterGraphChain[] {
  return graph.map((chain, i) => ({
    ...chain,
    ...(i === 0 ? { inputs: [from, ...(chain.inputs ?? [])] } : {}),
    ...(i === graph.length - 1 ? { outputs: [to] } : {}),
  }));
}

/** The parts, each cut to its box, as one sub-graph filter (nothing when no box is on screen). */
export function clipParts(parts: ClipPart[], frame: { width: number; height: number }, prefix: string): Filter[] {
  const visible = parts.flatMap((part) => {
    const box = evenBox(part.box, frame.width, frame.height);

    return box && part.filters.length > 0 ? [{ ...part, box }] : [];
  });

  if (visible.length === 0) return [];

  const copies = visible.map((_, i) => `${prefix}d${i}`);
  const chains: FilterGraphChain[] = [
    { filters: [{ type: 'split', value: String(visible.length + 1) }], outputs: [`${prefix}o`, ...copies] },
  ];

  for (const [i, part] of visible.entries()) {
    const drawn = `${prefix}e${i}`;
    const { x, y, w, h } = part.box;

    chains.push(...chainsThrough(part.filters, copies[i], drawn, `${prefix}${i}`));
    chains.push({
      inputs: [drawn],
      filters: [{ type: 'crop', value: `${w}:${h}:${x}:${y}` }],
      outputs: [`${prefix}c${i}`],
    });
  }

  for (const [i, part] of visible.entries()) {
    const base = i === 0 ? `${prefix}o` : `${prefix}v${i}`;
    const last = i === visible.length - 1;

    chains.push({
      inputs: [base, `${prefix}c${i}`],
      filters: [{ type: 'overlay', value: `${part.box.x}:${part.box.y}` }],
      ...(last ? {} : { outputs: [`${prefix}v${i + 1}`] }),
    });
  }

  return [{ type: 'graph', graph: chains }];
}

/** One overlay map MapManager emits (inputs → filters → outputs), never with the section filters. */
export interface MapStep {
  inputs: string[];
  filters: Filter[];
  outputs: string[];
}

/** A layer about to be cut: the base it composites onto, its leg, its overlay options, its pad and filters. */
export interface CutIO {
  base: string;
  leg: string;
  overlay: string;
  name: string;
  filters: Filter[];
}

/** The frame size a "W:H" scale names; unknown (no section scale): unbounded, the box is taken as authored. */
export function frameSize(videoScale: string): [number, number] {
  return /^\d+:\d+$/.test(videoScale) ? (videoScale.split(':').map(Number) as [number, number]) : [Infinity, Infinity];
}

/**
 * A layer cut to a box as maps: overlaid on a copy of the frame as usual, the copy cropped to the box and laid
 * back over the untouched frame. A box off the frame (null) shows nothing, but the registered leg must still be
 * consumed (an unconnected output aborts the graph): an overlay that never enables passes the frame through.
 */
export function clipBoxSteps(io: CutIO, box: ClipBox | null): MapStep[] {
  if (!box) {
    return [
      {
        inputs: [io.base, io.leg],
        filters: [{ type: 'overlay', value: '0:0:enable=0' }, ...io.filters],
        outputs: [io.name],
      },
    ];
  }

  const crop = `${box.w}:${box.h}:${box.x}:${box.y}`;

  return [
    { inputs: [io.base], filters: [{ type: 'split', value: '2' }], outputs: [`${io.name}_cb`, `${io.name}_cd`] },
    {
      inputs: [`${io.name}_cd`, io.leg],
      filters: [
        { type: 'overlay', value: io.overlay },
        { type: 'crop', value: crop },
      ],
      outputs: [`${io.name}_cc`],
    },
    {
      inputs: [`${io.name}_cb`, `${io.name}_cc`],
      filters: [{ type: 'overlay', value: `${box.x}:${box.y}` }, ...io.filters],
      outputs: [io.name],
    },
  ];
}
