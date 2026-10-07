import { describe, expect, it } from 'vitest';
import type { Filter, FilterGraphChain, Section } from '@/core/types';
import { ballisticApex, ballisticAt, ballisticExpr, ballisticVelocity, type Ballistic } from '@/core/motion/ballistic';
import { lowerFx, REGISTERED_FX } from '@/editor/presets/fx';
import { parseSpriteUrl } from '@/editor/presets/fx-sprites';
import type { SugarContext } from '@/editor/presets/sugar-context';
import { FX_PRIMITIVES, type FxGraphic } from '@/schemas/fx.schemas';
import { GraphicSchema } from '@/schemas/graphics.schemas';

interface Options {
  energy?: number;
  has?: (filter: string) => boolean;
  seed?: number;
  scale?: string;
  theme?: unknown;
}

interface Lowered {
  text: string;
  chains: FilterGraphChain[];
  inputs: string[];
  warnings: string[];
}

function lower(graphic: Partial<FxGraphic>, options: Options = {}): Lowered {
  const inputs: string[] = [];
  const warnings: string[] = [];
  const ctx: SugarContext = {
    duration: 4,
    scale: options.scale ?? '1280:720',
    fps: 30,
    isVideo: false,
    theme: options.theme,
    motion: { energy: options.energy ?? 1, seedFor: () => 1, resolveText: () => '' },
    masks: {
      available: true,
      input: (key, source) => {
        inputs.push('url' in source ? source.url : '');

        return `input:${key}`;
      },
      color: (color) => color,
      warn: (message) => warnings.push(message),
      has: options.has ?? (() => true),
    },
  };
  const g = { type: 'fx', ...graphic } as FxGraphic;
  const section = { name: 's', type: 'color_background', graphics: [g] } as unknown as Section;
  const filters = lowerFx({ graphic: g, at: 0.4, until: undefined, seed: options.seed ?? 77, index: 1, section, ctx });
  const chains = filters.flatMap((filter) => filter.graph ?? []);

  return { text: render(chains), chains, inputs, warnings };
}

function render(chains: FilterGraphChain[]): string {
  return chains
    .map((chain) => {
      const ins = (chain.inputs ?? []).map((label) => `[${label}]`).join('');
      const outs = (chain.outputs ?? []).map((label) => `[${label}]`).join('');

      return `${ins}${chain.filters.map((f: Filter) => (f.value ? `${f.type}=${String(f.value)}` : f.type)).join(',')}${outs}`;
    })
    .join(';');
}

function count(text: string, pattern: RegExp): number {
  return [...text.matchAll(pattern)].length;
}

const BUTTON = { x: 560, y: 320, w: 160, h: 80, radius: 20 };
const CARD = { x: 200, y: 120, w: 600, h: 360 };

describe('fx primitive rows', () => {
  it('registers ripple, glint and confetti with every primitive row', () => {
    expect(REGISTERED_FX).toEqual(expect.arrayContaining(['ripple', 'glint', 'confetti']));
    expect(REGISTERED_FX).toEqual(Object.keys(FX_PRIMITIVES));
  });

  it('validates their own parameters strictly', () => {
    const ok = [
      { effect: 'ripple', variant: 'tap', origin: { x: 0.3, y: 0.5 }, rings: 2, stroke: 5 },
      { effect: 'glint', path: 'orbit', count: 3, trail: 0.6, speed: 1.2 },
      { effect: 'glint', points: [{ x: 0.1, y: 0.2 }], spin: -20 },
      { effect: 'confetti', colors: ['#FF0000', '$color.accent'], gravity: 2, drag: 1, angle: -60, spread: 40 },
    ];

    for (const graphic of ok) expect(GraphicSchema.safeParse({ type: 'fx', ...graphic }).success).toBe(true);

    const bad = [
      { effect: 'ripple', rings: 9 },
      { effect: 'ripple', path: 'orbit' },
      { effect: 'glint', variant: 'tap' },
      { effect: 'confetti', count: 80 },
      { effect: 'confetti', colors: [] },
    ];

    for (const graphic of bad) expect(GraphicSchema.safeParse({ type: 'fx', ...graphic }).success).toBe(false);
  });
});

describe('fx ripple', () => {
  it('scales one ring sprite rendered at its final size down, never up, and fades it as (1 - p)²', () => {
    const { text, inputs } = lower({ effect: 'ripple', target: BUTTON, radius: 1 });
    const ring = parseSpriteUrl(inputs[0]);

    expect(inputs).toHaveLength(1);
    expect(ring?.kind).toBe('ring');
    expect(ring?.radius).toBe(80);
    // Default stroke 5 px at 1080p, scaled to the 720p frame: a ring that still reads on a dark card.
    expect(ring?.stroke).toBe(3.3);
    // Default 2 rings, 0.375 → 1 of the sprite (expo), two chained alpha fades per ring.
    expect(count(text, /overlay=x=/g)).toBe(2);
    expect(text).toContain('split=2');
    expect(text).toMatch(/scale=w='max\(2,2\*trunc\(\d+\*\(0\.375\+0\.625\*\(/);
    expect(count(text, /fade=t=out:st=0\.4:d=[\d.]+:alpha=1/g)).toBe(2);
    expect(text).not.toMatch(/scale=w='[^']*\*1\.[1-9]/);
  });

  it('lets the ring leave its target: the region is a square around the origin, unmasked', () => {
    const { text } = lower({ effect: 'ripple', target: BUTTON, radius: 1, origin: { x: 0, y: 0 } });

    expect(text).not.toContain('alphamerge');
    expect(text).toMatch(/overlay=(\d+):(\d+):eof_action=pass/);

    const [, x, y] = /overlay=(\d+):(\d+):eof_action=pass/.exec(text) ?? [];

    expect(Number(x)).toBeLessThan(BUTTON.x);
    expect(Number(y)).toBeLessThan(BUTTON.y);
  });

  it('draws a tap as a pressed dot plus one ring in the theme accent', () => {
    const { text, inputs } = lower({ effect: 'ripple', variant: 'tap', target: BUTTON }, { theme: 'leclap' });
    const kinds = inputs.map((url) => parseSpriteUrl(url));

    expect(new Set(kinds.map((spec) => spec?.kind))).toEqual(new Set(['piece', 'ring']));
    expect(kinds.every((spec) => spec?.color === 'ff8aae')).toBe(true);
    expect(count(text, /overlay=x=/g)).toBe(2);
    expect(text).toMatch(/0\.91-0\.09\*\(/);
  });

  it('honours an authored colour, every pass of repeat, and reduced motion', () => {
    expect(lower({ effect: 'ripple', target: BUTTON, color: '#00FF00' }).inputs[0]).toContain('c=00ff00');
    expect(count(lower({ effect: 'ripple', target: BUTTON, repeat: 3 }).text, /overlay=x=/g)).toBe(6);

    const reduced = lower({ effect: 'ripple', target: BUTTON }, { energy: 0 }).text;

    expect(count(reduced, /overlay=x=/g)).toBe(1);
    expect(reduced).not.toContain('eval=frame');
  });

  it('skips with a warning when scale is missing', () => {
    const { text, warnings } = lower({ effect: 'ripple', target: BUTTON }, { has: (f) => f !== 'scale' });

    expect(text).toBe('');
    expect(warnings[0]).toContain('fx_skipped');
  });
});

describe('fx glint', () => {
  it('twinkles 3–5 stars of one sprite inside 1.2 s, turning and scaling each', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { text, inputs } = lower({ effect: 'glint', target: CARD }, { seed });
      const stars = count(text, /overlay=x=/g);
      const ends = [...text.matchAll(/trim=start=[\d.]+:end=([\d.]+)/g)].map((m) => Number(m[1]));

      expect(inputs).toHaveLength(1);
      expect(parseSpriteUrl(inputs[0])?.kind).toBe('star');
      expect(stars).toBeGreaterThanOrEqual(3);
      expect(stars).toBeLessThanOrEqual(5);
      expect(Math.max(...ends) - 0.4).toBeLessThanOrEqual(1.2);
      expect(count(text, /rotate=a='/g)).toBe(stars);
    }
  });

  it('derives different layouts per seed, and honours points, count, size and spin', () => {
    const layouts = new Set([1, 2, 3, 4].map((seed) => lower({ effect: 'glint', target: CARD }, { seed }).text));

    expect(layouts.size).toBe(4);

    const pinned = lower({ effect: 'glint', target: CARD, points: [{ x: 0.5, y: 0.5 }], spin: 0, size: 40 });

    expect(count(pinned.text, /overlay=x=/g)).toBe(1);
    expect(pinned.text).not.toContain('rotate');
    expect(pinned.text).toContain("overlay=x='");
  });

  it('orbits lights with trail ghosts around the target (the former spec orbit)', () => {
    const { text, inputs } = lower({ effect: 'glint', path: 'orbit', target: CARD });

    expect(new Set(inputs.map((url) => parseSpriteUrl(url)?.kind))).toEqual(new Set(['disc', 'star']));
    // 2 heads + 3 ghosts each.
    expect(count(text, /overlay=x=/g)).toBe(8);
    expect(text).toMatch(/cos\([\d.]+\+[\d.]+\*\(t-/);
    expect(count(lower({ effect: 'glint', path: 'orbit', target: CARD, trail: 0 }).text, /overlay=x=/g)).toBe(2);
  });

  it('keeps every glint graphic within its overlay budget, and rests in reduced motion', () => {
    const many = lower({ effect: 'glint', target: CARD, count: 6, repeat: 8, every: 1.5 }).text;

    expect(count(many, /overlay=x=/g)).toBeLessThanOrEqual(24);

    const reduced = lower({ effect: 'glint', target: CARD }, { energy: 0 }).text;

    expect(reduced).not.toContain('eval=frame');
    expect(reduced).not.toContain('rotate');
  });
});

describe('fx confetti', () => {
  it('launches 28–36 pieces in the theme palette, at most 36 overlays even when repeated', () => {
    const { text, inputs } = lower({ effect: 'confetti', target: 'frame' }, { theme: 'leclap' });
    const colors = new Set(inputs.map((url) => parseSpriteUrl(url)?.color));
    const pieces = count(text, /overlay=x=/g);
    const strips = inputs.map((url) => parseSpriteUrl(url)).filter((spec) => spec && spec.w !== spec.h);

    expect(pieces).toBeGreaterThanOrEqual(28);
    expect(pieces).toBeLessThanOrEqual(36);
    // Default long side 28 px at 1080p (≈ 18 px at 720p): paper that reads at phone scale.
    expect(strips.length).toBeGreaterThan(0);
    expect(strips.every((spec) => spec?.w === 18)).toBe(true);
    expect(colors).toEqual(new Set(['7c83fd', 'f5f3f7', 'ff8aae', 'fff685']));
    expect(count(lower({ effect: 'confetti', count: 36, repeat: 3, every: 2.5 }).text, /overlay=x=/g)).toBe(36);
  });

  it('tumbles and flutters every piece and follows a ballistic path', () => {
    const { text } = lower({ effect: 'confetti', count: 6, colors: ['#FF0000'] });

    expect(count(text, /rotate=a='[\d.-]+\+-?[\d.]+\*\(t-0\.4\)':c=none/g)).toBe(6);
    expect(count(text, /abs\(cos\(/g)).toBe(6);
    expect(text).toMatch(/exp\(-[\d.]+\*\(t-0\.4\)\)/);
    expect(text).toContain('fade=t=in:st=0.4:d=0.133333:alpha=1');
  });

  it('uses authored colours and drops the tumble without rotate', () => {
    const { inputs } = lower({ effect: 'confetti', count: 8, colors: ['#123456', 'red'] });

    expect(new Set(inputs.map((url) => parseSpriteUrl(url)?.color))).toEqual(new Set(['123456', 'ff0000']));
    expect(lower({ effect: 'confetti', count: 4 }, { has: (f) => f !== 'rotate' }).text).not.toContain('rotate');
  });

  it('is deterministic per seed and varies across seeds', () => {
    expect(lower({ effect: 'confetti' }).text).toBe(lower({ effect: 'confetti' }).text);
    expect(lower({ effect: 'confetti' }, { seed: 1 }).text).not.toBe(lower({ effect: 'confetti' }, { seed: 2 }).text);
  });

  it('becomes a still scatter of at most 12 pieces in reduced motion', () => {
    const reduced = lower({ effect: 'confetti' }, { energy: 0 }).text;

    expect(count(reduced, /overlay=x=/g)).toBeLessThanOrEqual(12);
    expect(reduced).not.toContain('eval=frame');
    expect(reduced).not.toContain('(t-');
  });
});

describe('ballistic flight', () => {
  const flight: Ballistic = {
    x0: 100,
    y0: 500,
    vx: 200,
    vy: -900,
    gravity: 1000,
    drag: 3,
    sway: 0,
    swayRate: 1,
    swayPhase: 0,
  };

  it('rises to an apex, then falls with visible gravity (y″ > 0) toward terminal velocity', () => {
    const apex = ballisticApex(flight);

    expect(apex.T).toBeGreaterThan(0);
    expect(ballisticVelocity(flight, apex.T).vy).toBeCloseTo(0, 6);
    expect(ballisticAt(flight, apex.T + 0.5).y).toBeGreaterThan(apex.y);

    for (const T of [0.1, 0.5, 1, 2]) {
      const dt = 0.01;
      const accel =
        (ballisticAt(flight, T + dt).y - 2 * ballisticAt(flight, T).y + ballisticAt(flight, T - dt).y) / dt ** 2;

      expect(accel).toBeGreaterThan(0);
    }

    expect(ballisticVelocity(flight, 10).vy).toBeCloseTo(flight.gravity / flight.drag, 3);
  });

  // The two expression shapes ballisticExpr emits, evaluated at T.
  function evaluate(text: string, T: number): number {
    const n = String.raw`(-?[\d.]+)`;
    const x = new RegExp(
      `^${n}\\+${n}\\*\\(1-exp\\(-${n}\\*\\(T\\)\\)\\)\\+${n}\\*sin\\(${n}\\*\\(T\\)\\+${n}\\)$`
    ).exec(text);
    const y = new RegExp(`^${n}\\+${n}\\*\\(1-exp\\(-${n}\\*\\(T\\)\\)\\)\\+${n}\\*\\(T\\)$`).exec(text);
    const [a, b, k, c, d, e] = (x ?? y ?? []).slice(1).map(Number);

    if (!x && !y) throw new Error(`unexpected expression ${text}`);

    return a + b * (1 - Math.exp(-k * T)) + (x ? c * Math.sin(d * T + e) : c * T);
  }

  it('emits FFmpeg expressions that evaluate to the same path', () => {
    const swaying = { ...flight, sway: 12, swayRate: 1.3, swayPhase: 0.7 };
    const expr = ballisticExpr(swaying, '(T)');

    for (const T of [0, 0.3, 1.1]) {
      expect(evaluate(expr.x, T)).toBeCloseTo(ballisticAt(swaying, T).x, 2);
      expect(evaluate(expr.y, T)).toBeCloseTo(ballisticAt(swaying, T).y, 2);
    }
  });
});
