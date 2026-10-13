import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import type { Filter, FilterGraphChain } from '@/core/types';
import { graphicToFilters } from '@/editor/presets/graphics';
import { sampleSteps } from '@/editor/presets/graphics-spec';
import { MAX_TEAR_BANDS, tearBands, tearFilters, type TearBand } from '@/editor/presets/glitch-tear';
import { renderFilterGraph } from '@/editor/utils/filter-graph';
import { DEVICE_FILTERS } from '@/editor/utils/device-filters.generated';
import { GraphicSchema } from '@/schemas/graphics.schemas';

// Glitch row tearing (`tear`): horizontal bands of the frame shifted sideways per frame during the hit.

const FRAME = { width: 640, height: 360, fps: 30 };

function graphic(spec: unknown, seed = 3): Filter[] {
  return graphicToFilters(GraphicSchema.parse(spec), FRAME, { seed });
}

function filterText(filter: Filter): string {
  return filter.value === undefined ? filter.type : `${filter.type}=${String(filter.value)}`;
}

function graphText(filters: Filter[]): string {
  const graph = filters.find((f) => f.type === 'graph')?.graph as FilterGraphChain[];

  return renderFilterGraph(graph, filterText, () => undefined);
}

function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-hide_banner', '-version'], { stdio: 'pipe' });

    return true;
  } catch {
    return false;
  }
}

describe('glitch tear: schema', () => {
  it('accepts a band count of 2–24 and rejects the rest', () => {
    expect(GraphicSchema.safeParse({ type: 'glitch', tear: 6 }).success).toBe(true);
    expect(GraphicSchema.safeParse({ type: 'glitch', tear: 2 }).success).toBe(true);
    expect(GraphicSchema.safeParse({ type: 'glitch', tear: MAX_TEAR_BANDS }).success).toBe(true);
    expect(GraphicSchema.safeParse({ type: 'glitch', tear: 1 }).success).toBe(false);
    expect(GraphicSchema.safeParse({ type: 'glitch', tear: 25 }).success).toBe(false);
    expect(GraphicSchema.safeParse({ type: 'glitch', tear: 4.5 }).success).toBe(false);
    expect(GraphicSchema.safeParse({ type: 'glitch', tear: true }).success).toBe(false);
  });
});

describe('glitch tear: lowering', () => {
  it('leaves an untorn glitch exactly as before (no graph, same filters)', () => {
    const plain = graphic({ type: 'glitch', at: 1, duration: 0.3, intensity: 0.8 });

    expect(plain.some((f) => f.type === 'graph')).toBe(false);
    expect(new Set(plain.map((f) => f.type))).toEqual(new Set(['noise', 'rgbashift', 'drawbox']));
  });

  it('adds one split/crop/overlay sub-graph before the RGB split, keeping the rest identical', () => {
    const plain = graphic({ type: 'glitch', at: 1, duration: 0.3, intensity: 0.8 });
    const torn = graphic({ type: 'glitch', at: 1, duration: 0.3, intensity: 0.8, tear: 4 });

    expect(torn[0].type).toBe('graph');
    expect(torn.slice(1)).toEqual(plain);
    const text = graphText(torn);
    const filters = new Set([...text.matchAll(/(?:^|[\];,])([a-z]+)=/g)].map((m) => m[1]));

    expect(filters).toEqual(new Set(['split', 'crop', 'overlay']));
    for (const filter of filters) expect(DEVICE_FILTERS.has(filter), filter).toBe(true);
  });

  it('emits the exact chain for a fixed seed', () => {
    const steps = [
      { from: 1, to: 1.5, strength: 1 },
      { from: 1.5, to: 2, strength: 1 },
    ];
    const text = graphText(tearFilters({ bands: 2, intensity: 1, frame: FRAME, seed: 11, steps }, 'g0_'));

    // Window bounds sit half a frame early so a frame exactly on a step boundary joins that step.
    expect(text).toBe(
      'split=3[g0_base][g0_c0][g0_c1];' +
        '[g0_c0]crop=640:234:0:0[g0_b0];[g0_c1]crop=640:126:0:234[g0_b1];' +
        "[g0_base][g0_b0]overlay=x='50*gte(t,1.483333)*lt(t,1.983333)':y=0:" +
        "enable='gte(t,0.983333)*lt(t,1.983333)'[g0_o0];" +
        "[g0_o0][g0_b1]overlay=x='52*gte(t,0.983333)*lt(t,1.483333)+-74*gte(t,1.483333)*lt(t,1.983333)':y=234:" +
        "enable='gte(t,0.983333)*lt(t,1.983333)'"
    );
  });

  it('cuts the whole frame into at most `tear` even-row bands, shifted by up to 12 % of the width', () => {
    const steps = sampleSteps(0, 0.9, 30).map((s) => ({ ...s, strength: 1 }));
    const bands = tearBands({ bands: 8, intensity: 1, frame: FRAME, seed: 4, steps });

    expect(bands.length).toBeLessThanOrEqual(8);
    expect(bands[0].y).toBe(0);
    const last = bands.at(-1) as TearBand;

    expect(last.y + last.h).toBe(360);
    for (const [i, band] of bands.entries()) {
      expect(band.y % 2).toBe(0);
      if (i > 0) expect(band.y).toBe(bands[i - 1].y + bands[i - 1].h);
      for (const offset of band.offsets) expect(Math.abs(offset)).toBeLessThanOrEqual(Math.round(640 * 0.12));
    }
    const moving = bands.flatMap((band) => band.offsets).filter((o) => o !== 0);
    expect(moving.length).toBeGreaterThan(bands.length * steps.length * 0.4);
  });

  it('is deterministic per seed and reshuffles with a new seed', () => {
    const spec = { type: 'glitch', duration: 0.9, tear: 6 };

    expect(graphic(spec, 5)).toEqual(graphic(spec, 5));
    expect(graphText(graphic(spec, 5))).not.toEqual(graphText(graphic(spec, 6)));
  });

  it('settles as the hit decays: the last step never moves more than the first', () => {
    const steps = sampleSteps(0, 0.9, 30).map((s, i, all) => ({ ...s, strength: i === all.length - 1 ? 0 : 1 }));
    const bands = tearBands({ bands: 6, intensity: 1, frame: FRAME, seed: 9, steps });

    for (const band of bands) expect(band.offsets.at(-1)).toBe(0);
  });
});

// Real FFmpeg on raw frames: a frame of unique vertical bars, torn; each band's measured shift must
// equal its planned offset inside the window and be zero outside it.
describe.skipIf(!hasFfmpeg())('glitch tear on real frames', () => {
  const [AT, DURATION, LENGTH] = [0.5, 0.6, 1.6];
  const BARS = [
    [96, 18],
    [210, 40],
    [330, 10],
    [420, 26],
    [520, 14],
  ];

  function render(filters: Filter[]): Buffer[] {
    const bars = BARS.map(([x, w]) => `drawbox=x=${x}:y=0:w=${w}:h=360:color=white:t=fill`).join(',');
    const base = `color=c=0x202020:s=640x360:r=30:d=${LENGTH},format=yuv420p,${bars}`;
    const graph = filters.length > 0 ? `${base},${graphText(filters)}` : base;
    const raw = execFileSync(
      'ffmpeg',
      ['-v', 'error', '-filter_complex', graph, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
      {
        maxBuffer: 1 << 28,
      }
    );
    const size = 640 * 360;

    return Array.from({ length: raw.length / size }, (_, i) => raw.subarray(i * size, (i + 1) * size));
  }

  // The shift that best maps the plain row onto the torn one over the frame's interior.
  function shiftOf(torn: Buffer, plain: Buffer, row: number): number {
    let best = { shift: 0, error: Infinity };

    for (let s = -80; s <= 80; s++) {
      let error = 0;

      for (let x = 90; x < 550; x++) error += Math.abs(torn[row * 640 + x] - plain[row * 640 + x - s]);
      if (error < best.error) best = { shift: s, error };
    }

    return best.shift;
  }

  it('shifts each band by its planned offset during the window and not at all outside it', () => {
    const steps = sampleSteps(AT, DURATION, 30).map((s) => ({ ...s, strength: 1 }));
    const input = { bands: 5, intensity: 0.6, frame: FRAME, seed: 21, steps };
    const bands = tearBands(input);
    const torn = render(tearFilters(input, 't_'));
    const plain = render([]);

    expect(torn.length).toBe(plain.length);
    let moved = 0;

    for (const [i, frame] of torn.entries()) {
      const step = i >= AT * 30 && i < (AT + DURATION) * 30 ? i - AT * 30 : -1;

      for (const band of bands) {
        const row = band.y + Math.floor(band.h / 2);
        const expected = step < 0 ? 0 : band.offsets[step];

        if (Math.abs(expected) > 80) continue;
        expect(shiftOf(frame, plain[i], row), `frame ${i} band y=${band.y}`).toBe(expected);
        if (expected !== 0) moved++;
      }
      if (step < 0) expect(frame.equals(plain[i]), `frame ${i} untouched`).toBe(true);
    }
    expect(moved).toBeGreaterThan(20);
  }, 60000);
});
