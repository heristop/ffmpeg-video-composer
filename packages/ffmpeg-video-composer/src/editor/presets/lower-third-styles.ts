// Lower-third styles: distinct broadcast layouts for the same `lowerThird` block. Without `style` the
// block lowers exactly as before (text-blocks.ts). Each style reuses the sugar reveal curves for its
// lines (drawtext alpha/x/y) and draws its moving shapes as one drawbox per frame behind an `enable`
// window, like the animated graphics; the pill's rounded ends come from the rounded-panel arc.

import type { Filter } from '@/core/types';
import { parseEasing } from '@/core/motion/easing';
import { measureBundled } from '@/core/kinetic/layout';
import { applyReveal, applyTextEffect, hasText, staggered, type RevealInput, type Translation } from './text';
import { lowerThirdToFilters, type LowerThird, type LowerThirdContext } from './text-blocks';
import { parseScale, round } from './text-blocks-helpers';
import { boxes, sampleSteps, windowExpr, type Rect } from './graphics-spec';
import { roundedBands } from './rounded-bands';
import { LOWER_THIRD_STYLE_REVEALS, type LowerThirdStyle } from '../../schemas/text.schemas';

const EXPO = 'cubic-bezier(0.16, 1, 0.3, 1)';
const BRAND = '#7C83FD';
const BAND = '#0a0f14';
const DRAW_SECONDS = 0.5;

interface Look {
  w: number;
  h: number;
  fps: number;
  margin: number;
  pad: number;
  top: number;
  title: number;
  sub: number;
  accent: string;
  band: string;
  reveal: RevealInput;
  block: LowerThird;
  measure: (text: Translation | undefined, font: string, size: number) => number;
}

interface Line {
  text: Translation | undefined;
  x: number;
  y: number;
  font: string;
  size: number;
  color: string;
  box?: { color: string; border: number };
}

function line(look: Look, spec: Line, index: number): Filter[] {
  if (!hasText(spec.text)) return [];

  const values: Record<string, unknown> = {
    text: { ...spec.text },
    x: spec.x,
    y: spec.y,
    fontfile: spec.font,
    fontsize: spec.size,
    fontcolor: spec.color,
    ...(spec.box && { box: 1, boxcolor: spec.box.color, boxborderw: spec.box.border }),
  };
  applyTextEffect(values, look.block.effect);
  applyReveal(values, staggered(look.reveal, index), { x: spec.x, y: spec.y });

  return [{ type: 'drawtext', values }];
}

/** A shape that draws itself on the expo curve when the first line starts, then holds. */
function drawn(look: Look, rects: (p: number) => Rect[], color: string): Filter[] {
  const start = staggered(look.reveal, 0).delay ?? 0;
  const curve = parseEasing(EXPO).fn;
  const steps = sampleSteps(start, DRAW_SECONDS, look.fps);
  const end = steps.at(-1)?.to ?? start;

  return [
    ...steps.flatMap((step) => boxes(rects(curve(step.p)), color, windowExpr(step.from, step.to))),
    ...boxes(rects(1), color, windowExpr(end)),
  ];
}

function bandColor(look: Look): string {
  return `${look.band}@${look.block.boxOpacity ?? 0.85}`;
}

function cleanBar(look: Look): Filter[] {
  const { margin, pad, top } = look;
  const rule = Math.max(4, round(look.h * 0.006));
  const subY = top + round(look.title * 1.25) + 2 * pad + round(pad * 0.6);

  return [
    ...drawn(look, (p) => [{ x: margin, y: top - pad - rule, w: round(look.w * 0.08 * p), h: rule }], look.accent),
    ...line(
      look,
      {
        text: look.block.title,
        x: margin + pad,
        y: top,
        font: 'Anton.ttf',
        size: look.title,
        color: '#ffffff',
        box: { color: bandColor(look), border: pad },
      },
      0
    ),
    ...line(
      look,
      {
        text: look.block.subtitle,
        x: margin + pad,
        y: subY,
        font: 'Oswald.ttf',
        size: look.sub,
        color: '#c9d0f5',
        box: { color: bandColor(look), border: round(pad * 0.7) },
      },
      1
    ),
  ];
}

function sideRule(look: Look): Filter[] {
  const { margin, pad, top } = look;
  const rule = Math.max(4, round(look.w * 0.004));
  const x = margin + rule + round(look.w * 0.015);
  const subY = top + round(look.title * 1.3);
  const bottom = hasText(look.block.subtitle) ? subY + round(look.sub * 1.3) : top + round(look.title * 1.2);
  const height = bottom - top + 2 * pad;

  return [
    ...drawn(look, (p) => [{ x: margin, y: top - pad, w: rule, h: round(height * p) }], look.accent),
    ...line(look, { text: look.block.title, x, y: top, font: 'Anton.ttf', size: look.title, color: '#ffffff' }, 0),
    ...line(look, { text: look.block.subtitle, x, y: subY, font: 'Oswald.ttf', size: look.sub, color: '#c9d0f5' }, 1),
  ];
}

function kicker(look: Look): Filter[] {
  const { margin, pad, top } = look;
  const border = round(pad * 0.6);
  const titleY = top + round(look.sub * 1.3) + 2 * border + pad;
  const ruleY = titleY + round(look.title * 1.2) + round(pad * 0.5);
  const rule = Math.max(4, round(look.h * 0.006));
  const width = Math.max(look.measure(look.block.title, 'Anton.ttf', look.title), round(look.w * 0.1));

  return [
    ...line(
      look,
      {
        text: look.block.subtitle,
        x: margin + border,
        y: top,
        font: 'Oswald.ttf',
        size: look.sub,
        color: look.band,
        box: { color: `${look.accent}@1`, border },
      },
      0
    ),
    ...line(
      look,
      { text: look.block.title, x: margin, y: titleY, font: 'Anton.ttf', size: look.title, color: '#ffffff' },
      1
    ),
    ...drawn(look, (p) => [{ x: margin, y: ruleY, w: round(width * p), h: rule }], look.accent),
  ];
}

function stackBars(look: Look): Filter[] {
  const { margin, pad, top } = look;
  const subY = top + round(look.title * 1.25) + 2 * pad;
  const indent = margin + pad + round(pad * 2.5);

  return [
    ...line(
      look,
      {
        text: look.block.title,
        x: margin + pad,
        y: top,
        font: 'Anton.ttf',
        size: look.title,
        color: look.band,
        box: { color: `${look.accent}@1`, border: pad },
      },
      0
    ),
    ...line(
      look,
      {
        text: look.block.subtitle,
        x: indent,
        y: subY,
        font: 'Oswald.ttf',
        size: look.sub,
        color: '#ffffff',
        box: { color: bandColor(look), border: round(pad * 0.8) },
      },
      1
    ),
  ];
}

// The pill grows from a circle to its full width; its left end stays put, its right end travels.
function pillRects(x: number, y: number, size: { width: number; height: number }, p: number): Rect[] {
  const r = size.height / 2;
  const width = size.height + (size.width - size.height) * p;
  const bands = roundedBands(size.height, r, 6);

  return [
    { x: x + r, y, w: width - 2 * r, h: size.height },
    ...bands.flatMap((band) => [
      { x: x + band.inset, y: y + band.y, w: r - band.inset, h: band.h },
      { x: x + width - r, y: y + band.y, w: r - band.inset, h: band.h },
    ]),
  ];
}

function pill(look: Look): Filter[] {
  const { margin, pad, top } = look;
  const height = round(look.title * 1.25 + pad);
  const dot = round(height * 0.3);
  const textX = margin + round(height * 0.45) + dot + pad;
  const titleW = look.measure(look.block.title, 'Anton.ttf', look.title);
  const subX = textX + titleW + pad * 2;
  const subW = hasText(look.block.subtitle) ? look.measure(look.block.subtitle, 'Oswald.ttf', look.sub) + pad * 2 : 0;
  const size = { width: subX - margin + subW + round(height * 0.3), height };
  const dotRect = { x: margin + round(height * 0.45), y: top + round((height - dot) / 2), w: dot, h: dot };
  const textY = top + round((height - look.title * 1.05) / 2);

  return [
    ...drawn(look, (p) => pillRects(margin, top, size, p), bandColor(look)),
    ...drawn(look, (p) => (p >= 1 ? roundedDot(dotRect) : []), look.accent),
    ...line(
      look,
      { text: look.block.title, x: textX, y: textY, font: 'Anton.ttf', size: look.title, color: '#ffffff' },
      1
    ),
    ...line(
      look,
      {
        text: look.block.subtitle,
        x: subX,
        y: top + round((height - look.sub * 1.1) / 2),
        font: 'Oswald.ttf',
        size: look.sub,
        color: '#c9d0f5',
      },
      2
    ),
  ];
}

function roundedDot(rect: Rect): Rect[] {
  return roundedBands(rect.h, rect.h / 2, 3).map((band) => ({
    x: rect.x + band.inset,
    y: rect.y + band.y,
    w: rect.w - 2 * band.inset,
    h: band.h,
  }));
}

// The optional badge: a right-aligned accent pill that fades in after the lines.
function badge(look: Look): Filter[] {
  const border = Math.max(8, round(look.h * 0.014));
  const x = `w-text_w-${look.margin + border}`;
  const values: Record<string, unknown> = {
    text: { ...look.block.badge },
    x,
    y: look.top,
    fontfile: 'Anton.ttf',
    fontsize: round(look.h * 0.04),
    fontcolor: look.band,
    box: 1,
    boxcolor: `${look.accent}@1`,
    boxborderw: border,
  };
  applyReveal(values, staggered('fade', 2), { x, y: look.top });

  return hasText(look.block.badge) ? [{ type: 'drawtext', values }] : [];
}

const STYLES: Record<LowerThirdStyle, (look: Look) => Filter[]> = {
  'clean-bar': cleanBar,
  'side-rule': sideRule,
  kicker,
  'stack-bars': stackBars,
  pill,
};

/** Context for styled lower thirds: the frame rate for drawn shapes and the copy resolver to measure. */
export interface StyledLowerThirdContext extends LowerThirdContext {
  fps?: number;
  resolveText?: (text: Translation) => string;
}

function measurer(ctx: StyledLowerThirdContext): Look['measure'] {
  return (text, font, size) => {
    const copy = text && ctx.resolveText ? ctx.resolveText(text) : (text?.en ?? Object.values(text ?? {})[0] ?? '');

    return round(measureBundled(font, copy, size) ?? copy.length * size * 0.5);
  };
}

/** A lower third in its authored style; the original band when `style` is unset (byte-identical). */
export function lowerThirdFilters(block: LowerThird | undefined, ctx: StyledLowerThirdContext): Filter[] {
  if (!block?.style) return lowerThirdToFilters(block, ctx);

  if (!hasText(block.title) && !hasText(block.subtitle) && !hasText(block.badge)) return [];

  const { w, h } = parseScale(ctx.scale);
  const title = round(h * 0.05);
  const look: Look = {
    w,
    h,
    fps: ctx.fps ?? 30,
    margin: round(w * 0.06),
    pad: Math.max(6, round(h * 0.014)),
    top: block.position === 'top' ? round(h * 0.08) : h - round(h * 0.24),
    title,
    sub: round(h * 0.028),
    accent: block.accent ?? BRAND,
    band: block.bandColor ?? BAND,
    reveal: block.reveal ?? LOWER_THIRD_STYLE_REVEALS[block.style],
    block,
    measure: measurer(ctx),
  };

  return [...STYLES[block.style](look), ...badge(look)];
}
