// A layer blended over the picture (inputs[].options.blend). FFmpeg's blend filter treats alpha as a fourth
// colour plane, so blending the layer straight onto the frame would mix its transparent pixels too (a black
// box under multiply). Instead the layer is laid, by overlay, onto a transparent gbrap copy of the frame: the
// copy keeps the layer's own colour and alpha (overlay un-premultiplies onto an empty canvas). blend then
// computes f(layer, picture) on the colour planes in RGB and keeps the layer's alpha (c3 normal at opacity 1),
// and a plain overlay lays that result back: picture·(1−a) + f·a, exact at half-transparent edges.

import { assertSafeExpression } from '../../core/arg-guard';
import type { BlendMode } from '../../schemas/layer-composite.schemas';
import { assertSafePadLabel } from '../utils/filter-option-guard';

/** FFmpeg blend mode per LeClap mode, the layer being the top input. */
export const BLEND_FILTER_MODES: Record<Exclude<BlendMode, 'normal'>, string> = {
  multiply: 'multiply',
  screen: 'screen',
  // Design-tool overlay is conditioned on the picture beneath. FFmpeg's `overlay` mode is conditioned on the
  // top input (CSS hard light); with the layer on top, CSS overlay is FFmpeg's `hardlight`.
  overlay: 'hardlight',
  add: 'addition',
  darken: 'darken',
  lighten: 'lighten',
  difference: 'difference',
};

export const BLEND_UNAVAILABLE_WARNING =
  '[blend_unavailable] blend modes need the blend filter, absent from this FFmpeg build: the layer is composited normally';

export interface BlendOver {
  base: string;
  leg: string;
  /** The overlay options that place the layer (position, eof_action, enable). */
  overlay: string;
  mode: BlendMode;
  /** Pad prefix of the intermediate pads. */
  prefix: string;
  out: string;
}

const OPTION = /^[A-Za-z_]+=[A-Za-z0-9_.+\-*/%^()]+$/;

// The overlay options are built by the engine but spliced unquoted into the graph: the "x:y" position goes
// through the expression guard, each further option must be a plain key=value.
function guardOverlay(overlay: string): string {
  const parts = overlay.split(':');
  const position = assertSafeExpression(parts.slice(0, 2).join(':'), 'overlay position', 2);
  const options = parts.slice(2);

  for (const option of options) {
    if (!OPTION.test(option)) throw new Error(`Unsafe overlay option "${option}"`);
  }

  return [position, ...options].join(':');
}

function filterMode(mode: BlendMode): string {
  if (!Object.hasOwn(BLEND_FILTER_MODES, mode)) throw new Error(`Unknown blend mode "${mode}"`);

  return BLEND_FILTER_MODES[mode as Exclude<BlendMode, 'normal'>];
}

/** The chains that composite `leg` over `base` into `out`. */
export function blendOver(request: BlendOver): string[] {
  const { base, leg, mode, out } = request;
  const p = assertSafePadLabel(request.prefix);
  const overlay = guardOverlay(request.overlay);

  for (const label of [base, leg, out]) assertSafePadLabel(label);

  if (mode === 'normal') return [`[${base}][${leg}]overlay=${overlay}[${out}]`];

  const m = filterMode(mode);

  return [
    `[${base}]split=3[${p}b0][${p}b1][${p}b2]`,
    `[${p}b1]format=gbrap,colorchannelmixer=rr=0:gg=0:bb=0:aa=0[${p}cv]`,
    `[${p}cv][${leg}]overlay=${overlay}:format=gbrp[${p}ly]`,
    `[${p}b2]format=gbrap[${p}ba]`,
    `[${p}ly][${p}ba]blend=c0_mode=${m}:c1_mode=${m}:c2_mode=${m}:c3_mode=normal:c3_opacity=1[${p}mx]`,
    `[${p}b0][${p}mx]overlay=0:0:format=auto[${out}]`,
  ];
}
