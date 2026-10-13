// The path graphic → filters: a stroke that draws itself along any path (a "trim path"), on-device.
//
// FFmpeg cannot stroke a curve, and the LGPL device build has no per-pixel expression filter (geq, blend,
// maskedmerge), so the stroke is rasterised once at compile time (path-raster.ts) as two images over its
// bounding box: the anti-aliased stroke (cover) and, per pixel, its position along the path (code, 1..255).
// Per output frame, ONE `lutyuv` turns the code image into the reveal mask of that frame's trim window
// (each frame's lut is gated by its `enable` window; timeline-disabled filters pass frames through, so only
// one runs per frame and each builds its 256-entry table once). The mask is merged as the alpha of the
// region with the stroke composited on it, and that region is laid back over the frame: the frame shows
// through wherever the stroke is not drawn yet, so the stroke's anti-aliasing is kept exactly. Once the draw
// settles, a still (the cover with the final trim baked in) replaces the reveal branch, which is trimmed off.
// A dot and a cap ride the drawing end (path-riders.ts).
//
// Filters: format, split, trim, crop, fps, overlay, lutyuv, alphamerge, colorchannelmixer, fade, null: all on
// the on-device allowlist.

import type { Filter, FilterGraphChain } from '@/core/types';
import { parseEasing } from '@/core/motion/easing';
import { fmt } from '@/core/motion/hermite';
import { mergeRuns } from './graphics-spec';
import { encodeCommands } from './path-svg';
import { edgeOf, traceUrl, type TraceSpec } from './path-raster';
import { riderChains } from './path-riders';
import { closeGraph } from './stroke-lower';
import { SMOOTH } from './stroke-kit';
import {
  alphaFilters,
  exitEnd,
  fadeOut,
  geometryOf,
  plan,
  settledAt,
  strokePaint,
  warn,
  window,
  type Paint,
  type PathRequest,
  type Plan,
} from './path-plan';

export type { PathRequest } from './path-plan';

/** One reveal state: the drawn window [lo, hi] (fractions of the length) over [from, to). */
interface Reveal {
  from: number;
  to: number | undefined;
  lo: number;
  hi: number;
}

interface Labels {
  cover: string;
  code: string;
  /** The held still's own input; null when the cover itself is held (split, decoded once) or on a retract. */
  hold: string | null;
  sharesCover: boolean;
}

/** The reveal states over the reveal branch's life: the entrance, then (retract) the hold and the exit. */
function reveals(p: Plan): Reveal[] {
  const { start, frames } = p.entrance;
  const final = p.heads.at(-1) as number;
  const entering = p.heads.map((hi, f) => ({ from: start + f / p.fps, to: start + (f + 1) / p.fps, lo: 0, hi }));
  const exit = p.exit;

  if (!p.retract || !exit) return entering;

  const smooth = parseEasing(SMOOTH).fn;
  const hold = { from: start + frames / p.fps, to: exit.start, lo: 0, hi: final };
  const leaving = Array.from({ length: exit.frames }, (_, m) => ({
    from: exit.start + m / p.fps,
    to: exit.start + (m + 1) / p.fps,
    lo: final * smooth((m + 1) / exit.frames),
    hi: final,
  }));

  return [...entering, ...(hold.to > hold.from ? [hold] : []), ...leaving];
}

function quarter(value: number): number {
  return Math.round(value * 4) / 4;
}

// The reveal mask of one state: 255 where the stroke shows (drawn), 0 where the frame shows through.
function lutOf(lo: number, hi: number): string {
  const head = `clip(${fmt(quarter(edgeOf(hi) + 0.5))}-val,0,1)`;
  const tail = lo > 0 ? `*clip(val-${fmt(quarter(edgeOf(lo) - 0.5))},0,1)` : '';

  return `y='255*${head}${tail}'`;
}

// Each lut is gated to its frames, edges half a frame early so a frame time never lands on one; the first
// window is open before and the last open after (outside the reveal window the overlay is off anyway).
function lutSteps(states: Reveal[], fps: number): Filter[] {
  const runs = mergeRuns(
    states.map((s) => ({ ...s, value: lutOf(s.lo, s.hi) })),
    (s) => s.value
  );
  const half = 0.5 / fps;

  return runs.map((run, i) => {
    const bounds = [
      ...(i > 0 ? [`gte(t,${fmt(run.from - half)})`] : []),
      ...(i < runs.length - 1 ? [`lt(t,${fmt((run.to as number) - half)})`] : []),
    ];

    return { type: 'lutyuv', value: `${run.value}${bounds.length > 0 ? `:enable='${bounds.join('*')}'` : ''}` };
  });
}

/** The reveal branch: the region with the stroke on it, masked to the drawn window, laid back over the frame. */
function revealChains(p: Plan, paint: Paint, labels: Labels, prefix: string): FilterGraphChain[] {
  const { x, y, w, h } = p.box;
  const until = Math.min(p.retract && p.exit ? exitEnd(p.exit, p.fps) : settledAt(p), p.end ?? Infinity);
  const fps: Filter = { type: 'fps', value: String(p.fps) };

  return [
    {
      filters: [
        { type: 'format', value: 'yuv420p' },
        { type: 'split', value: '2' },
      ],
      outputs: [`${prefix}m`, `${prefix}r0`],
    },
    {
      inputs: [`${prefix}r0`],
      filters: [
        { type: 'trim', value: `end=${fmt(until)}` },
        { type: 'crop', value: `${w}:${h}:${x}:${y}` },
      ],
      outputs: [`${prefix}c`],
    },
    {
      inputs: [labels.cover],
      filters: [fps, ...alphaFilters(paint), ...(labels.sharesCover ? [{ type: 'split', value: '2' }] : [])],
      outputs: labels.sharesCover ? [`${prefix}cv`, `${prefix}hs`] : [`${prefix}cv`],
    },
    { inputs: [`${prefix}c`, `${prefix}cv`], filters: [{ type: 'overlay', value: '0:0' }], outputs: [`${prefix}d`] },
    {
      inputs: [labels.code],
      filters: [fps, { type: 'format', value: 'gray' }, ...lutSteps(reveals(p), p.fps)],
      outputs: [`${prefix}k`],
    },
    { inputs: [`${prefix}d`, `${prefix}k`], filters: [{ type: 'alphamerge' }], outputs: [`${prefix}l`] },
    {
      inputs: [`${prefix}m`, `${prefix}l`],
      filters: [{ type: 'overlay', value: `${x}:${y}:eof_action=pass:enable='${window(p.entrance.start, until)}'` }],
      outputs: [`${prefix}v`],
    },
  ];
}

/** The settled stroke as a still, from the end of the draw to the end of its life (fading out on a fade exit). */
function holdChains(p: Plan, paint: Paint, labels: Labels, prefix: string): FilterGraphChain[] {
  if (!labels.hold && !labels.sharesCover) return [];

  const fade = p.exit ? [fadeOut(p.exit, p.fps)] : [];
  const own = labels.hold ? [{ type: 'fps', value: String(p.fps) }, ...alphaFilters(paint)] : [];
  const filters = [...own, ...fade];

  return [
    {
      inputs: [labels.hold ?? `${prefix}hs`],
      filters: filters.length > 0 ? filters : [{ type: 'null' }],
      outputs: [`${prefix}h`],
    },
    {
      inputs: [`${prefix}v`, `${prefix}h`],
      filters: [{ type: 'overlay', value: `${p.box.x}:${p.box.y}:enable='${window(settledAt(p), p.end)}'` }],
      outputs: [`${prefix}w`],
    },
  ];
}

function traceInput(request: PathRequest, key: string, spec: TraceSpec): string | null {
  return request.ctx.masks?.input(`gs${request.index}_${key}`, { url: traceUrl(spec), still: true }) ?? null;
}

function coverSpec(request: PathRequest, p: Plan, paint: Paint, path: string): TraceSpec {
  const g = request.graphic;

  return {
    mode: 'cover',
    ...p.box,
    thickness: p.thickness,
    caps: g.caps ?? 'round',
    ...(g.dash ? { dash: g.dash } : {}),
    color: paint.hex.slice(1),
    path,
  };
}

// The cover, the code mask and, when the settled stroke is not the whole cover, the held still.
function register(request: PathRequest, p: Plan, paint: Paint, path: string): Labels | null {
  const cover = coverSpec(request, p, paint, path);
  const final = p.heads.at(-1) as number;
  const holds = !p.retract && (p.end === undefined || p.end > settledAt(p));
  const sharesCover = holds && final >= 1;
  const coverLabel = traceInput(request, 'cover', cover);
  const codeLabel = traceInput(request, 'code', { ...cover, mode: 'code', color: undefined });
  const hold = holds && !sharesCover ? traceInput(request, 'hold', { ...cover, hi: Math.max(0, final) }) : null;

  if (!coverLabel || !codeLabel || (holds && !sharesCover && !hold)) return null;

  return { cover: coverLabel, code: codeLabel, hold, sharesCover };
}

/** One path graphic as filters ([] after a warning when it cannot be drawn). */
export function lowerPath(request: PathRequest): Filter[] {
  const geometry = geometryOf(request);

  if (!geometry) return [];

  const p = plan(request, geometry);
  const paint = strokePaint(request);
  const prefix = `gs${request.index}_`;
  const labels =
    request.ctx.masks?.available === false ? null : register(request, p, paint, encodeCommands(geometry.commands));
  const drawn = labels && [...revealChains(p, paint, labels, prefix), ...holdChains(p, paint, labels, prefix)];
  const ridden = drawn && riderChains(request, p, paint, drawn.at(-1)?.outputs?.[0] as string);

  if (!drawn || !ridden) {
    warn(
      request,
      'path_inputs',
      'its stroke images need extra inputs (and alphamerge) this segment cannot take; skipped'
    );

    return [];
  }

  return closeGraph([...drawn, ...ridden]);
}
