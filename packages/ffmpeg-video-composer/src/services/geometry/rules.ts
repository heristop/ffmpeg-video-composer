import { compositeOver, contrastRatio, parseColor } from '@/core/color-contrast';
import type { ResolvedPlatform, SafeEdge } from '@/core/platforms';
import type { Box, Canvas, Panel } from './geometry-types';

// Why a finding is an estimate. `font`: no metrics for the typeface, so widths are guessed;
// `variable`: the text holds a `{{ var }}` only filled at render time; `duration`: a section
// declares no duration, so when things are on screen is assumed.
export type GeometryApproxReason = 'font' | 'variable' | 'duration';

// Advisory only. Nothing here is ever an `error`: a template that renders badly still renders, and
// failing a build over a legibility hint would make `leclap validate` unusable in CI.
export interface GeometryWarning {
  path: string;
  message: string;
  code: string;
  severity: 'warn';
  approx: boolean;
  approxReason?: GeometryApproxReason;
}

// Broadcast title-safe: keep text inside the middle 90%.
const SAFE_MARGIN_RATIO = 0.05;

// Below this fraction of the output height, type is unreadable on a phone.
const MIN_LEGIBLE_RATIO = 0.025;

// Below this, an "overflow" is inside the noise of the measurement itself.
const OVERFLOW_TOLERANCE_PX = 2;

// Pixel counts are reported to the nearest 5px. The model reads real font metrics and the renderer's
// own positions, but not drawtext's exact glyph bounds, so a figure claiming single-pixel precision
// promises more than it knows.
const REPORT_STEP_PX = 5;

function about(px: number): string {
  return `~${Math.max(REPORT_STEP_PX, Math.round(px / REPORT_STEP_PX) * REPORT_STEP_PX)}px`;
}

function warn(
  box: Box,
  code: string,
  message: string,
  // `null` is "exact": an explicit `undefined` would fall through to this default.
  approxReason: GeometryApproxReason | null = box.approxReason ?? (box.approx ? 'font' : null)
): GeometryWarning {
  const finding: GeometryWarning = { path: box.path, message, code, severity: 'warn', approx: approxReason !== null };

  return approxReason === null ? finding : { ...finding, approxReason };
}

interface Excess {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

// How far the box pokes out of an inset rectangle on each side. A side the preset pins
// (Box.anchoredSide) is skipped: it sits a fixed distance from that edge whatever the text says, so
// "shorten it" cannot move it. The vertical sides are skipped when `y` is not the author's.
function excess(box: Box, canvas: Canvas, insetX: number, insetY: number, checkVertical: boolean): Excess {
  const none = Number.NEGATIVE_INFINITY;

  return {
    left: box.anchoredSide === 'left' ? none : insetX - box.x,
    right: box.anchoredSide === 'right' ? none : box.x + box.width - (canvas.width - insetX),
    top: checkVertical ? insetY - box.y : none,
    bottom: checkVertical ? box.y + box.height - (canvas.height - insetY) : none,
  };
}

// The edit that fixes it. Centred text crossing BOTH sides has to lose the sum, not the worst side —
// quoting one side understated the edit by half.
function over(value: number): boolean {
  return value >= OVERFLOW_TOLERANCE_PX;
}

function describeExcess(sides: Excess, edge: string): string | null {
  if (over(sides.left) && over(sides.right)) {
    return `is ${about(sides.left + sides.right)} too wide for the ${edge}`;
  }

  const worst = Math.max(sides.left, sides.right, sides.top, sides.bottom);

  return over(worst) ? `extends ${about(worst)} past the ${edge}` : null;
}

// With a delivery platform the inset is the app's own UI, one fraction per edge, and every side is
// judged: the caption block covers a preset-pinned lower third exactly as it covers an authored one.
// The worst edge is named with what covers it, so the fix (move it up, pull it in) is obvious.
function platformOverlap(box: Box, canvas: Canvas, platform: ResolvedPlatform): GeometryWarning | null {
  const { safe } = platform;
  const sides: Record<SafeEdge, number> = {
    top: canvas.height * safe.top - box.y,
    bottom: box.y + box.height - canvas.height * (1 - safe.bottom),
    left: canvas.width * safe.left - box.x,
    right: box.x + box.width - canvas.width * (1 - safe.right),
  };
  const [edge, depth] = Object.entries(sides).reduce((worst, side) => (side[1] > worst[1] ? side : worst));

  if (!over(depth)) {
    return null;
  }

  const name = edge as SafeEdge;
  const share = `${name} ${Math.round(safe[name] * 100)}%`;

  return warn(
    box,
    'platform_ui_overlap',
    `${box.label} reaches ${about(depth)} into the ${share} of the frame — the ${share} is covered by ` +
      `${platform.title}'s ${platform.ui[name]}; move it away from that edge or shorten it`
  );
}

function titleSafeOverflow(box: Box, canvas: Canvas): GeometryWarning | null {
  const insetX = canvas.width * SAFE_MARGIN_RATIO;
  const insetY = canvas.height * SAFE_MARGIN_RATIO;
  const unsafe = describeExcess(excess(box, canvas, insetX, insetY, box.verticalPositionAuthored), 'title-safe area');

  return unsafe ? warn(box, 'text_overflow', `${box.label} ${unsafe} — shorten it or reduce the size`) : null;
}

export function overflowWarnings(boxes: Box[], canvas: Canvas, platform?: ResolvedPlatform): GeometryWarning[] {
  const warnings: GeometryWarning[] = [];

  for (const box of boxes) {
    // Worst first: text past the frame edge is not on screen; past title-safe it merely risks a crop.
    // The frame check keeps both axes even for a preset-pinned `y` — off-screen is off-screen.
    const offFrame = describeExcess(excess(box, canvas, 0, 0, true), 'frame');

    if (offFrame) {
      warnings.push(warn(box, 'text_out_of_frame', `${box.label} ${offFrame} — shorten it or reduce the size`));
      continue;
    }

    const unsafe = platform ? platformOverlap(box, canvas, platform) : titleSafeOverflow(box, canvas);

    if (unsafe) {
      warnings.push(unsafe);
    }
  }

  return warnings;
}

// A global overlay is a watermark or a brand mark — discreet on purpose, so "too small" is noise there.
function isWatermark(box: Box): boolean {
  return box.path.startsWith('global.overlays[');
}

export function legibilityWarnings(boxes: Box[], canvas: Canvas): GeometryWarning[] {
  const floor = canvas.height * MIN_LEGIBLE_RATIO;

  return boxes
    .filter((box) => box.fontSize < floor && !isWatermark(box))
    .map((box) =>
      warn(
        box,
        'text_too_small',
        `${box.label} is ${Math.round(box.fontSize)}px, too small to read on a phone — use at least ${Math.ceil(floor)}px`,
        // Size is read straight off the filter, never estimated.
        null
      )
    );
}

// WCAG AA for large text (captions, lower thirds and title cards all render above that threshold).
export const MIN_TEXT_CONTRAST = 3.0;

export function contrastWarnings(boxes: Box[]): GeometryWarning[] {
  const warnings: GeometryWarning[] = [];

  for (const box of boxes) {
    const text = box.color ? parseColor(box.color) : null;
    const backdrop = box.backdrop ? parseColor(box.backdrop) : null;

    if (!text || !backdrop) {
      continue;
    }

    // Composited: drawtext's `fontcolor` takes an `@alpha` suffix, and `#ffffff@0.1` paints ~#1a1a1a.
    const ratio = contrastRatio(compositeOver(text, backdrop.rgb), backdrop.rgb);

    if (ratio >= MIN_TEXT_CONTRAST) {
      continue;
    }

    warnings.push(
      warn(
        box,
        'text_low_contrast',
        `${box.label}: ${box.color} on ${box.backdrop} is ${ratio.toFixed(1)}:1, below ${MIN_TEXT_CONTRAST}:1 — change the text colour or the background`,
        // Exact colour tokens, not font metrics: never an estimate.
        null
      )
    );
  }

  return warnings;
}

// Fires only on the conjunction: unknown backdrop (footage, an image, an unparseable colour) AND no
// box, outline or shadow. Any one of those is the author having already handled legibility.
export function footageLegibilityWarnings(boxes: Box[]): GeometryWarning[] {
  return boxes
    .filter((box) => box.backdrop === null && !box.legibilityAid)
    .map((box) =>
      warn(
        box,
        'text_unreadable_over_footage',
        `${box.label} has no box, outline or shadow over footage or an image — add \`effect: { "shadow": true }\` or a background box`,
        null
      )
    );
}

interface Timed {
  startSec: number;
  endSec: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

// Windows that merely touch (one ends as the next starts) can disagree by a float rounding error when
// section start times are accumulated, e.g. a global overlay repeated on back-to-back sections.
const TOUCH_EPSILON_SEC = 1e-3;

function overlapsInTime(a: Timed, b: Timed): number {
  return Math.min(a.endSec, b.endSec) - Math.max(a.startSec, b.startSec);
}

function overlapsInSpace(a: Timed, b: Timed): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function timingReason(a: Box, b: Box): GeometryApproxReason | null {
  const width = a.approxReason ?? b.approxReason ?? (a.approx || b.approx ? 'font' : null);

  return width ?? (a.timingAssumed || b.timingAssumed ? 'duration' : null);
}

// A collision needs both dimensions. Boxes arrive in non-decreasing `startSec`, so once `b` starts at
// or after `a` ends no later box can overlap `a` either: the sweep is roughly linear, not quadratic.
export function collisionWarnings(boxes: Box[], limit = Number.POSITIVE_INFINITY): GeometryWarning[] {
  const warnings: GeometryWarning[] = [];

  for (let i = 0; i < boxes.length && warnings.length < limit; i++) {
    const a = boxes[i];

    for (let j = i + 1; j < boxes.length && warnings.length < limit; j++) {
      const b = boxes[j];

      if (b.startSec >= a.endSec) {
        break;
      }

      const shared = overlapsInTime(a, b);

      if (shared <= TOUCH_EPSILON_SEC || !overlapsInSpace(a, b)) {
        continue;
      }

      warnings.push(
        warn(
          a,
          'text_collision',
          `${a.label} overlaps ${b.label} for ${shared.toFixed(1)}s — move one of them or shorten it`,
          timingReason(a, b)
        )
      );
    }
  }

  return warnings;
}

// Below this opacity a panel drawn over text tints it rather than hides it.
const COVERING_OPACITY = 0.3;

// A filled panel drawn AFTER a piece of text in the same section paints over it: a caption sitting
// where a lowerThird's band lands is dimmed under the band, and nothing else would say so.
export function coveredTextWarnings(boxes: Box[], panels: Panel[]): GeometryWarning[] {
  const warnings: GeometryWarning[] = [];

  for (const box of boxes) {
    const cover = panels.find(
      (panel) =>
        panel.sectionIndex === box.sectionIndex &&
        panel.drawIndex > box.drawIndex &&
        (parseColor(panel.color)?.alpha ?? 1) >= COVERING_OPACITY &&
        overlapsInTime(panel, box) > 0 &&
        overlapsInSpace(panel, box)
    );

    if (cover) {
      warnings.push(
        warn(
          box,
          'text_covered',
          `${box.label} is drawn under ${cover.label} — move it (\`position\`) or remove the overlap`,
          box.approxReason ?? (box.timingAssumed ? 'duration' : null)
        )
      );
    }
  }

  return warnings;
}
