// The `bands` designed transition: N parallel colour bands at an angle sweep in along their length,
// staggered, and cover the frame by the midpoint; the cut happens under them, then they carry on the same
// way and sweep out, uncovering the next scene.
//
// Each band is one rectangle, rasterised once: a `color` source turned by `rotate` (one frame, transparent
// corners) and held by `loop`. Per frame only the overlay positions move (expressions in t), so the cost is
// N alpha overlays of a band's bounding box. Filters: color, trim, format, rotate, loop, setpts, overlay:
// all on the on-device allowlist.
//
// Geometry: u = (cos a, -sin a) runs along the bands (a counter-clockwise from the +x axis on screen),
// n = (sin a, cos a) across them. The frame spans S_n across: the N bands share it (plus a small overlap so
// their anti-aliased edges never let the picture through) and each is long enough to span the frame along u.

import { parseEasing, type EasingSpec } from './easing';
import { easedProgressExpr, fmt } from './hermite';

export const BANDS_DEFAULTS = { count: 4, angle: 30, stagger: 0.06 } as const;
/** The brand palette, when no theme reaches the boundary. */
export const BANDS_FALLBACK_COLORS = ['#7C83FD', '#FF8AAE', '#FFF685', '#F5F3F7'] as const;
/** Default curve of each band's sweep: fast in, soft landing, the same out. */
export const BANDS_EASE = 'cubic-bezier(0.65, 0, 0.35, 1)';

/** Pixels each band overlaps its neighbour, and the frame edge, so no seam shows. */
const OVERLAP = 3;

export interface BandsSpec {
  id: string;
  duration: number;
  fps: number;
  width: number;
  height: number;
  count?: number;
  angle?: number;
  stagger?: number;
  colors?: readonly string[];
  ease?: EasingSpec;
  tail: string;
  in: string;
  mix: string;
}

function even(value: number): number {
  return 2 * Math.ceil(value / 2);
}

/** `#rrggbb` (alpha suffix dropped) → `0xRRGGBB`; anything else falls back to the default band colour. */
export function bandColor(color: string | undefined, index: number): string {
  const hex = /^#?([0-9a-f]{6})(?:@.*)?$/i.exec(color?.trim() ?? '')?.[1];

  return `0x${(hex ?? BANDS_FALLBACK_COLORS[index % BANDS_FALLBACK_COLORS.length].slice(1)).toUpperCase()}`;
}

export interface BandsGeometry {
  /** Band thickness and length, px (the rectangle before it turns). */
  thickness: number;
  length: number;
  /** The turned band's bounding box, px. */
  box: { w: number; h: number };
  /** Distance along u that takes a band from resting to fully off the frame. */
  travel: number;
  u: { x: number; y: number };
  n: { x: number; y: number };
  /** Centre offsets across the frame (along n) of each band at rest. */
  offsets: number[];
}

export function bandsGeometry(width: number, height: number, count: number, angle: number): BandsGeometry {
  const a = (angle * Math.PI) / 180;
  const [c, s] = [Math.cos(a), Math.sin(a)];
  const spanN = width * Math.abs(s) + height * Math.abs(c);
  const spanU = width * Math.abs(c) + height * Math.abs(s);
  const thickness = Math.ceil(spanN / count) + 2 * OVERLAP;
  const length = Math.ceil(spanU) + 2 * OVERLAP;
  const box = {
    w: even(length * Math.abs(c) + thickness * Math.abs(s)),
    h: even(length * Math.abs(s) + thickness * Math.abs(c)),
  };
  const offsets = Array.from({ length: count }, (_, i) => -spanN / 2 + ((i + 0.5) * spanN) / count);

  return {
    thickness,
    length,
    box,
    travel: (spanU + length) / 2 + 2 * OVERLAP,
    u: { x: c, y: -s },
    n: { x: s, y: c },
    offsets,
  };
}

interface Timing {
  /** Seconds between two bands' starts, within each half. */
  stagger: number;
  /** Seconds each band takes to sweep in (and out). */
  sweep: number;
}

/** The stagger, capped so every sweep keeps at least 40 % of a half. */
export function bandsTiming(duration: number, count: number, stagger: number): Timing {
  const half = duration / 2;
  const capped = count > 1 ? Math.min(stagger, (0.6 * half) / (count - 1)) : 0;

  return { stagger: capped, sweep: half - capped * (count - 1) };
}

// The band's offset along u at time t: +travel before it enters, 0 at rest, -travel once it has left.
function travelExpr(spec: BandsSpec, g: BandsGeometry, timing: Timing, index: number): string {
  const curve = parseEasing(spec.ease ?? BANDS_EASE);
  const enter = easedProgressExpr(curve, { delay: index * timing.stagger, duration: timing.sweep });
  const leave = easedProgressExpr(curve, { delay: spec.duration / 2 + index * timing.stagger, duration: timing.sweep });

  return `${fmt(g.travel)}*(1-(${enter})-(${leave}))`;
}

function bandSprite(spec: BandsSpec, g: BandsGeometry, angle: number, index: number): string {
  const colors = spec.colors ?? [];
  const color = bandColor(colors.length > 0 ? colors[index % colors.length] : undefined, index);
  const frames = Math.ceil(spec.duration * spec.fps) + 1;
  const turn = fmt((-angle * Math.PI) / 180);

  return (
    `color=c=${color}:s=${g.length}x${g.thickness}:r=${spec.fps},trim=end_frame=1,format=rgba,` +
    `rotate=a=${turn}:ow=${g.box.w}:oh=${g.box.h}:c=black@0,loop=loop=${frames}:size=1,` +
    `setpts=N/(${spec.fps}*TB)[${spec.id}b${index}]`
  );
}

/** The bands composite: [tail] + [in] → [mix], over the transition's own clock. */
export function bandsGraph(spec: BandsSpec): string {
  const count = spec.count ?? BANDS_DEFAULTS.count;
  const angle = spec.angle ?? BANDS_DEFAULTS.angle;
  const g = bandsGeometry(spec.width, spec.height, count, angle);
  const timing = bandsTiming(spec.duration, count, spec.stagger ?? BANDS_DEFAULTS.stagger);
  const half = fmt(spec.duration / 2);
  const sprites = g.offsets.map((_, i) => bandSprite(spec, g, angle, i));
  const base = `[${spec.tail}][${spec.in}]overlay=0:0:enable='gte(t,${half})'[${spec.id}k0]`;
  const overlays = g.offsets.map((offset, i) => {
    const along = travelExpr(spec, g, timing, i);
    const cx = `${fmt(spec.width / 2 + g.n.x * offset - g.box.w / 2)}+(${fmt(g.u.x)})*(${along})`;
    const cy = `${fmt(spec.height / 2 + g.n.y * offset - g.box.h / 2)}+(${fmt(g.u.y)})*(${along})`;
    const out = i === count - 1 ? spec.mix : `${spec.id}k${i + 1}`;

    return `[${spec.id}k${i}][${spec.id}b${i}]overlay=x='${cx}':y='${cy}':eof_action=pass[${out}]`;
  });

  return [...sprites, base, ...overlays].join(';');
}
