// Anti-aliased fill coverage of closed polylines, for the shape graphic's compile-time image (shape-raster.ts).
// A scanline fill: SUB sub-rows per pixel row, each crossing only the edges that span it (an edge table sorted
// by top), the spans between crossings kept by the fill rule and laid onto the row with exact horizontal
// coverage. Every subpath closes implicitly, as an SVG fill does. Linear in edges plus covered pixels; pure
// and deterministic, no platform API.

import type { Pt } from './path-geometry';

export type FillRule = 'nonzero' | 'evenodd';

/** Sub-rows per pixel row. */
export const FILL_SUB = 4;
const SUB = FILL_SUB;

interface Edge {
  top: number;
  bottom: number;
  /** x at `top`. */
  x: number;
  slope: number;
  /** +1 for an edge drawn downwards, -1 upwards. */
  dir: number;
}

interface Crossing {
  x: number;
  dir: number;
}

function edgesOf(subpaths: readonly Pt[][]): Edge[] {
  const edges: Edge[] = [];

  for (const points of subpaths) {
    if (points.length < 2) continue;

    const loop = [...points, points[0]];

    for (let i = 0; i < loop.length - 1; i++) {
      const [a, b] = [loop[i], loop[i + 1]];

      if (a.y === b.y || !Number.isFinite(a.x + a.y + b.x + b.y)) continue;

      const down = b.y > a.y;
      const [p, q] = down ? [a, b] : [b, a];

      edges.push({ top: p.y, bottom: q.y, x: p.x, slope: (q.x - p.x) / (q.y - p.y), dir: down ? 1 : -1 });
    }
  }

  return edges.sort((e, f) => e.top - f.top);
}

function spans(crossings: readonly Crossing[], rule: FillRule): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let winding = 0;

  for (let i = 0; i < crossings.length - 1; i++) {
    winding += rule === 'nonzero' ? crossings[i].dir : 1;

    const inside = rule === 'nonzero' ? winding !== 0 : winding % 2 === 1;

    if (inside) out.push([crossings[i].x, crossings[i + 1].x]);
  }

  return out;
}

function addSpan(cover: Float32Array, row: number, w: number, from: number, to: number): void {
  const [a, b] = [Math.max(0, from), Math.min(w, to)];

  if (b <= a) return;

  const [ia, ib] = [Math.floor(a), Math.floor(b)];
  const base = row * w;

  if (ia === ib) {
    cover[base + ia] += (b - a) / SUB;

    return;
  }

  cover[base + ia] += (ia + 1 - a) / SUB;

  for (let i = ia + 1; i < ib; i++) cover[base + i] += 1 / SUB;

  if (ib < w) cover[base + ib] += (b - ib) / SUB;
}

/** Per-pixel coverage (0..1) of the filled subpaths over a w × h raster. */
export function fillCoverage(subpaths: readonly Pt[][], w: number, h: number, rule: FillRule): Float32Array {
  const cover = new Float32Array(w * h);
  const edges = edgesOf(subpaths);
  let next = 0;
  let active: Edge[] = [];

  for (let s = 0; s < h * SUB; s++) {
    const y = (s + 0.5) / SUB;

    while (next < edges.length && edges[next].top <= y) {
      active.push(edges[next]);
      next += 1;
    }

    active = active.filter((edge) => edge.bottom > y);

    const crossings = active
      .map((edge) => ({ x: edge.x + (y - edge.top) * edge.slope, dir: edge.dir }))
      .sort((p, q) => p.x - q.x);

    for (const [from, to] of spans(crossings, rule)) addSpan(cover, Math.floor(s / SUB), w, from, to);
  }

  for (let k = 0; k < cover.length; k++) cover[k] = Math.min(1, cover[k]);

  return cover;
}
