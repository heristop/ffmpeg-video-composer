// counter: the kinetic preset that rolls a number (editor/presets/kinetic.ts hands the block over).
//
// The value is an eased drawtext `%{eif}` expansion counted in whole display units (value × 10^decimals,
// rounded half up), so from the end of the roll on it is exactly `to`, and it holds. The layout is fixed at
// compile time: with tabular digits (the default) every digit is its own drawtext centred in a slot as wide
// as the font's widest figure, so the number never jitters sideways while it rolls. It only widens when it
// gains a digit, at the frames where the emitted expression (evaluated with the engine's own evaluator)
// crosses a power of ten; positions and visibility step there, mid-frame. Every drawtext has a constant
// fontsize (FFmpeg 8, see utils/stepped-fontsize.ts) and nothing but drawtext is used (LGPL allowlist).

import type { Filter } from '@/core/types';
import type { KineticBlock } from '../../schemas/kinetic.schemas';
import type { CounterSpec } from '../../schemas/text.schemas';
import type { Curve } from '@/core/motion/curves';
import { parseEasing, type EasingSpec } from '@/core/motion/easing';
import { easedProgressExpr, fmt } from '@/core/motion/hermite';
import { escapeDrawtextText } from '@/core/drawtext-text';
import { codePoints, measureBundled } from '@/core/kinetic/layout';
import { blockTop, type KineticFrame, type ResolvedKinetic } from '@/core/kinetic/resolve';
import { evaluateExpr } from '../../services/geometry/drawtext-expr';
import { applyTextEffect } from './text';
import { BASELINE, quoted } from './kinetic-piece';

/** Translation map the kinetic lowering resolves for a counter: it yields the template's active locale. */
export const COUNTER_LOCALE_PROBE: Record<string, string> = Object.fromEntries(
  ['en', 'fr', 'de', 'es', 'it', 'pt', 'nl', 'ja', 'zh', 'ko'].map((code) => [code, code])
);

const SEPARATORS: Record<string, { group: string; mark: string }> = {
  en: { group: ',', mark: '.' },
  fr: { group: ' ', mark: ',' },
  de: { group: '.', mark: ',' },
  'de-CH': { group: '’', mark: '.' },
};
const COMMA_DECIMAL = new Set(['de', 'es', 'it', 'pt', 'nl']);
// The roll reaches its overshoot peak at this share of the duration, then settles on an in-out curve.
const PEAK_AT = 0.7;
const SETTLE = parseEasing('cubic-bezier(0.45, 0, 0.55, 1)').fn;
const FADE_IN = 0.18;
const ALIGN = { left: 0, center: 0.5, right: 1 } as const;

interface NumberFormat {
  from: number;
  to: number;
  decimals: number;
  /** Separator between thousands, '' for none, ' ' for a gap. */
  group: string;
  mark: string;
  prefix: string;
  suffix: string;
}

interface Metrics {
  slot: number;
  sep: number;
  mark: number;
  /** Full prefix width (trailing spaces included) and the gap those spaces leave. */
  prefix: number;
  prefixGap: number;
  suffix: number;
  suffixGap: number;
}

interface Run {
  /** Boundary time (mid-frame) the run starts at; the first run starts at 0. */
  at: number;
  digits: number;
}

interface Plan {
  units: string;
  format: NumberFormat;
  runs: Run[];
  settings: ResolvedKinetic;
  top: number;
  effect: KineticBlock['effect'];
}

function separators(locale: string): { group: string; mark: string } {
  if (Object.hasOwn(SEPARATORS, locale)) return SEPARATORS[locale];

  const base = locale.split('-')[0];

  if (Object.hasOwn(SEPARATORS, base)) return SEPARATORS[base];

  return COMMA_DECIMAL.has(base) ? SEPARATORS.de : SEPARATORS.en;
}

function numberFormat(counter: CounterSpec, activeLocale: string): NumberFormat {
  const scale = 10 ** (counter.decimals ?? 0);
  const to = counter.to ?? counter.from;
  const peak = Math.max(counter.from, to) * (1 + (counter.overshoot ?? 0));
  const grouping = counter.grouping ?? String(Math.floor(peak)).length >= 5;
  const { group, mark } = separators(counter.locale ?? (activeLocale.trim().toLowerCase() || 'en'));

  return {
    from: Math.round(counter.from * scale),
    to: Math.round(to * scale),
    decimals: counter.decimals ?? 0,
    group: grouping ? group : '',
    mark,
    prefix: counter.prefix ?? '',
    suffix: counter.suffix ?? '',
  };
}

/** The roll's curve: the block ease, or that ease into an overshoot peak and an in-out settle back to 1. */
export function counterCurve(ease: EasingSpec, overshoot: number): Curve {
  const curve = parseEasing(ease);

  if (overshoot <= 0 || curve.steps) return curve;

  return {
    fn: (p) =>
      p < PEAK_AT
        ? (1 + overshoot) * curve.fn(p / PEAK_AT)
        : 1 + overshoot * (1 - SETTLE((p - PEAK_AT) / (1 - PEAK_AT))),
  };
}

/** The shown value in display units at time t: exactly `to` once the window has ended. */
function unitsExpr(format: NumberFormat, curve: Curve, settings: ResolvedKinetic): string {
  const span = format.to - format.from;

  if (span === 0) return fmt(format.to);

  const progress = easedProgressExpr(curve, { delay: settings.delay, duration: settings.duration });

  return `max(0,floor(${fmt(format.from)}+${fmt(span)}*(${progress})+0.5))`;
}

function integerDigits(units: number, decimals: number): number {
  return Math.max(1, String(Math.floor(Math.round(units) / 10 ** decimals)).length);
}

// Runs of frames sharing an integer digit count, from the emitted expression itself.
function digitRuns(units: string, format: NumberFormat, settings: ResolvedKinetic, fps: number): Run[] {
  const last = Math.ceil((settings.delay + settings.duration) * fps) + 1;
  const runs: Run[] = [];

  for (let frame = 0; frame <= last; frame++) {
    const value = evaluateExpr(units, { t: frame / fps, n: frame }) ?? format.to;
    const digits = integerDigits(value, format.decimals);

    if (runs.at(-1)?.digits !== digits) runs.push({ at: frame === 0 ? 0 : (frame - 0.5) / fps, digits });
  }

  return runs;
}

/** A value that depends on the digit count, as a time-stepped expression (a constant when it never moves). */
function stepped(runs: Run[], value: (digits: number) => number): string {
  const points = runs.map((run) => ({ at: run.at, value: fmt(value(run.digits)) }));
  const merged = points.filter((point, i) => i === 0 || point.value !== points[i - 1].value);
  let expr = merged.at(-1)?.value ?? '0';

  for (let i = merged.length - 2; i >= 0; i--) expr = `if(lt(t,${fmt(merged[i + 1].at)}),${merged[i].value},${expr})`;

  return expr;
}

/** An `enable` for the runs passing `test`: undefined when always on, null when never. */
function gate(runs: Run[], test: (digits: number) => boolean): string | null | undefined {
  const windows: string[] = [];

  for (const [i, run] of runs.entries()) {
    if (!test(run.digits) || (i > 0 && test(runs[i - 1].digits))) continue;

    const end = runs.slice(i + 1).find((next) => !test(next.digits));
    const from = `gte(t,${fmt(run.at)})`;
    windows.push(end ? `${from}*lt(t,${fmt(end.at)})` : from);
  }

  if (windows.length === 0) return null;

  return windows.length === 1 && runs.every((run) => test(run.digits)) ? undefined : quoted(windows.join('+'));
}

function measure(settings: ResolvedKinetic, text: string): number {
  return measureBundled(settings.font, text, settings.size) ?? codePoints(text).length * 0.55 * settings.size;
}

function metrics(format: NumberFormat, settings: ResolvedKinetic): Metrics {
  const space = measureBundled(settings.font, ' ', settings.size) ?? 0.25 * settings.size;
  const figures = codePoints('0123456789').map((digit) => measure(settings, digit));
  const prefixGap = (format.prefix.length - format.prefix.trimEnd().length) * space;
  const suffixGap = (format.suffix.length - format.suffix.trimStart().length) * space;
  const sep = format.group.trim() ? measure(settings, format.group) : space * 0.6;

  return {
    slot: Math.max(...figures),
    sep: format.group ? sep : 0,
    mark: format.decimals > 0 ? measure(settings, format.mark) : 0,
    prefix: format.prefix.trim() ? measure(settings, format.prefix.trimEnd()) + prefixGap : prefixGap,
    prefixGap,
    suffix: format.suffix.trim() ? measure(settings, format.suffix.trimStart()) + suffixGap : suffixGap,
    suffixGap,
  };
}

// Horizontal model of the number: metrics plus the decimal part's width (it never changes).
interface Geometry {
  plan: Plan;
  m: Metrics;
  decWidth: number;
}

function groupCount(format: NumberFormat, digits: number): number {
  return format.group ? Math.floor((digits - 1) / 3) : 0;
}

/** Left edge of the whole number (prefix included) when it shows `digits` integer digits. */
function leftEdge(g: Geometry, digits: number): number {
  const { plan, m } = g;
  const intWidth = digits * m.slot + groupCount(plan.format, digits) * m.sep;

  return plan.settings.x - ALIGN[plan.settings.align] * (m.prefix + intWidth + g.decWidth + m.suffix);
}

/** Right edge of the integer part. */
function rightEdge(g: Geometry, digits: number): number {
  return leftEdge(g, digits) + g.m.prefix + digits * g.m.slot + groupCount(g.plan.format, digits) * g.m.sep;
}

/** Left edge of integer digit k (0 = units). */
function digitEdge(g: Geometry, digits: number, k: number): number {
  const groupsRight = g.plan.format.group ? Math.floor(k / 3) : 0;

  return rightEdge(g, digits) - (k + 1) * g.m.slot - groupsRight * g.m.sep;
}

// x of a glyph centred in a slot whose left edge depends on the digit count.
function centred(runs: Run[], edge: (digits: number) => number, width: number): string {
  return `${stepped(runs, edge)}+${fmt(width / 2)}-tw/2`;
}

function draw(plan: Plan, text: string, x: string, enable?: string): Filter {
  const { settings } = plan;
  const values: Record<string, unknown> = {
    textExpr: text,
    fontfile: settings.font,
    fontsize: settings.size,
    fontcolor: settings.color,
    x: quoted(x),
    // Every piece on the font's baseline: drawtext otherwise aligns each string by its own glyphs' box.
    y: quoted(`${fmt(plan.top + settings.size * BASELINE)}-max_glyph_a`),
    alpha: quoted(`clip((t-${fmt(settings.delay)})/${FADE_IN},0,1)`),
  };

  if (enable) values.enable = enable;

  applyTextEffect(values, plan.effect);

  return { type: 'drawtext', values };
}

function digitText(units: string, power: number, modulo = 10, width = 0): string {
  const value = power === 0 ? units : `floor(${units}/${fmt(10 ** power)})`;
  const pad = width > 0 ? String.raw`\:${width}` : '';

  return String.raw`%{eif\:mod(${value},${modulo})\:d${pad}}`;
}

// Each figure in its own fixed slot, centred: the tabular layout.
function tabularFilters(plan: Plan, m: Metrics): Filter[] {
  const { runs, format, units } = plan;
  const g: Geometry = { plan, m, decWidth: format.decimals > 0 ? m.mark + format.decimals * m.slot : 0 };
  const most = Math.max(...runs.map((run) => run.digits));
  const filters: Filter[] = [];

  for (let k = 0; k < most; k++) {
    const enable = gate(runs, (digits) => digits > k);
    const x = centred(runs, (digits) => digitEdge(g, digits, k), m.slot);

    if (enable !== null) filters.push(draw(plan, digitText(units, k + format.decimals), x, enable));

    filters.push(...separatorFilter(g, k, most));
  }

  return [...filters, ...decimalFilters(g), ...affixFilters(g)];
}

// The group separator left of digit k, when k closes a group and the separator is a glyph (not a gap).
function separatorFilter(g: Geometry, k: number, most: number): Filter[] {
  const { plan, m } = g;

  if (k % 3 !== 2 || k + 1 >= most || !plan.format.group.trim()) return [];

  const enable = gate(plan.runs, (digits) => digits > k + 1);
  const x = centred(plan.runs, (digits) => digitEdge(g, digits, k) - m.sep, m.sep);

  return enable === null ? [] : [draw(plan, escapeDrawtextText(plan.format.group), x, enable)];
}

function decimalFilters(g: Geometry): Filter[] {
  const { plan, m } = g;
  const { format, runs, units } = plan;

  if (format.decimals === 0) return [];

  const figures = Array.from({ length: format.decimals }, (_, i) => {
    const x = centred(runs, (digits) => rightEdge(g, digits) + m.mark + i * m.slot, m.slot);

    return draw(plan, digitText(units, format.decimals - 1 - i), x);
  });
  const mark = centred(runs, (digits) => rightEdge(g, digits), m.mark);

  return [draw(plan, escapeDrawtextText(format.mark), mark), ...figures];
}

function affixFilters(g: Geometry): Filter[] {
  const { plan, m } = g;
  const { format, runs } = plan;
  const filters: Filter[] = [];

  if (format.prefix.trim()) {
    const x = `${stepped(runs, (digits) => leftEdge(g, digits) + m.prefix - m.prefixGap)}-tw`;
    filters.push(draw(plan, escapeDrawtextText(format.prefix.trim()), x));
  }

  if (format.suffix.trim()) {
    const x = stepped(runs, (digits) => rightEdge(g, digits) + g.decWidth + m.suffixGap);
    filters.push(draw(plan, escapeDrawtextText(format.suffix.trim()), x));
  }

  return filters;
}

// Proportional figures: one drawtext per digit count, the whole string anchored like any kinetic line.
function proportionalFilters(plan: Plan): Filter[] {
  const { format, runs, units, settings } = plan;
  const counts = [...new Set(runs.map((run) => run.digits))];
  const anchor = `${fmt(settings.x)}-tw*${fmt(ALIGN[settings.align])}`;

  return counts.flatMap((count) => {
    const enable = gate(runs, (digits) => digits === count);
    const groups = format.group ? Math.floor((count - 1) / 3) : 0;
    const head = String.raw`%{eif\:floor(${units}/${fmt(10 ** (format.decimals + 3 * groups))})\:d}`;
    const tail = Array.from({ length: groups }, (_, i) => {
      const power = format.decimals + 3 * (groups - 1 - i);

      return `${escapeDrawtextText(format.group)}${digitText(units, power, 1000, 3)}`;
    });
    const fraction =
      format.decimals > 0
        ? `${escapeDrawtextText(format.mark)}${digitText(units, 0, 10 ** format.decimals, format.decimals)}`
        : '';
    const text = `${escapeDrawtextText(format.prefix)}${head}${tail.join('')}${fraction}${escapeDrawtextText(format.suffix)}`;

    return enable === null ? [] : [draw(plan, text, anchor, enable)];
  });
}

/**
 * The filters of a kinetic `counter` block. `frame.text` carries the active locale (the kinetic lowering
 * resolves COUNTER_LOCALE_PROBE for counters, whose copy is ignored).
 */
export function counterBlockFilters(
  block: KineticBlock,
  settings: ResolvedKinetic,
  frame: KineticFrame & { text: string }
): Filter[] {
  const counter = block.counter ?? { from: 0, to: 100 };
  const format = numberFormat(counter, frame.text);
  const units = unitsExpr(format, counterCurve(settings.ease, counter.overshoot ?? 0), settings);
  const runs = digitRuns(units, format, settings, frame.fps);
  const top = blockTop(block.y, settings.lineHeight, frame);
  const plan: Plan = { units, format, runs, settings, top, effect: block.effect };

  if (counter.tabular === false) return proportionalFilters(plan);

  return tabularFilters(plan, metrics(format, settings));
}
