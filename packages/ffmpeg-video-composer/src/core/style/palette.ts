// Palette extraction: deterministic k-means in OKLab. Pixels are sampled on a fixed stride (never at
// random), the centroids are seeded with k-means++ driven by the seeded mulberry32 stream, and the loop
// runs a bounded number of passes — so the same frames and seed always yield the same palette.

import { seededRandom } from '../determinism/hash';
import { chroma, deltaE, hue, labToHex, rgbToOklab, type Lab } from './oklab';
import type { PaletteCluster, StyleFrame } from './types';

export const DEFAULT_STYLE_SEED = 0x5eed;
const MAX_SAMPLES = 40_000;
const DEFAULT_K = 8;
const MAX_PASSES = 24;
// Clusters closer than this are one colour to the eye: merged after k-means.
const MERGE_DELTA = 0.035;

export interface PaletteOptions {
  k?: number;
  seed?: number;
}

function totalPixels(frames: readonly StyleFrame[]): number {
  return frames.reduce((sum, frame) => sum + frame.width * frame.height, 0);
}

/** Every `stride`-th pixel across all frames, as packed OKLab triples. */
export function samplePixels(frames: readonly StyleFrame[]): Float64Array {
  const total = totalPixels(frames);
  const stride = Math.max(1, Math.ceil(total / MAX_SAMPLES));
  const out: number[] = [];
  let index = 0;

  for (const frame of frames) {
    const channels = frame.channels ?? 3;
    const count = frame.width * frame.height;

    for (let p = (stride - (index % stride)) % stride; p < count; p += stride) {
      const o = p * channels;
      const lab = rgbToOklab(frame.data[o], frame.data[o + 1], frame.data[o + 2]);
      out.push(lab.l, lab.a, lab.b);
    }
    index += count;
  }

  return Float64Array.from(out);
}

function sqDist(points: Float64Array, i: number, centers: Float64Array, c: number): number {
  const dl = points[i * 3] - centers[c * 3];
  const da = points[i * 3 + 1] - centers[c * 3 + 1];
  const db = points[i * 3 + 2] - centers[c * 3 + 2];

  return dl * dl + da * da + db * db;
}

function nearest(points: Float64Array, i: number, centers: Float64Array, k: number): number {
  let best = 0;
  let bestDist = Infinity;

  for (let c = 0; c < k; c++) {
    const d = sqDist(points, i, centers, c);

    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }

  return best;
}

function copyPoint(points: Float64Array, i: number, centers: Float64Array, c: number): void {
  centers[c * 3] = points[i * 3];
  centers[c * 3 + 1] = points[i * 3 + 1];
  centers[c * 3 + 2] = points[i * 3 + 2];
}

function pickWeighted(weights: Float64Array, total: number, random: () => number): number {
  let target = random() * total;

  for (let i = 0; i < weights.length; i++) {
    target -= weights[i];

    if (target <= 0 && weights[i] > 0) return i;
  }

  return weights.length - 1;
}

// k-means++: the first centre is a seeded pick, each next one is drawn proportionally to the squared
// distance to the nearest centre so far. Stops early (fewer centres) when every point is already a centre.
function seedCenters(points: Float64Array, k: number, random: () => number): { centers: Float64Array; k: number } {
  const n = points.length / 3;
  const centers = new Float64Array(k * 3);
  const weights = new Float64Array(n);
  copyPoint(points, Math.floor(random() * n), centers, 0);
  let placed = 1;

  while (placed < k) {
    let total = 0;

    for (let i = 0; i < n; i++) {
      weights[i] = sqDist(points, i, centers, nearest(points, i, centers, placed));
      total += weights[i];
    }

    if (total <= 1e-12) break;
    copyPoint(points, pickWeighted(weights, total, random), centers, placed);
    placed++;
  }

  return { centers, k: placed };
}

function assign(points: Float64Array, centers: Float64Array, k: number, labels: Int32Array): boolean {
  let changed = false;

  for (let i = 0; i < labels.length; i++) {
    const c = nearest(points, i, centers, k);

    if (labels[i] !== c) {
      labels[i] = c;
      changed = true;
    }
  }

  return changed;
}

function update(points: Float64Array, centers: Float64Array, k: number, labels: Int32Array): Float64Array {
  const sums = new Float64Array(k * 4);

  for (let i = 0; i < labels.length; i++) {
    const c = labels[i];
    sums[c * 4] += points[i * 3];
    sums[c * 4 + 1] += points[i * 3 + 1];
    sums[c * 4 + 2] += points[i * 3 + 2];
    sums[c * 4 + 3] += 1;
  }

  for (let c = 0; c < k; c++) {
    const count = sums[c * 4 + 3];

    // An emptied cluster keeps its previous centre rather than jumping somewhere random.
    if (count > 0) {
      centers[c * 3] = sums[c * 4] / count;
      centers[c * 3 + 1] = sums[c * 4 + 1] / count;
      centers[c * 3 + 2] = sums[c * 4 + 2] / count;
    }
  }

  return sums;
}

function toClusters(
  centers: Float64Array,
  sums: Float64Array,
  k: number,
  n: number
): Array<{ lab: Lab; count: number }> {
  const out: Array<{ lab: Lab; count: number }> = [];

  for (let c = 0; c < k; c++) {
    const count = sums[c * 4 + 3];

    if (count > 0) out.push({ lab: { l: centers[c * 3], a: centers[c * 3 + 1], b: centers[c * 3 + 2] }, count });
  }

  return n > 0 ? out : [];
}

function mergeClose(clusters: Array<{ lab: Lab; count: number }>): Array<{ lab: Lab; count: number }> {
  const merged: Array<{ lab: Lab; count: number }> = [];

  for (const cluster of [...clusters].sort((x, y) => y.count - x.count)) {
    const into = merged.find((m) => deltaE(m.lab, cluster.lab) < MERGE_DELTA);

    if (!into) {
      merged.push({ lab: { ...cluster.lab }, count: cluster.count });
      continue;
    }
    const total = into.count + cluster.count;
    into.lab = {
      l: (into.lab.l * into.count + cluster.lab.l * cluster.count) / total,
      a: (into.lab.a * into.count + cluster.lab.a * cluster.count) / total,
      b: (into.lab.b * into.count + cluster.lab.b * cluster.count) / total,
    };
    into.count = total;
  }

  return merged;
}

/** Clusters OKLab samples into at most `k` colours, largest share first. */
export function clusterPalette(points: Float64Array, options: PaletteOptions = {}): PaletteCluster[] {
  const n = points.length / 3;

  if (n === 0) return [];

  const random = seededRandom(options.seed ?? DEFAULT_STYLE_SEED);
  const seeded = seedCenters(points, Math.min(options.k ?? DEFAULT_K, n), random);
  const labels = new Int32Array(n).fill(-1);
  let sums: Float64Array = new Float64Array(0);

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const changed = assign(points, seeded.centers, seeded.k, labels);
    sums = update(points, seeded.centers, seeded.k, labels);

    if (!changed) break;
  }

  return mergeClose(toClusters(seeded.centers, sums, seeded.k, n))
    .sort((x, y) => y.count - x.count || y.lab.l - x.lab.l)
    .map(({ lab, count }) => ({ lab, hex: labToHex(lab), share: count / n, chroma: chroma(lab), hue: hue(lab) }));
}

/** Samples the frames and clusters them: the reference's palette with each colour's area share. */
export function extractPalette(frames: readonly StyleFrame[], options: PaletteOptions = {}): PaletteCluster[] {
  return clusterPalette(samplePixels(frames), options);
}
