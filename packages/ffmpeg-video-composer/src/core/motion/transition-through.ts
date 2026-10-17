// zoom-through with `through`: the camera flies into a window (a letter's counter, the hole of the "O" in
// ZOOM, or a shape) and the next scene shows through it, until the window outgrows the frame.
//
// The window is a compile-time matte (white inside, transition-mattes.ts) at its place in the frame. The
// outgoing tail and the matte run through the SAME zoom chain about the window's centre, so the hole and
// the letter around it stay locked together at every frame, whatever the rounding. The incoming scene
// takes the zoomed matte as its alpha (alphamerge) over the zoomed tail, and settles from a slight push.
//
// The zoom is log-linear on the eased curve (equal ratios per unit of progress, the way a fly-through
// reads) and ends at the scale where the window covers the frame. Up to ×2 it is the exact sub-pixel zoom
// (zoom-exact.ts); beyond, whole-pixel `zoompan` stages (×10 each) take over, where the move is fast.
// Filters: setpts, scale, format, zoompan, setsar, alphamerge, overlay: all on the on-device allowlist.

import { parseEasing, type EasingSpec } from './easing';
import { easedProgressExpr, fmt } from './hermite';
import { exactZoomFilters, ZOOM_TIME } from './zoom-exact';

export interface ThroughMatte {
  /** The matte's input pad, e.g. `5:v`. */
  label: string;
  /** The window's centre, output px. */
  centre: { x: number; y: number };
  /** The zoom at which the window covers the frame (the end of the move). */
  scale: number;
}

export interface ThroughSpec {
  id: string;
  duration: number;
  width: number;
  height: number;
  fps: number;
  ease?: EasingSpec;
  tail: string;
  in: string;
  mix: string;
}

/** The exact (sub-pixel) part of the zoom; above it, whole-pixel zoompan stages. */
const EXACT_ZOOM = 2;
/** zoompan's own ceiling per stage. */
const STAGE_ZOOM = 10;
/** The deepest window a fly-through reaches: the exact stage and two zoompan stages. */
export const MAX_THROUGH_SCALE = EXACT_ZOOM * STAGE_ZOOM * STAGE_ZOOM;
/** The incoming scene settles from this push about the window's centre. */
const SETTLE = 0.15;

function curveOf(spec: ThroughSpec, time: string): string {
  return easedProgressExpr(
    parseEasing(spec.ease ?? 'cubic-bezier(0.65, 0, 0.35, 1)'),
    { delay: 0, duration: spec.duration },
    time
  );
}

// zoom = scale^e: ln-linear on the curve.
function scaleExpr(spec: ThroughSpec, matte: ThroughMatte, time: string): string {
  return `exp(${fmt(Math.log(matte.scale))}*(${curveOf(spec, time)}))`;
}

/** The zoom chain about the window's centre, applied identically to the tail and the matte. */
export function throughZoom(spec: ThroughSpec, matte: ThroughMatte): string {
  const { width: W, height: H, fps } = spec;
  const { x: cx, y: cy } = matte.centre;
  const exact = `min(${EXACT_ZOOM},${scaleExpr(spec, matte, `(${ZOOM_TIME})`)})`;
  const first = exactZoomFilters(
    { zoom: exact, panX: `${fmt(cx - W / 2)}*((${exact})-1)`, panY: `${fmt(cy - H / 2)}*((${exact})-1)` },
    { width: W, height: H, fps, identityAtRest: true }
  );
  const stages: string[] = [];

  for (let floor = EXACT_ZOOM; floor < matte.scale; floor *= STAGE_ZOOM) {
    const z = `max(1,min(${STAGE_ZOOM},${scaleExpr(spec, matte, 'it')}/${floor}))`;
    stages.push(`zoompan=z='${z}':x='${fmt(cx)}*(1-1/zoom)':y='${fmt(cy)}*(1-1/zoom)':d=1:s=${W}x${H}:fps=${fps}`);
  }

  return [...first, ...stages, 'settb=AVTB'].join(',');
}

function settle(spec: ThroughSpec, matte: ThroughMatte): string {
  const { width: W, height: H, fps } = spec;
  const { x: cx, y: cy } = matte.centre;
  const zoom = `1+${fmt(SETTLE)}*(1-(${curveOf(spec, `(${ZOOM_TIME})`)}))`;

  return [
    ...exactZoomFilters(
      { zoom, panX: `${fmt(cx - W / 2)}*((${zoom})-1)`, panY: `${fmt(cy - H / 2)}*((${zoom})-1)` },
      { width: W, height: H, fps, identityAtRest: true }
    ),
    'settb=AVTB',
  ].join(',');
}

/** [tail] + [in] + the matte input → [mix]. */
export function throughGraph(spec: ThroughSpec, matte: ThroughMatte): string {
  const id = spec.id;
  const zoom = throughZoom(spec, matte);

  return (
    `[${spec.tail}]${zoom}[${id}za];` +
    `[${matte.label}]format=yuv420p,setsar=1,${zoom},format=gray[${id}zm];` +
    `[${spec.in}]${settle(spec, matte)}[${id}zb];` +
    `[${id}zb][${id}zm]alphamerge[${id}zi];[${id}za][${id}zi]overlay=0:0[${spec.mix}]`
  );
}
