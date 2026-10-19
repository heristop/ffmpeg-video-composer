// A masked composite as overlay maps (MapManager) or as one sub-graph (section sugar). The frame is split three
// ways: one copy gets the element drawn on it exactly as without a mask, one becomes a black grey canvas the
// mask source is laid on (so the mask has the frame's size and timing, and nothing outside it shows), the third
// stays untouched. The drawn copy takes the canvas as its alpha (alphamerge) and goes back over the untouched
// frame: inside the mask the element shows with its own alpha intact, outside the frame does not change. The
// canvas is placed in RGB (overlay format=rgb) so grey stays full range on every FFmpeg. Filters: split,
// format, lutyuv, overlay, alphamerge, drawbox (+ gblur for a feathered track matte): all on the allow-list.

import type { Filter, FilterGraphChain } from '@/core/types';
import { fmt } from '@/core/motion/hermite';
import { assertFiniteNumber, assertSafeColorToken } from '@/core/arg-guard';
import { assertSafePadLabel } from '../utils/filter-option-guard';
import { engineGraph } from '../utils/filter-graph';
import type { MapStep } from './clip-box';

export interface MaskSourceLeg {
  /** Pad of the source: the mask image (`<n>:v`, or its moved leg) or the matte layer's grey leg. */
  pad: string;
  /** Overlay options placing it on the canvas ("x:y…" or "x='…':y='…'…"). */
  overlay: string;
  /** Runtime blur sigma in px (track mattes; shapes are feathered at compile time). */
  blur?: number;
  invert?: boolean;
}

export interface LayerMaskRequest {
  base: string;
  leg: string;
  /** The layer's own overlay options. */
  overlay: string;
  source: MaskSourceLeg;
  /** Pad-name prefix, e.g. "card_". */
  prefix: string;
  out: string;
  /** The input's own filters, after the composite. */
  filters: Filter[];
}

export interface SectionMaskRequest {
  base: string;
  /** Resolved, filter-safe colour shown outside the mask. */
  background: string;
  source: MaskSourceLeg;
  prefix: string;
  out: string;
}

/** A solid frame of `color` with its input's size and timing. */
export function backdrop(color: string): Filter {
  return { type: 'drawbox', value: `x=0:y=0:w=iw:h=ih:color=${assertSafeColorToken(color, 'mask background')}:t=fill` };
}

const pad = assertSafePadLabel;

// The canvas from a copy of the frame, and the mask source laid on it.
function canvasSteps(from: string, source: MaskSourceLeg, p: string): MapStep[] {
  const tail: Filter[] = [
    { type: 'format', value: 'gray' },
    ...(source.blur ? [{ type: 'gblur', value: `sigma=${fmt(assertFiniteNumber(source.blur, 'mask blur'))}` }] : []),
    ...(source.invert ? [{ type: 'lutyuv', value: 'y=negval' }] : []),
  ];

  return [
    {
      inputs: [from],
      filters: [
        { type: 'format', value: 'gray' },
        { type: 'lutyuv', value: 'y=0' },
      ],
      outputs: [pad(`${p}z`)],
    },
    {
      inputs: [pad(`${p}z`), pad(source.pad)],
      filters: [{ type: 'overlay', value: `${source.overlay}:format=rgb` }, ...tail],
      outputs: [pad(`${p}m`)],
    },
  ];
}

function split3(base: string, p: string): MapStep {
  return {
    inputs: [pad(base)],
    filters: [{ type: 'split', value: '3' }],
    outputs: [pad(`${p}o`), pad(`${p}d`), pad(`${p}k`)],
  };
}

/** A layer drawn through its mask over `base`, out as `out`. */
export function layerMaskSteps(r: LayerMaskRequest): MapStep[] {
  const p = r.prefix;

  return [
    split3(r.base, p),
    { inputs: [pad(`${p}d`), pad(r.leg)], filters: [{ type: 'overlay', value: r.overlay }], outputs: [pad(`${p}c`)] },
    ...canvasSteps(pad(`${p}k`), r.source, p),
    { inputs: [pad(`${p}c`), pad(`${p}m`)], filters: [{ type: 'alphamerge' }], outputs: [pad(`${p}a`)] },
    {
      inputs: [pad(`${p}o`), pad(`${p}a`)],
      filters: [{ type: 'overlay', value: '0:0' }, ...r.filters],
      outputs: [pad(r.out)],
    },
  ];
}

/** The section clip through its mask over a solid backdrop. */
export function sectionMaskSteps(r: SectionMaskRequest): MapStep[] {
  const p = r.prefix;

  return [
    split3(r.base, p),
    { inputs: [pad(`${p}o`)], filters: [backdrop(r.background)], outputs: [pad(`${p}b`)] },
    ...canvasSteps(pad(`${p}k`), r.source, p),
    { inputs: [pad(`${p}d`), pad(`${p}m`)], filters: [{ type: 'alphamerge' }], outputs: [pad(`${p}a`)] },
    { inputs: [pad(`${p}b`), pad(`${p}a`)], filters: [{ type: 'overlay', value: '0:0' }], outputs: [pad(r.out)] },
  ];
}

/**
 * Steps as one sub-graph filter for a linear chain: the first reads the running pad, the last writes it.
 * `sources` (chains with their own inputs, e.g. an `input:<key>` image leg) go in after the first chain.
 */
export function stepsAsGraph(steps: readonly MapStep[], sources: readonly MapStep[] = []): Filter {
  if (steps.length === 0) throw new Error('[mask] a sub-graph needs at least one step');

  const last = steps.length - 1;
  const chains: FilterGraphChain[] = steps.map((step, i) => ({
    ...(i === 0 ? {} : { inputs: step.inputs }),
    filters: step.filters,
    ...(i === last ? {} : { outputs: step.outputs }),
  }));
  const extra = sources.map((step) => ({ inputs: step.inputs, filters: step.filters, outputs: step.outputs }));

  return { type: 'graph', graph: engineGraph([chains[0], ...extra, ...chains.slice(1)]) };
}
