// fx "resolve": a logo or title resolves into place (schemas/fx-surface.schemas.ts for the fields).
//
// The kit hands the effect two copies of the target region. The first becomes the GLOW: the region under a
// heavy blur, what the element dissolves into. The second is the element resolving: zoompan settles it from
// `scale` to 1 (an exact sub-pixel zoom, so the edges never step by a whole pixel), a run of gblur filters steps
// its defocus from `blur` to 0 one frame at a time on the eased curve (enable windows, merged where the
// radius repeats: never fewer steps than frames, so no step is visible), and its alpha fades in over the
// first `fade` of the pass. Both are feathered into the frame by a soft rounded mask sprite, so the
// processed rectangle never shows an edge. The glow holds from the section start (the element is hidden
// until `at`), so the effect owns the element's entrance. A text target resolves on its block's box,
// widened by the blur reach (never the glyph mask, which would cut the defocus). Reduced motion: a plain
// cross-fade from the glow to the element. Filters: split, gblur, setpts, scale, zoompan, format, alphamerge, fade
// (on-device allowlist); without zoompan there is no scale, without alphamerge no feather.

import type { Filter, FilterGraphChain } from '@/core/types';
import { parseEasing } from '@/core/motion/easing';
import { fmt } from '@/core/motion/hermite';
import { exactZoomFilterObjects, ZOOM_TIME } from '@/core/motion/zoom-exact';
import { mergeRuns, sampleSteps } from './graphics-spec';
import type { AnyFxContext, FxContext, FxEffect, FxLayer } from './fx-kit';

export interface Look {
  /** Defocus σ at the start, px. */
  blur: number;
  /** Starting scale (≥ 1). */
  scale: number;
  /** Glow σ, px. */
  glow: number;
  /** Feather width of the mask, px. */
  feather: number;
  /** Seconds the alpha takes. */
  fade: number;
  /** First pass start (the kit's window starts at the section start instead). */
  at: number;
}

const QUANTUM = 0.25;
/** Glow σ as a share of the element's short side: a diffuse light, not a legible blurred copy. */
const GLOW = 0.28;
/** A text box grows by this many glow σ on each side, so the glow fades out inside the region. */
const TEXT_PAD = 1.6;

// Context defaults, drawn in a fixed order: blur, then scale. `short` is the element's short side.
export function lookOf(fx: FxContext<'resolve'>, short: number): Look {
  const g = fx.graphic;
  const amount = fx.reduced ? 0 : (g.intensity ?? 1);
  const blur = (g.blur ?? 0.035 + fx.random() * 0.02) * short * amount;
  const scale = 1 + ((g.scale ?? 1.03 + fx.random() * 0.02) - 1) * amount;
  const glow = Math.max(3 * blur, GLOW * short);
  const region = Math.min(fx.target.w, fx.target.h);

  return {
    blur,
    scale: fx.has('zoompan') ? scale : 1,
    glow: Math.round(glow * 2) / 2,
    feather: Math.max(2, Math.round(Math.min(glow, 0.2 * region))),
    fade: fx.duration * (fx.reduced ? 1 : (g.fade ?? 0.55)),
    at: fx.at,
  };
}

// A text target resolves on its box, widened by the glow's reach and clamped to the frame (even pixels).
function boxTarget(fx: FxContext<'resolve'>, reach: number): void {
  const { x, y, w, h } = fx.target;
  const pad = 2 * Math.ceil(reach / 2);
  const left = Math.max(0, x - pad);
  const top = Math.max(0, y - pad);
  const right = Math.min(fx.frame.width - (fx.frame.width % 2), x + w + pad);
  const bottom = Math.min(fx.frame.height - (fx.frame.height % 2), y + h + pad);

  fx.target = { x: left, y: top, w: right - left, h: bottom - top, radius: 0, mask: 'none' };
}

/** The defocus steps: one gblur per run of frames sharing a radius (quantised to QUANTUM px). */
export function blurSteps(fx: FxContext<'resolve'>, look: Look): Filter[] {
  const curve = parseEasing(fx.ease).fn;
  const half = 0.5 / fx.frame.fps;
  const steps = sampleSteps(look.at, fx.duration, fx.frame.fps).map((step, i, all) => {
    const progress = curve(i / all.length);

    return {
      from: step.from,
      to: step.to,
      value: Math.round((look.blur * (1 - progress)) / QUANTUM) * QUANTUM,
    };
  });

  return mergeRuns(steps, (step) => String(step.value))
    .filter((run) => run.value >= QUANTUM)
    .map((run) => {
      // Mid-frame bounds: a frame's timestamp never sits on the rounded edge of a window.
      const [from, to] = [run.from - half, run.to - half];

      return { type: 'gblur', value: `sigma=${fmt(run.value)}:enable='between(t,${fmt(from)},${fmt(to)})'` };
    });
}

/**
 * The region settling from look.scale to 1 on the eased curve: an exact sub-pixel zoom (zoom-exact.ts, so its
 * crop never jitters), laid over the untouched region only while the zoom still moves the edges by a
 * quarter pixel or more; from then on the element is the exact region (an up/down-scale is never identity).
 */
function settle(fx: FxContext<'resolve'>, look: Look, from: string): [FilterGraphChain[], string] {
  if (look.scale <= 1) return [[], from];

  const { w, h } = fx.target;
  const p = fx.prefix;
  const curve = parseEasing(fx.ease).fn;
  // A per-frame table would not fit an expression: one knot per frame of the pass, looked up on `on`.
  const frames = Math.max(1, Math.round(fx.duration * fx.frame.fps));
  const first = Math.round(look.at * fx.frame.fps);
  const zooms = Array.from({ length: frames + 1 }, (_, i) => look.scale - (look.scale - 1) * curve(i / frames));
  // Output frame `first + i` (zoompan counts its frames in `on`, from the section start) gets knot i.
  const on = `round(${ZOOM_TIME}*${fx.frame.fps})`;
  const zoom = zooms.reduceRight((tail, value, i) => `if(lt(${on},${first + i + 1}),${fmt(value)},${tail})`, '1');
  // It hands over to the untouched region, so zoom 1 must stay the identity (no rest over-scan).
  const exact = exactZoomFilterObjects({ zoom }, { width: w, height: h, fps: fx.frame.fps, identityAtRest: true });
  const settled = zooms.findIndex((value) => ((value - 1) * Math.max(w, h)) / 2 < 0.25);
  const until = (first + (settled === -1 ? frames : settled) - 0.5) / fx.frame.fps;

  return [
    [
      { inputs: [from], filters: [{ type: 'split', value: '2' }], outputs: [`${p}zs`, `${p}zk`] },
      {
        inputs: [`${p}zs`],
        filters: exact,
        outputs: [`${p}zz`],
      },
      {
        inputs: [`${p}zk`, `${p}zz`],
        filters: [{ type: 'overlay', value: `0:0:enable='lt(t,${fmt(until)})'` }],
        outputs: [`${p}zo`],
      },
    ],
    `${p}zo`,
  ];
}

function featherInputs(fx: FxContext<'resolve'>, look: Look): string[] | null {
  if (!fx.has('alphamerge')) return null;

  const { w, h, radius } = fx.target;
  const mask = fx.sprite('feather', { kind: 'feather', w, h, radius, halo: look.feather });

  return mask ? [mask] : null;
}

// `from` feathered by mask copy `n` (alphamerge), or `from` itself without a mask.
function feathered(fx: AnyFxContext, mask: string[] | null, from: string, n: number): [FilterGraphChain[], string] {
  if (!mask) return [[], from];

  return [
    [{ inputs: [from, `${fx.prefix}f${n}`], filters: [{ type: 'alphamerge' }], outputs: [`${from}m`] }],
    `${from}m`,
  ];
}

// The glow the element dissolves into: the region under a heavy blur.
function glowLayer(fx: FxContext<'resolve'>, look: Look, mask: string[] | null): FxLayer {
  const p = fx.prefix;
  const split: FilterGraphChain[] = mask
    ? [{ inputs: mask, filters: [{ type: 'split', value: '2' }], outputs: [`${p}f0`, `${p}f1`] }]
    : [];
  const glow: FilterGraphChain = {
    inputs: [`${p}c0`],
    filters: [
      { type: 'gblur', value: `sigma=${fmt(look.glow)}` },
      { type: 'format', value: 'yuva444p' },
    ],
    outputs: [`${p}gw`],
  };
  const [edge, label] = feathered(fx, mask, `${p}gw`, 0);
  // Once the element is opaque the glow only shows in the feather: it clears by the end of the pass, so the
  // last frame of the window is already the untouched region.
  const solid = look.at + look.fade;
  const clear: FilterGraphChain = {
    inputs: [label],
    filters: [
      { type: 'fade', value: `t=out:st=${fmt(solid)}:d=${fmt(Math.max(1 / fx.frame.fps, fx.end - solid))}:alpha=1` },
    ],
    outputs: [`${p}gc`],
  };

  return { chains: [...split, glow, ...edge, clear], label: `${p}gc`, x: '0', y: '0', taps: [`${p}c0`] };
}

// The element resolving: settle, defocus steps, feather, then its alpha fades in from `at`.
function elementLayer(fx: FxContext<'resolve'>, look: Look, mask: string[] | null): FxLayer {
  const p = fx.prefix;
  const [zoom, zoomed] = settle(fx, look, `${p}c1`);
  const sharp: FilterGraphChain = {
    inputs: [zoomed],
    filters: [...blurSteps(fx, look), { type: 'format', value: 'yuva444p' }],
    outputs: [`${p}sh`],
  };
  const [edge, label] = feathered(fx, mask, `${p}sh`, 1);
  const fade: FilterGraphChain = {
    inputs: [label],
    filters: [{ type: 'fade', value: `t=in:st=${fmt(look.at)}:d=${fmt(look.fade)}:alpha=1` }],
    outputs: [`${p}rv`],
  };

  return { chains: [...zoom, sharp, ...edge, fade], label: `${p}rv`, x: '0', y: '0', taps: [`${p}c1`] };
}

function lower(fx: FxContext<'resolve'>): FxLayer[] | null {
  if (!fx.has('gblur')) return null;

  const short = Math.min(fx.target.w, fx.target.h);

  if (fx.target.mask === 'text') boxTarget(fx, TEXT_PAD * Math.max(GLOW, 3 * (fx.graphic.blur ?? 0.055)) * short);

  const look = lookOf(fx, short);
  const mask = featherInputs(fx, look);
  const layers = [glowLayer(fx, look, mask), elementLayer(fx, look, mask)];

  // The kit composites from the section start: the glow hides the element until `at`.
  fx.at = 0;

  return layers;
}

export const RESOLVE: FxEffect<'resolve'> = { lower };
