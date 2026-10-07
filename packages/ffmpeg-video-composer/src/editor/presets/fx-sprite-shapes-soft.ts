// Soft fx sprite shapes (registered in fx-sprite-shapes.ts): a lens bokeh disc, a top-lit glass rim and a
// feathered rounded mask. Coverage functions only, analytic and anti-aliased like the other shapes; the
// rounded-rectangle distance is passed in so this module depends on nothing.

/** The fields these shapes read (a subset of SpriteSpec). */
export interface SoftShapeSpec {
  w: number;
  h: number;
  radius?: number;
  stroke?: number;
  halo?: number;
  peak?: number;
}

type Coverage = (x: number, y: number) => number;
type Distance = (x: number, y: number, spec: { w: number; h: number; radius?: number }) => number;

/** Brightness share carried by the bokeh rim (the rest is the flat disc). */
const BOKEH_RIM = 0.16;
/** Rim alpha at the bottom of a glass card, relative to its top. */
const RIM_FLOOR = 0.12;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smoothstep(from: number, to: number, value: number): number {
  const t = clamp01((value - from) / (to - from));

  return t * t * (3 - 2 * t);
}

/**
 * Out-of-focus highlight: a flat disc of `radius` px whose edge rolls off over `halo` px either side, with a
 * slightly brighter rim just inside the edge (how a lens renders a defocused point). Peak alpha `peak`.
 */
export function bokehCoverage(spec: SoftShapeSpec): Coverage {
  const radius = spec.radius ?? spec.w / 3;
  const soft = Math.max(0.5, spec.halo ?? radius * 0.3);
  const peak = spec.peak ?? 1;

  return (x, y) => {
    const d = Math.hypot(x, y) - radius;
    const edge = 1 - smoothstep(-soft, soft, d);
    const rim = Math.exp(-((d + soft) ** 2) / (2 * soft * soft));

    return peak * edge * (1 - BOKEH_RIM + BOKEH_RIM * rim);
  };
}

/**
 * The edge light of a glass card: a rounded-rectangle outline `stroke` px thick, lit from above (alpha 1
 * along the top, falling to RIM_FLOOR at the bottom), peak alpha `peak`.
 */
export function rimCoverage(spec: SoftShapeSpec, distance: Distance): Coverage {
  const half = (spec.stroke ?? 1) / 2;
  const peak = spec.peak ?? 1;

  return (x, y) => {
    const line = clamp01(half - Math.abs(distance(x, y, spec) + half) + 0.5);
    const down = clamp01(y / spec.h + 0.5);

    return peak * line * (RIM_FLOOR + (1 - RIM_FLOOR) * (1 - down) ** 2);
  };
}

/** A rounded-rectangle mask whose edge fades in over `halo` px inside the box (0 at the box edge). */
export function featherCoverage(spec: SoftShapeSpec, distance: Distance): Coverage {
  const feather = Math.max(1, spec.halo ?? 8);

  return (x, y) => smoothstep(0, feather, -distance(x, y, spec));
}
