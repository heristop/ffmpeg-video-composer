import { describe, expect, it } from 'vitest';
import { designedTransitionGraph, isDesignedTransition } from '@/core/motion/transitions';
import { whipBlur } from '@/core/motion/whip';
import { graphicDuration, graphicTiming, graphicToFilters } from '@/editor/presets/graphics';
import { kineticToFilters } from '@/editor/presets/kinetic';
import { MAX_TRAIL_FILTERS } from '@/editor/presets/kinetic-trail';
import { motionTimeline } from '@/core/motion/timeline';
import { motionCatalog } from '@/core/motion/catalog';
import { DEVICE_FILTERS } from '@/editor/utils/device-filters.generated';
import { GraphicSchema, type Graphic } from '@/schemas/graphics.schemas';
import { KineticBlockSchema } from '@/schemas/kinetic.schemas';
import { TemplateValidator } from '@/services/TemplateValidator';
import { evaluateExpr } from '@/services/geometry/drawtext-expr';
import type { Filter } from '@/core/types';

const FRAME = { width: 1280, height: 720, fps: 30 };
const KINETIC = { ...FRAME, duration: 3, seed: 7, energy: 1 };

type Values = Record<string, string | number>;

function values(list: Filter[], type?: string): Values[] {
  return list.filter((f) => type === undefined || f.type === type).map((f) => f.values as unknown as Values);
}

function graphic(spec: unknown, seed = 3): Filter[] {
  return graphicToFilters(GraphicSchema.parse(spec), FRAME, { seed });
}

// The [from, to) window of a `'gte(t,a)*lt(t,b)'` / `'gte(t,a)'` enable expression.
function windowOf(enable: unknown): [number, number] {
  const match = /gte\(t,([\d.]+)\)(?:\*lt\(t,([\d.]+)\))?/.exec(String(enable));

  return [Number(match?.[1]), match?.[2] === undefined ? Infinity : Number(match[2])];
}

describe('kinetic echo trail', () => {
  const base = { text: { en: 'Fast lane' }, preset: 'slide', delay: 0.2 } as const;

  function drawn(trail?: unknown, extra: Record<string, unknown> = {}): Values[] {
    const block = KineticBlockSchema.parse({ ...base, ...extra, ...(trail ? { trail } : {}) });

    return values(kineticToFilters(block, { ...KINETIC, text: 'Fast lane' }), 'drawtext');
  }

  it('leaves the block untouched without a trail', () => {
    const plain = drawn();

    expect(plain).toHaveLength(2);
    expect(plain.every((v) => !('enable' in v))).toBe(true);
  });

  it('draws each unit on delayed clocks, farthest echo first, fading per echo', () => {
    const list = drawn({ echoes: 3, delta: 0.05, fade: 0.5 });

    expect(list).toHaveLength(8);
    const [far, mid, near, unit] = list;
    expect(String(far.x)).toContain('(t-0.15)');
    expect(String(mid.x)).toContain('(t-0.1)');
    expect(String(near.x)).toContain('(t-0.05)');
    expect(String(unit.x)).not.toContain('(t-0.05)');
    expect(String(far.alpha)).toMatch(/\*0\.125'$/);
    expect(String(near.alpha)).toMatch(/\*0\.5'$/);
    expect(unit.enable).toBeUndefined();
  });

  it('echoes trail the unit in space and converge once it rests', () => {
    const [echo, , , unit] = drawn({ echoes: 3, delta: 0.05 });
    const x = (v: Values, t: number) => evaluateExpr(String(v.x).slice(1, -1), { t }) as number;

    // Mid-flight the echo is where the unit was 0.15 s ago (slide travels left: it lags to the right).
    expect(x(echo, 0.35)).toBeCloseTo(x(unit, 0.2), 6);
    expect(x(echo, 0.35)).toBeGreaterThan(x(unit, 0.35));
    expect(x(echo, 2.5)).toBeCloseTo(x(unit, 2.5), 6);
  });

  it('enables echoes only while the unit moves (entrance, then exit)', () => {
    const [echo] = drawn({ echoes: 2 }, { exit: { preset: 'fade', at: 2 } });
    const enable = String(echo.enable).slice(1, -1);

    expect(enable).toMatch(/^between\(t,0\.2,[\d.]+\)\+between\(t,2,[\d.]+\)$/);
    expect(evaluateExpr(enable, { t: 0.25 })).toBe(1);
    expect(evaluateExpr(enable, { t: 1.5 })).toBe(0);
    expect(evaluateExpr(enable, { t: 2.1 })).toBe(1);
  });

  it('is deterministic and caps the echo cost on long copy', () => {
    expect(drawn({ echoes: 4 })).toEqual(drawn({ echoes: 4 }));

    const text = Array.from({ length: 60 }, (_, i) => `w${i}`).join(' ');
    const block = KineticBlockSchema.parse({ text: { en: text }, preset: 'cascade', trail: { echoes: 6 } });
    const echoes = values(kineticToFilters(block, { ...KINETIC, text }), 'drawtext').filter((v) => v.enable);

    expect(echoes.length).toBeLessThanOrEqual(MAX_TRAIL_FILTERS);
  });

  it('ignores the counter preset and rejects out-of-range trails', () => {
    const counter = KineticBlockSchema.parse({
      text: { en: '' },
      preset: 'counter',
      counter: { from: 0, to: 9 },
      trail: { echoes: 3 },
    });

    expect(kineticToFilters(counter, { ...KINETIC, text: '' })).toHaveLength(1);
    expect(KineticBlockSchema.safeParse({ ...base, trail: { echoes: 7 } }).success).toBe(false);
    expect(KineticBlockSchema.safeParse({ ...base, trail: { echoes: 2, blur: 1 } }).success).toBe(false);
  });
});

describe('whip transitions', () => {
  const boundary = { left: 'vs0', right: 'vs1', out: 'v0', id: 'dt0', offset: 2, duration: 0.5, ...FRAME };

  function sigmas(chain: string): Array<{ h: number; v: number; from: number; to: number }> {
    return [
      ...chain.matchAll(/gblur=sigma=([\d.]+):sigmaV=([\d.]+):enable='gte\(t,([\d.]+)\)\*lt\(t,([\d.]+)\)'/g),
    ].map((m) => ({ h: Number(m[1]), v: Number(m[2]), from: Number(m[3]), to: Number(m[4]) }));
  }

  it('is a push composed into an intermediate pad, then blurred into the mix', () => {
    const graph = designedTransitionGraph({ ...boundary, type: 'whip-left' });

    expect(isDesignedTransition('whip-left')).toBe(true);
    expect(graph).toContain('[dt0tail]pad=2560:720:0:0[dt0p]');
    expect(graph).toMatch(/crop=1280:720:x='[^']+':y=0\[dt0w\];\[dt0w\]gblur=/);
    expect(graph).toMatch(/\[dt0mix\];\[dt0head\]\[dt0mix\]\[dt0rest\]concat/);
  });

  it('blurs along the travel axis, hardest at peak speed, sharp at both ends', () => {
    const runs = sigmas(whipBlur({ ease: 'cubic-bezier(0.7, 0, 0.2, 1)', duration: 0.5, ...FRAME, type: 'whip-left' }));
    const peak = runs.reduce((a, b) => (b.h > a.h ? b : a));

    expect(runs.length).toBeGreaterThan(2);
    expect(runs.every((r) => r.v === 0.5)).toBe(true);
    expect(peak.h).toBeGreaterThan(30);
    expect(peak.from).toBeGreaterThan(0.1);
    expect(peak.to).toBeLessThan(0.4);
    expect(runs[0].from).toBeGreaterThan(0);
    expect(runs.at(-1)?.to).toBeLessThan(0.5);
    // Disjoint windows: no frame is blurred twice.
    for (let i = 1; i < runs.length; i++) expect(runs[i].from).toBeGreaterThanOrEqual(runs[i - 1].to - 1e-9);
  });

  it('follows the shutter: the blur fades in with the speed, and a longer whip blurs less', () => {
    const ease = 'cubic-bezier(0.7, 0, 0.2, 1)';
    const short = sigmas(whipBlur({ ease, duration: 0.4, ...FRAME, type: 'whip-left' }));
    const long = sigmas(whipBlur({ ease, duration: 0.8, ...FRAME, type: 'whip-left' }));
    const peak = (runs: typeof short) => Math.max(...runs.map((r) => r.h));

    // No threshold: the first blurred frames are light, and the radius climbs before it peaks.
    expect(short[0].h).toBeLessThanOrEqual(3);
    expect(short.findIndex((r) => r.h === peak(short))).toBeGreaterThan(2);
    expect(peak(long)).toBeLessThan(peak(short) * 0.7);
    // Gated half a frame before each frame's instant, never on it.
    const frame = 1 / FRAME.fps;
    for (const r of short) expect(((r.from / frame) * 2) % 2).toBeCloseTo(1, 3);
  });

  it('vertical whips blur vertically; a linear ease still peaks; graphs are deterministic', () => {
    const up = sigmas(whipBlur({ ease: 'linear', duration: 0.4, ...FRAME, type: 'whip-up' }));

    expect(up.every((r) => r.h === 0.5 && r.v > 1)).toBe(true);
    expect(designedTransitionGraph({ ...boundary, type: 'whip-down' })).toBe(
      designedTransitionGraph({ ...boundary, type: 'whip-down' })
    );
  });

  it('every whip uses filters in the on-device allowlist', () => {
    for (const type of ['whip-left', 'whip-right', 'whip-up', 'whip-down'] as const) {
      const graph = designedTransitionGraph({ ...boundary, type });
      const filters = new Set([...graph.matchAll(/[\];,]([a-z]+)=/g)].map((m) => m[1]));

      for (const filter of filters) expect(DEVICE_FILTERS.has(filter), `${type}: ${filter}`).toBe(true);
    }
  });
});

describe('glitch', () => {
  it('lowers to seeded rgbashift / noise / slices inside its window', () => {
    const list = graphic({ type: 'glitch', at: 1, duration: 0.3, intensity: 0.8 });
    const types = new Set(list.map((f) => f.type));

    expect(types).toEqual(new Set(['noise', 'rgbashift', 'drawbox']));
    for (const v of values(list)) {
      const [from, to] = windowOf(v.enable);

      expect(from).toBeGreaterThanOrEqual(1);
      expect(to).toBeLessThanOrEqual(1.3 + 1e-6);
    }
    expect(values(list, 'rgbashift')[0]).toMatchObject({ edge: 'wrap' });
  });

  it('is deterministic per seed and reshuffles with a new seed', () => {
    const spec = { type: 'glitch', duration: 0.4 };

    expect(graphic(spec, 5)).toEqual(graphic(spec, 5));
    expect(graphic(spec, 5)).not.toEqual(graphic(spec, 6));
  });

  it('is a full-frame hit drawn above text by default', () => {
    const timing = graphicTiming(GraphicSchema.parse({ type: 'glitch' }), FRAME);

    expect(timing.holds).toBe(false);
    expect(timing.bbox).toEqual({ x: 0, y: 0, w: 1280, h: 720 });
  });
});

describe('focus', () => {
  function blurs(spec: unknown): Array<{ sigma: number; from: number; to: number }> {
    return values(graphic(spec), 'gblur').map((v) => {
      const [from, to] = windowOf(v.enable);

      return { sigma: Number(v.sigma), from, to };
    });
  }

  it('in: waits blurred until `at`, then sharpens on the curve and ends sharp', () => {
    const runs = blurs({ type: 'focus', at: 0.5, duration: 0.6, amount: 20 });

    expect(runs[0]).toMatchObject({ sigma: 20, from: 0 });
    expect(runs[0].to).toBeGreaterThanOrEqual(0.5);
    for (let i = 1; i < runs.length; i++) expect(runs[i].sigma).toBeLessThan(runs[i - 1].sigma);
    expect(runs.at(-1)?.to).toBeLessThanOrEqual(1.1 + 1e-6);
  });

  it('out: blurs up and holds until `until`', () => {
    const runs = blurs({ type: 'focus', direction: 'out', at: 1, duration: 0.5, until: 2.5, amount: 12 });

    expect(runs[0].from).toBeGreaterThanOrEqual(1);
    expect(runs.at(-1)).toMatchObject({ sigma: 12, to: 2.5 });
    expect(new Set(runs.map((r) => r.sigma)).size).toBe(runs.length);
  });
});

describe('progress', () => {
  it('fills left to right on a linear clock, with a track, then holds full', () => {
    const list = values(graphic({ type: 'progress', at: 0, duration: 2, thickness: 6, track: '#FFFFFF@0.2' }));
    const [track, ...fill] = list;
    const held = fill.at(-1) as Values;

    expect(track).toMatchObject({ y: '714', w: '1280', h: '6', color: '#FFFFFF@0.2' });
    expect(fill.slice(0, -1).map((v) => Number(v.w))).toEqual(
      fill
        .slice(0, -1)
        .map((v) => Number(v.w))
        .toSorted((a, b) => a - b)
    );
    expect(held).toMatchObject({ w: '1280', enable: "'gte(t,2)'" });
  });

  it('steps a long fill instead of sampling every frame', () => {
    const list = graphic({ type: 'progress', duration: 60, position: 'top' });

    expect(list.length).toBeLessThanOrEqual(91);
    expect(values(list)[0]).toMatchObject({ y: '0' });
    expect(graphicDuration(GraphicSchema.parse({ type: 'progress', duration: 60 }), FRAME)).toBe(60);
  });
});

describe('ticker', () => {
  it('grows its band, then scrolls the copy right to left in a loop', () => {
    const list = graphic({ type: 'ticker', at: 1, text: { en: 'BREAKING' }, speed: 200, duration: 0.4 });
    const [text] = values(list, 'drawtext');
    const band = values(list, 'drawbox').at(-1) as Values;
    const x = String(text.x).slice(1, -1);

    expect(band).toMatchObject({ y: '670', h: '50', w: '1280', enable: "'gte(t,1.4)'" });
    expect(text.text).toEqual({ en: 'BREAKING' });
    expect(x).toBe('w-mod((t-1.4)*200,w+tw)');
    expect(evaluateExpr(x, { t: 1.4, w: 1280, text_w: 300 })).toBe(1280);
    expect(evaluateExpr(x, { t: 2.4, w: 1280, text_w: 300 })).toBe(1080);
    expect(windowOf(text.enable)[0]).toBe(1.4);
  });
});

describe('bars-chart', () => {
  const chart = {
    type: 'bars-chart',
    at: 0.5,
    values: [10, 40, 20],
    labels: ['A', 'B', ''],
    duration: 0.5,
    stagger: 0.1,
  };

  it('grows each bar from the baseline after the previous one, then holds', () => {
    const list = graphic(chart);
    const bars = values(list, 'drawbox');
    const starts = [...new Set(bars.map((b) => b.x))].map((x) =>
      Math.min(...bars.filter((b) => b.x === x).map((b) => windowOf(b.enable)[0]))
    );

    expect(starts).toEqual([0.5, 0.6, 0.7]);
    for (const b of bars) expect(Number(b.y) + Number(b.h)).toBeCloseTo(720 * 0.22 + 720 * 0.45, 3);
    const tallest = bars.filter((b) => windowOf(b.enable)[1] === Infinity).map((b) => Number(b.h));
    expect(tallest[1]).toBe(Math.max(...tallest));
    expect(tallest[0] / tallest[1]).toBeCloseTo(0.25, 1);
  });

  it('rolls value labels with the counter text and draws category labels', () => {
    const texts = values(graphic({ ...chart, prefix: '$' }), 'drawtext');

    expect(texts.filter((t) => t.textExpr)).toHaveLength(3);
    expect(String(texts.find((t) => t.textExpr)?.textExpr)).toMatch(/^\$%\{eif/);
    expect(texts.filter((t) => t.text).map((t) => t.text)).toEqual(['A', 'B']);
    expect(values(graphic({ ...chart, showValues: false }), 'drawtext')).toHaveLength(2);
  });

  it('times the whole chart: last bar start + its grow time', () => {
    const parsed = GraphicSchema.parse(chart) as Graphic;

    expect(graphicDuration(parsed, FRAME)).toBeCloseTo(0.7, 6);
  });
});

describe('fx graphics in the motion system', () => {
  const descriptor = (graphics: unknown[]) => ({
    meta: { name: 'fx' },
    global: { orientation: 'landscape', fps: 30 },
    sections: [{ name: 's', type: 'color_background', options: { duration: 4 }, graphics }],
  });

  it('validates every new type and rejects unknown keys', () => {
    const validator = new TemplateValidator();
    const ok = descriptor([
      { type: 'glitch', at: 0.2 },
      { type: 'focus', direction: 'out', at: '50%' },
      { type: 'progress', id: 'bar', duration: 3 },
      { type: 'ticker', at: 'bar.start', text: { en: 'News' } },
      { type: 'bars-chart', values: [1, 2], at: 'bar.end - 1' },
    ]);

    expect(validator.validateTemplate(ok).errors ?? []).toEqual([]);
    expect(validator.validateTemplate(descriptor([{ type: 'glitch', speed: 3 }])).success).toBe(false);
    expect(validator.validateTemplate(descriptor([{ type: 'bars-chart', values: [] }])).success).toBe(false);
  });

  it('puts them on the timeline: hits are not entrances, the ticker keeps moving', () => {
    const events = motionTimeline(
      descriptor([
        { type: 'glitch', at: 0.2 },
        { type: 'focus', at: 0.1 },
        { type: 'ticker', at: 0.5, text: { en: 'News' } },
        { type: 'bars-chart', at: 1, values: [1, 2, 3], stagger: 0.1, duration: 0.5 },
      ])
    ).sections[0].events;
    const [glitch, focus, ticker, chart] = [0, 1, 2, 3].map((i) => events.find((e) => e.element === `graphics[${i}]`));

    expect(glitch).toMatchObject({ entrance: false, start: 0.2, end: 0.55, preset: 'glitch' });
    expect(focus?.entrance).toBe(false);
    expect(ticker).toMatchObject({ entrance: true, continuous: true, visibleUntil: 4 });
    expect(chart).toMatchObject({ entrance: true, start: 1, end: 1.7 });
  });

  it('only emits filters available on device, and the catalog guides every new entry', () => {
    const all = [
      graphic({ type: 'glitch' }),
      graphic({ type: 'focus' }),
      graphic({ type: 'progress' }),
      graphic({ type: 'ticker', text: { en: 'x' } }),
      graphic({ type: 'bars-chart', values: [1] }),
    ].flat();

    for (const filter of all) expect(DEVICE_FILTERS.has(filter.type), filter.type).toBe(true);

    const catalog = motionCatalog();
    for (const type of ['whip-left', 'whip-right', 'whip-up', 'whip-down']) {
      expect(catalog.transitions[type].verb).toMatch(/WHIP/);
    }
    expect(catalog.graphics.glitch.verb).toBe('GLITCHES');
    expect(catalog.kinetic.trail.verb).toBe('SMEARS');
    expect(catalog.doctrine['social-hook'].do.join(' ')).toMatch(/glitch/);
    expect(catalog.doctrine['cinematic-trailer'].do.join(' ')).toMatch(/focus/);
  });
});
