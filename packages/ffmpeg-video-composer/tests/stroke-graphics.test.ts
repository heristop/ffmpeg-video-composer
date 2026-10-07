import { describe, expect, it } from 'vitest';
import type { Filter, Section } from '@/core/types';
import { graphicTiming, graphicToFilters, graphicsToFilters } from '@/editor/presets/graphics';
import { lowerStroke } from '@/editor/presets/stroke-graphics';
import { DARK_INK, pickInk } from '@/editor/presets/stroke-contrast';
import { drawn, subtract } from '@/editor/presets/stroke-path';
import { cornerPaths, framePath } from '@/editor/presets/stroke-shapes';
import { settleCurve } from '@/editor/presets/stroke-underline';
import type { StrokeRequest, SugarContext } from '@/editor/presets/sugar-context';
import { GraphicSchema, type Graphic } from '@/schemas/graphics.schemas';

interface Lowered {
  filters: Filter[];
  inputs: string[];
  warnings: string[];
}

interface Options {
  section?: Partial<Section>;
  input?: boolean;
  at?: number;
  until?: number;
}

const SUBJECT = { x: 320, y: 180, w: 640, h: 360 };

function context(inputs: string[], warnings: string[], input = true): SugarContext {
  return {
    duration: 3,
    scale: '1280:720',
    fps: 30,
    isVideo: false,
    motion: { energy: 1, seedFor: () => 1, resolveText: () => '' },
    masks: {
      available: true,
      input: (key, source) => {
        inputs.push(`${key}=${'url' in source ? source.url : ''}`);

        return input ? `input:${key}` : null;
      },
      color: (color) => color,
      warn: (message) => warnings.push(message),
      has: () => true,
      strokes: lowerStroke,
    },
  };
}

function lower(graphic: Record<string, unknown>, options: Options = {}): Lowered {
  const inputs: string[] = [];
  const warnings: string[] = [];
  const ctx = context(inputs, warnings, options.input ?? true);
  const section = {
    name: 's',
    type: 'color_background',
    options: { backgroundColor: '#121826', layers: [{ color: '#C9D2E0', ...SUBJECT }] },
    ...options.section,
  } as unknown as Section;
  const request = {
    graphic,
    at: options.at ?? 0.3,
    until: options.until,
    seed: 11,
    index: 0,
    section,
    ctx,
  } as unknown as StrokeRequest;

  return { filters: lowerStroke(request) ?? [], inputs, warnings };
}

/** Every drawbox (flat or inside a sub-graph). */
function drawboxes(filters: Filter[]): Array<Record<string, string>> {
  const all = filters.flatMap((f) => (f.type === 'graph' ? (f.graph ?? []).flatMap((c) => c.filters) : [f]));

  return all.filter((f) => f.type === 'drawbox').map((f) => f.values as Record<string, string>);
}

function text(filters: Filter[]): string {
  return JSON.stringify(filters);
}

/** Pixels covered more than once by `rects` (pieces must never overlap). */
function overlaps(rects: Array<{ x: number; y: number; w: number; h: number }>): number {
  const seen = new Map<string, number>();

  for (const r of rects) {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) seen.set(`${x},${y}`, (seen.get(`${x},${y}`) ?? 0) + 1);
    }
  }

  return [...seen.values()].filter((count) => count > 1).length;
}

describe('stroke schema', () => {
  it('accepts every stroke field and keeps unknown keys strict', () => {
    const frame = { type: 'frame', radius: 24, trace: 'split', exit: 'retract', exitDuration: 0.3, contrast: 'auto' };
    const corners = { type: 'corners', target: 'layer:0', clearance: 24, spread: 1.08, trace: 'clockwise' };
    const underline = { type: 'underline', caps: 'round', settle: 0.03, exit: 'fade' };

    for (const graphic of [frame, corners, underline]) expect(GraphicSchema.safeParse(graphic).success).toBe(true);

    expect(GraphicSchema.safeParse({ type: 'frame', rounded: true }).success).toBe(false);
    expect(GraphicSchema.safeParse({ type: 'underline', caps: 'pill' }).success).toBe(false);
  });

  it('lowers a plain frame, corners or underline through the stroke path', () => {
    for (const type of ['frame', 'corners', 'underline']) {
      const { filters } = lower({ type } as Graphic);

      expect(filters.length, type).toBeGreaterThan(0);
    }

    // The path's 0.6 s entrance, not the old 0.9 s four-sided trace.
    expect(graphicTiming({ type: 'frame' } as Graphic, { width: 1280, height: 720, fps: 30 }).duration).toBe(0.6);
  });
});

describe('stroke paths', () => {
  it('never overlaps pieces, square or rounded, frame or brackets', () => {
    const box = { x: 40, y: 40, w: 200, h: 120 };
    const square = drawn(framePath({ box, thickness: 4, radius: 0 }), [{ from: 0, to: 1 }]);
    const rounded = drawn(framePath({ box, thickness: 4, radius: 16 }), [{ from: 0, to: 1 }]);
    const brackets = cornerPaths({ box, thickness: 4, radius: 0 }, 30).flatMap(
      (path) => drawn(path, [{ from: 0, to: 1 }]).rects
    );

    expect(overlaps(square.rects)).toBe(0);
    expect(overlaps(rounded.rects)).toBe(0);
    expect(rounded.arcs).toHaveLength(4);
    expect(overlaps(brackets)).toBe(0);
  });

  it('starts the frame trace at the top-left, running right', () => {
    const { rects } = drawn(framePath({ box: { x: 40, y: 40, w: 200, h: 120 }, thickness: 4, radius: 0 }), [
      { from: 0, to: 0.1 },
    ]);

    // 10% of the 624 px outline.
    expect(rects).toEqual([{ x: 44, y: 40, w: 62, h: 4 }]);
  });

  it('subtracts spans', () => {
    expect(subtract([{ from: 0, to: 1 }], [{ from: 0.2, to: 0.4 }])).toEqual([
      { from: 0, to: 0.2 },
      { from: 0.4, to: 1 },
    ]);
  });
});

describe('frame', () => {
  it('traces from the top-left with a head fade, holds, and fades out before until', () => {
    const { filters } = lower({ type: 'frame', trace: 'path', exit: 'fade' }, { until: 1.6 });
    const boxes = drawboxes(filters);
    const first = boxes[0];

    expect(first.y).toBe('48');
    expect(Number(first.x)).toBeLessThan(200);
    // The newest step of the head is fainter than the settled stroke.
    expect(boxes.some((b) => b.color.endsWith('@0.315'))).toBe(true);
    // Last exit window ends on `until`, nothing is drawn after it.
    expect(boxes.every((b) => !b.enable.includes('gte(t,1.6)'))).toBe(true);
    expect(boxes.some((b) => b.enable.includes('lt(t,1.6)'))).toBe(true);
  });

  it('draws rounded corners as sprite arcs that follow the same windows', () => {
    const { filters, inputs } = lower({ type: 'frame', radius: 20 });

    expect(inputs.some((input) => input.includes('kind=stroke') && input.includes('radius=20'))).toBe(true);
    expect(text(filters)).toContain('crop');
    expect(text(filters)).toContain('fade=t=out'.slice(0, 4));
  });

  it('falls back to square corners (with a warning) when the segment takes no extra input', () => {
    const { filters, warnings } = lower({ type: 'frame', radius: 20 }, { input: false });

    expect(filters.every((f) => f.type === 'drawbox')).toBe(true);
    expect(warnings.join(' ')).toMatch(/stroke_square/);
  });

  it('is deterministic', () => {
    const graphic = { type: 'frame', radius: 12, trace: 'split', exit: 'retract' };

    expect(text(lower(graphic).filters)).toBe(text(lower(graphic).filters));
  });
});

describe('corners', () => {
  it('sits clearance px outside its target and picks dark ink on a light card', () => {
    const light = { options: { backgroundColor: '#F0E8DC', layers: [{ color: '#CDBFA9', ...SUBJECT }] } };
    const { filters } = lower(
      { type: 'corners', target: 'layer:0', trace: 'together', spread: 1, exit: 'none' },
      { section: light }
    );
    const settled = drawboxes(filters).filter((b) => b.enable.startsWith("'gte(t,") && !b.enable.includes('lt('));
    const xs = settled.map((b) => Number(b.x));

    expect(Math.min(...xs)).toBe(SUBJECT.x - 24);
    expect(settled.every((b) => b.color.startsWith(DARK_INK))).toBe(true);
  });

  it('extends clockwise from the top-left bracket first', () => {
    const { filters } = lower({ type: 'corners', target: 'layer:0', trace: 'clockwise', spread: 1 });
    const firstFrame = drawboxes(filters).filter((b) => b.enable.includes('gte(t,0.3)*'));

    expect(firstFrame.length).toBeGreaterThan(0);
    expect(firstFrame.every((b) => Number(b.x) < 640 && Number(b.y) < 360)).toBe(true);
  });

  it('adds a shadow over an unknown background (footage)', () => {
    const { filters } = lower({ type: 'corners', target: SUBJECT, color: '#FFFFFF' }, { section: { type: 'video' } });

    expect(drawboxes(filters).some((b) => b.color.startsWith('#000000@'))).toBe(true);
  });

  it('exits by expanding and fading (no hard cut)', () => {
    const { filters } = lower({ type: 'corners', target: SUBJECT }, { until: 1.6 });
    const exit = drawboxes(filters).filter((b) => /gte\(t,1\.(3|4|5)/.test(b.enable));

    expect(exit.length).toBeGreaterThan(0);
    expect(exit.some((b) => Number(b.x) < SUBJECT.x - 24)).toBe(true);
    expect(exit.some((b) => /@0\.[1-6]/.test(b.color))).toBe(true);
  });
});

describe('underline', () => {
  it('rides round caps on the ends and settles past the width', () => {
    const { filters, inputs } = lower({ type: 'underline', x: 100, y: 400, width: 300, thickness: 10, caps: 'round' });
    const widths = drawboxes(filters).map((b) => Number(b.w));

    expect(inputs.some((input) => input.includes('kind=piece') && input.includes('shape=disc'))).toBe(true);
    expect(Math.max(...widths)).toBeGreaterThan(290);
    expect(text(filters)).toContain('overlay');
  });

  it('overshoots by `settle` and lands on 1', () => {
    const curve = settleCurve((u) => u, 0.03);
    const samples = Array.from({ length: 101 }, (_, i) => curve(i / 100));

    expect(Math.max(...samples)).toBeCloseTo(1.03, 3);
    expect(curve(1)).toBeCloseTo(1, 6);
  });

  it('draws above text by default (CTA plates never hide it)', () => {
    const underline = { type: 'underline', x: 100, y: 400 } as Graphic;
    const section = { name: 's', type: 'color_background', graphics: [underline] } as unknown as Section;
    const ctx = context([], []);

    expect(graphicsToFilters(section, ctx, true).length).toBeGreaterThan(0);
    expect(graphicsToFilters(section, ctx, false)).toEqual([]);
  });

  it('draws nothing where the stroke lowering is absent (no rectangle stand-in)', () => {
    const frame = { width: 1280, height: 720, fps: 30 };

    for (const type of ['frame', 'corners', 'underline']) {
      expect(graphicToFilters({ type } as Graphic, frame), type).toEqual([]);
    }
  });
});

describe('contrast', () => {
  it('keeps an authored colour and shadows it only when it reads poorly', () => {
    expect(pickInk('#FFFFFF', '#F5F3F7', [0.02])).toEqual({ color: '#FFFFFF', shadow: false });
    expect(pickInk('#FFFFFF', '#F5F3F7', [0.8])).toEqual({ color: '#FFFFFF', shadow: true });
    expect(pickInk(null, '#F5F3F7', [0.8, 0.7])).toEqual({ color: DARK_INK, shadow: false });
    expect(pickInk(null, '#F5F3F7', [null])).toEqual({ color: '#F5F3F7', shadow: true });
  });
});
