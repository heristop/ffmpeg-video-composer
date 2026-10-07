// bars-chart: bars grow from a shared baseline one after another, each on the graphic's curve, while a
// value label rides the bar top and counts up (the kinetic counter's text expansion). Each bar is one
// drawbox per distinct frame height behind an `enable` window; labels are drawtext.

import type { Filter } from '@/core/types';
import { parseEasing } from '@/core/motion/easing';
import { easedProgressExpr, fmt } from '@/core/motion/hermite';
import { counterText } from '@/core/kinetic/extras';
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
  type GraphicWindow,
  type Of,
  type Spec,
} from './graphics-spec';

type Chart = Of<'bars-chart'>;

interface Geometry {
  x: number;
  y: number;
  width: number;
  height: number;
  baseline: number;
  slot: number;
  barWidth: number;
  /** Height of a bar at `max`, below the room kept for its value label. */
  full: number;
  size: number;
  max: number;
}

function geometry(g: Chart, frame: Frame): Geometry {
  const [x, y] = [g.x ?? frame.width * 0.12, g.y ?? frame.height * 0.22];
  const [width, height] = [g.width ?? frame.width * 0.76, g.height ?? frame.height * 0.45];
  const slot = width / g.values.length;
  const barWidth = slot * (1 - (g.gap ?? 0.3));
  const size = Math.max(12, Math.round(Math.min(barWidth * 0.45, frame.height * 0.045)));
  const max = g.max ?? Math.max(...g.values);

  return {
    x,
    y,
    width,
    height,
    baseline: y + height,
    slot,
    barWidth,
    full: Math.max(1, height - size * 1.4),
    size,
    max: max > 0 ? max : 1,
  };
}

interface Bar {
  index: number;
  value: number;
  start: number;
  left: number;
  center: number;
}

function bars(g: Chart, geo: Geometry, at: number): Bar[] {
  const stagger = g.stagger ?? 0.08;

  return g.values.map((value, index) => {
    const left = geo.x + index * geo.slot + (geo.slot - geo.barWidth) / 2;

    return { index, value, start: at + index * stagger, left, center: left + geo.barWidth / 2 };
  });
}

interface BarContext {
  spec: Spec;
  window: GraphicWindow;
  /** Seconds one bar takes to grow. */
  per: number;
  fps: number;
}

function barBoxes(bar: Bar, geo: Geometry, ctx: BarContext): Filter[] {
  const { spec, window } = ctx;
  const curve = parseEasing(spec.ease).fn;
  const peak = (geo.full * bar.value) / geo.max;
  const steps = sampleSteps(bar.start, ctx.per, ctx.fps).map((step) => ({
    ...step,
    value: Math.round(peak * curve(step.p)),
  }));
  const end = steps.at(-1)?.to ?? bar.start;
  const holds = window.until === undefined || window.until > end;
  const held = holds ? [{ from: end, to: window.until, value: Math.round(peak) }] : [];
  const runs = mergeRuns<{ from: number; to: number | undefined; value: number }>([...steps, ...held], (run) =>
    String(run.value)
  );

  return runs.flatMap((run) =>
    boxes(
      [{ x: bar.left, y: geo.baseline - run.value, w: geo.barWidth, h: run.value }],
      spec.color,
      windowExpr(run.from, run.to)
    )
  );
}

function valueLabel(g: Chart, bar: Bar, geo: Geometry, ctx: BarContext): Filter {
  const timing = { delay: bar.start, duration: ctx.per };
  const progress = easedProgressExpr(parseEasing(ctx.spec.ease), timing);
  const peak = (geo.full * bar.value) / geo.max;
  const counter = { from: 0, to: bar.value, decimals: g.decimals, prefix: g.prefix, suffix: g.suffix };

  return {
    type: 'drawtext',
    values: {
      textExpr: counterText(counter, timing, ctx.spec.ease),
      fontfile: kineticFontFile(g.font),
      fontsize: geo.size,
      fontcolor: g.textColor ?? INK,
      x: `'${fmt(bar.center)}-text_w/2'`,
      // Rides the bar top as it grows: same curve, same window.
      y: `'${fmt(geo.baseline - geo.size * 1.2)}-${fmt(peak)}*(${progress})'`,
      alpha: `'clip((t-${fmt(bar.start)})/0.15,0,1)'`,
      enable: windowExpr(bar.start, ctx.window.until),
    },
  } as unknown as Filter;
}

function categoryLabel(g: Chart, bar: Bar, geo: Geometry, until: number | undefined): Filter[] {
  const label = g.labels?.[bar.index];

  if (!label?.trim()) return [];

  return [
    {
      type: 'drawtext',
      values: {
        text: label,
        fontfile: kineticFontFile(g.font),
        fontsize: Math.round(geo.size * 0.8),
        fontcolor: withAlpha(g.textColor ?? INK, 0.8),
        x: `'${fmt(bar.center)}-text_w/2'`,
        y: fmt(geo.baseline + geo.size * 0.35),
        alpha: `'clip((t-${fmt(bar.start)})/0.2,0,1)'`,
        enable: windowExpr(bar.start, until),
      },
    } as unknown as Filter,
  ];
}

function chartSpec(g: Chart, frame: Frame, base: Base): Spec {
  const geo = geometry(g, frame);
  const per = g.duration ?? 0.7;
  const spread = (g.values.length - 1) * (g.stagger ?? 0.08);
  const spec: Spec = {
    ...base,
    duration: per + spread,
    color: g.color ?? BRAND,
    rects: () => [{ x: geo.x, y: geo.y, w: geo.width, h: geo.height + geo.size * 1.4 }],
  };

  return {
    ...spec,
    render: (window) => {
      const ctx: BarContext = { spec, window, per, fps: frame.fps };

      return bars(g, geo, window.at).flatMap((bar) => [
        ...barBoxes(bar, geo, ctx),
        ...(g.showValues === false ? [] : [valueLabel(g, bar, geo, ctx)]),
        ...categoryLabel(g, bar, geo, window.until),
      ]);
    },
  };
}

export const CHART_SPECS = { 'bars-chart': chartSpec };
