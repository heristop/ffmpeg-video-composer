// Pixel-effect and broadcast graphics: glitch, focus, progress and ticker. Like the box graphics they
// are sampled once per frame on the compile side and gated by `enable` windows, so the result is
// frame-exact and deterministic; glitch draws its randomness from the element's derived seed.
// Filters used: rgbashift, noise, gblur, drawbox, drawtext (all in the on-device allowlist).

import type { Filter } from '@/core/types';
import { parseEasing } from '@/core/motion/easing';
import { fmt } from '@/core/motion/hermite';
import { seededRandom } from '@/core/determinism/hash';
import { kineticFontFile } from '@/core/kinetic/resolve';
import {
  BRAND,
  INK,
  boxes,
  mergeRuns,
  sampleSteps,
  windowExpr,
  withAlpha,
  type Base,
  type Frame,
  type GraphicEnv,
  type GraphicWindow,
  type Of,
  type Rect,
  type Spec,
} from './graphics-spec';

const SMOOTH = 'cubic-bezier(0.65, 0, 0.35, 1)';
const GLITCH_SHIFT = 26;
const GLITCH_JITTER = 14;

function fullFrame(frame: Frame): Rect[] {
  return [{ x: 0, y: 0, w: frame.width, h: frame.height }];
}

// Full strength through most of the hit, then a quick decay so the tear does not end on a hard edge.
function glitchEnvelope(p: number): number {
  return p < 0.75 ? 1 : Math.max(0, (1 - p) / 0.25);
}

function signed(random: () => number): number {
  return random() * 2 - 1;
}

function glitchFrame(
  step: { from: number; to: number; p: number },
  random: () => number,
  g: { intensity: number; color: string; frame: Frame }
): Filter[] {
  const strength = g.intensity * glitchEnvelope(step.p);
  const split = Math.round(signed(random) * GLITCH_SHIFT * strength);
  const jitter = Math.round(signed(random) * GLITCH_JITTER * strength);
  const slice = random() < 0.6 * strength;
  const [sy, sh, sx, sw] = [random(), random(), random(), random()];
  const enable = windowExpr(step.from, step.to);
  const shift: Filter[] =
    split === 0 && jitter === 0
      ? []
      : [
          {
            type: 'rgbashift',
            values: { rh: jitter + split, gh: jitter, bh: jitter - split, edge: 'wrap', enable },
          } as unknown as Filter,
        ];
  const height = g.frame.height;
  const rect: Rect = {
    x: Math.round(sx * g.frame.width * 0.5),
    y: Math.round(sy * height * 0.9),
    w: Math.round(g.frame.width * (0.2 + sw * 0.6)),
    h: Math.round(2 + sh * height * 0.04),
  };

  return [...shift, ...(slice ? boxes([rect], withAlpha(g.color, 0.6), enable) : [])];
}

function glitchSpec(g: Of<'glitch'>, frame: Frame, base: Base): Spec {
  const duration = g.duration ?? 0.35;
  const intensity = g.intensity ?? 0.6;
  const color = g.color ?? '#FF8AAE';

  return {
    ...base,
    duration,
    ease: g.ease ?? 'linear',
    color,
    above: g.above ?? true,
    holds: false,
    rects: () => fullFrame(frame),
    render: ({ at }: GraphicWindow, env: GraphicEnv) => {
      const random = seededRandom(env.seed);
      const steps = sampleSteps(at, duration, frame.fps);
      const end = steps.at(-1)?.to ?? at + duration;
      const grain = Math.round(10 + intensity * 30);
      const noise = {
        type: 'noise',
        values: { alls: grain, allf: 't+u', all_seed: env.seed % 2147483647, enable: windowExpr(at, end) },
      } as unknown as Filter;

      return [noise, ...steps.flatMap((step) => glitchFrame(step, random, { intensity, color, frame }))];
    },
  };
}

function focusFilters(g: Of<'focus'>, spec: Spec, window: GraphicWindow, fps: number): Filter[] {
  const amount = g.amount ?? 24;
  const sharpening = (g.direction ?? 'in') === 'in';
  const curve = parseEasing(spec.ease).fn;
  const steps = sampleSteps(window.at, spec.duration, fps);
  // Blur radius quantized to half pixels: consecutive frames with the same radius share one filter.
  const samples = steps.map((step) => {
    const p = curve(step.p - 0.5 / steps.length);

    return { ...step, value: Math.round(amount * (sharpening ? 1 - p : p) * 2) / 2 };
  });
  const end = steps.at(-1)?.to ?? window.at + spec.duration;
  // in: the frame waits blurred until `at`; out: it stays blurred until `until` (or the cut).
  const lead = sharpening && window.at > 0 ? [{ from: 0, to: window.at, value: amount }] : [];
  const holds = !sharpening && (window.until === undefined || window.until > end);
  const tail = holds ? [{ from: end, to: window.until, value: amount }] : [];
  const runs = mergeRuns<{ from: number; to: number | undefined; value: number }>(
    [...lead, ...samples, ...tail],
    (run) => String(run.value)
  );

  return runs
    .filter((run) => run.value >= 0.5)
    .map((run) => ({
      type: 'gblur',
      values: { sigma: fmt(run.value), enable: windowExpr(run.from, run.to) },
    }));
}

function focusSpec(g: Of<'focus'>, frame: Frame, base: Base): Spec {
  const spec: Spec = {
    ...base,
    duration: g.duration ?? 0.8,
    ease: g.ease ?? SMOOTH,
    color: g.color ?? INK,
    above: g.above ?? true,
    holds: g.direction === 'out',
    rects: () => fullFrame(frame),
  };

  return { ...spec, render: (window) => focusFilters(g, spec, window, frame.fps) };
}

function progressRect(g: Of<'progress'>, frame: Frame): Rect {
  const thickness = g.thickness ?? 8;
  const y = g.y ?? (g.position === 'top' ? 0 : frame.height - thickness);

  return { x: g.x ?? 0, y, w: g.width ?? frame.width - (g.x ?? 0), h: thickness };
}

function progressSpec(g: Of<'progress'>, frame: Frame, base: Base): Spec {
  const full = progressRect(g, frame);
  const spec: Spec = {
    ...base,
    duration: g.duration ?? 3,
    ease: g.ease ?? 'linear',
    color: g.color ?? BRAND,
    rects: (p) => [{ ...full, w: Math.round(full.w * p) }],
  };

  return {
    ...spec,
    render: ({ at, until }) => {
      const curve = parseEasing(spec.ease).fn;
      const steps = sampleSteps(at, spec.duration, frame.fps).map((s) => ({ ...s, value: spec.rects(curve(s.p)) }));
      const end = steps.at(-1)?.to ?? at;
      const fill = mergeRuns(steps, (step) => String(step.value[0].w)).flatMap((run) =>
        boxes(run.value, spec.color, windowExpr(run.from, run.to))
      );
      const track = g.track ? boxes([full], g.track, windowExpr(at, until)) : [];
      const held = until === undefined || until > end ? boxes([full], spec.color, windowExpr(end, until)) : [];

      return [...track, ...fill, ...held];
    },
  };
}

function tickerText(g: Of<'ticker'>, band: Rect, window: GraphicWindow, duration: number): Filter {
  const size = g.size ?? Math.round(band.h * 0.6);
  const speed = g.speed ?? 160;
  const start = window.at + duration;
  const lineTop = band.y + (band.h - size) / 2;

  return {
    type: 'drawtext',
    values: {
      text: { ...g.text },
      fontfile: kineticFontFile(g.font),
      fontsize: size,
      fontcolor: g.textColor ?? INK,
      // Enters from the right edge and loops once the whole line has left on the left.
      x: `'w-mod((t-${fmt(start)})*${fmt(speed)},w+tw)'`,
      y: `'${fmt(lineTop + size * 0.8)}-max_glyph_a'`,
      alpha: `'clip((t-${fmt(start)})/0.2,0,1)'`,
      enable: windowExpr(start, window.until),
    },
  };
}

function tickerSpec(g: Of<'ticker'>, frame: Frame, base: Base): Spec {
  const h = g.height ?? Math.round(frame.height * 0.07);
  const band: Rect = { x: 0, y: g.position === 'top' ? 0 : frame.height - h, w: frame.width, h };
  const duration = g.duration ?? 0.4;

  return {
    ...base,
    duration,
    color: g.color ?? '#141416@0.9',
    rects: (p) => [{ ...band, w: band.w * p }],
    extras: (window) => [tickerText(g, band, window, duration)],
  };
}

export const FX_SPECS = {
  glitch: glitchSpec,
  focus: focusSpec,
  progress: progressSpec,
  ticker: tickerSpec,
};
