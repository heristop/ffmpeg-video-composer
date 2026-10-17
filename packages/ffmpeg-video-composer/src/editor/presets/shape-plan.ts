// What the shape graphic's lowering (shape-draw.ts) resolves before it builds filters: the outline in frame
// px, the even-pixel box it is drawn in (it may extend past the frame, to slide in), the raster density
// (up to 2× for scale tracks, lowered to stay within MAX_SHAPE_PIXELS), the image spec, the layer tracks
// that move it (a fade-in over `duration` when none are authored) and, for stroke.draw, the outline as a
// path graphic for the trim-path reveal. A shape wider or taller than twice the frame is skipped: an agent's
// `d` in the wrong units must not become a giant raster or a giant scaled leg.

import { parseColor, rgbToHex, type Paint } from '@/core/color-contrast';
import type { LayerAnimate } from '../../schemas/layer-animate.schemas';
import { resolveFxTarget } from './fx-target';
import { mapCommands, PATH_DEFAULTS, type PathGraphic } from './graphics-path';
import { BRAND, INK, type Frame, type Rect } from './graphics-spec';
import type { PathCommand } from './path-geometry';
import { encodeCommands } from './path-svg';
import { SHAPE_DEFAULTS, shapeBounds, shapeOutline, svgPathText, type ShapeGraphic } from './shape-geometry';
import { MAX_SHAPE_PIXELS, MAX_SHAPE_SIDE, shapeSpecProblem, type ShapeSpec } from './shape-raster';
import type { ShapeRequest } from './sugar-context';

/** A shape spans at most this many frames per side. */
const MAX_SPAN = 2;
/** Scale tracks past this are drawn from a 2× raster, upscaled. */
const MAX_SUPERSAMPLE = 2;
const MARGIN = 2;

export interface ShapePlan {
  /** Where the image sits at rest, frame px on even pixels. */
  box: Rect;
  /** Raster px per frame px. */
  density: number;
  /** The image; null when nothing is left to rasterise (outline only, drawn on). */
  spec: ShapeSpec | null;
  /** The layer tracks that place it: authored, or a fade-in. */
  animate: LayerAnimate;
  /** The outline as a path graphic when it draws on; null when it is baked or absent. */
  outline: PathGraphic | null;
}

interface Outline {
  commands: PathCommand[];
  bounds: Rect;
}

export function warn(request: ShapeRequest, code: string, message: string): void {
  request.ctx.masks?.warn(`[${code}] graphics[${request.index}] shape: ${message}`);
}

function frameOf(request: ShapeRequest): Frame {
  const [width, height] = request.ctx.scale.split(':').map(Number);

  return { width, height, fps: request.ctx.fps };
}

function evenDown(value: number): number {
  return 2 * Math.floor(value / 2);
}

function evenUp(value: number): number {
  return 2 * Math.ceil(value / 2);
}

function boxOf(bounds: Rect): Rect {
  const x = evenDown(bounds.x - MARGIN);
  const y = evenDown(bounds.y - MARGIN);

  return { x, y, w: evenUp(bounds.x + bounds.w + MARGIN) - x, h: evenUp(bounds.y + bounds.h + MARGIN) - y };
}

function strokeWidth(g: ShapeGraphic): number {
  return g.stroke ? (g.stroke.width ?? SHAPE_DEFAULTS.strokeWidth) : 0;
}

function numbers(keys: ReadonlyArray<{ v: number | string }> | undefined): number[] {
  return (keys ?? []).map((key) => key.v).filter((v): v is number => typeof v === 'number');
}

/** The largest on-screen scale the tracks reach (uniform × axis), at least 1. */
export function peakScale(animate: LayerAnimate | undefined): number {
  const uniform = Math.max(1, ...numbers(animate?.scale));
  const axis = Math.max(1, ...numbers(animate?.scaleX), ...numbers(animate?.scaleY));

  return uniform * axis;
}

function densityOf(box: Rect, animate: LayerAnimate | undefined): number {
  const want = Math.min(MAX_SUPERSAMPLE, peakScale(animate));

  return Math.min(want, Math.sqrt(MAX_SHAPE_PIXELS / (box.w * box.h)), MAX_SHAPE_SIDE / Math.max(box.w, box.h));
}

function hex8(paint: Paint): string {
  const alpha = Math.round(paint.alpha * 255)
    .toString(16)
    .padStart(2, '0');

  return `${rgbToHex(paint.rgb).slice(1).toLowerCase()}${alpha}`;
}

function rgba(request: ShapeRequest, token: string | undefined, fallback: string): string {
  const resolved = token === undefined ? fallback : (request.ctx.masks?.color(token) ?? token);
  const paint = parseColor(resolved);

  if (paint) return hex8(paint);

  warn(request, 'shape_color', `"${token}" is not a colour the shape can draw; drawn in ${fallback}`);

  return hex8(parseColor(fallback) as Paint);
}

function fillOf(request: ShapeRequest): Pick<ShapeSpec, 'fill' | 'c1' | 'c2' | 'angle'> {
  const g = request.graphic;

  if (g.fill === false) return { fill: 'none' };

  if (!g.gradient) return { fill: 'solid', c1: rgba(request, g.color, BRAND) };

  const kind = g.gradient.shape ?? 'linear';

  return {
    fill: kind,
    c1: rgba(request, g.gradient.from, BRAND),
    c2: rgba(request, g.gradient.to, BRAND),
    ...(kind === 'linear' ? { angle: g.gradient.angle ?? SHAPE_DEFAULTS.gradientAngle } : {}),
  };
}

// The outline in frame px and its box; null (after a warning) when there is nothing sensible to draw.
function outlineOf(request: ShapeRequest, frame: Frame): Outline | null {
  const g = request.graphic;
  const target = g.target === undefined ? null : resolveFxTarget(g.target, request);

  if (g.target !== undefined && !target) {
    warn(request, 'shape_target', 'the target names nothing in this section; skipped');

    return null;
  }

  const commands = shapeOutline(g, frame, target, request.seed);
  const bounds = commands && shapeBounds(commands, strokeWidth(g));

  if (!commands || !bounds) {
    warn(request, 'shape_empty', 'the outline is empty; skipped');

    return null;
  }

  if (bounds.w > MAX_SPAN * frame.width || bounds.h > MAX_SPAN * frame.height) {
    const size = `${Math.round(bounds.w)}×${Math.round(bounds.h)} px`;
    warn(request, 'shape_too_large', `it spans ${size}, more than twice the frame; skipped (check the units of d)`);

    return null;
  }

  return { commands, bounds };
}

function drawnOutline(request: ShapeRequest, commands: PathCommand[], drawable: boolean): PathGraphic | null {
  const g = request.graphic;

  if (!g.stroke?.draw || !drawable) return null;

  return {
    type: 'path',
    d: svgPathText(commands),
    thickness: strokeWidth(g),
    color: g.stroke.color ?? INK,
    duration: g.duration ?? SHAPE_DEFAULTS.drawDuration,
    ease: g.ease ?? PATH_DEFAULTS.ease,
    caps: 'round',
    exit: 'none',
  };
}

function animateOf(request: ShapeRequest, outline: PathGraphic | null): LayerAnimate {
  const g = request.graphic;

  if (g.animate) return g.animate;

  const start = outline ? request.at + (outline.duration ?? SHAPE_DEFAULTS.drawDuration) : request.at;
  const duration = outline ? SHAPE_DEFAULTS.fillFade : (g.duration ?? SHAPE_DEFAULTS.duration);
  const ease = outline ? SHAPE_DEFAULTS.ease : (g.ease ?? SHAPE_DEFAULTS.ease);

  return {
    opacity: [
      { t: start, v: 0 },
      { t: start + duration, v: 1, ease },
    ],
  };
}

function specOf(request: ShapeRequest, outline: Outline, box: Rect, density: number, baked: boolean): ShapeSpec | null {
  const g = request.graphic;
  const fill = fillOf(request);
  const sw = baked ? strokeWidth(g) * density : 0;

  if (fill.fill === 'none' && sw === 0) return null;

  const raster = mapCommands(outline.commands, (x, y) => [(x - box.x) * density, (y - box.y) * density]);

  return {
    w: Math.max(1, Math.floor(box.w * density)),
    h: Math.max(1, Math.floor(box.h * density)),
    rule: g.fillRule ?? 'nonzero',
    ...fill,
    sw,
    ...(sw > 0 ? { sc: rgba(request, g.stroke?.color, INK) } : {}),
    path: encodeCommands(raster),
  };
}

/** Everything the lowering needs, or null (after a warning) when the shape is skipped. */
export function planShape(request: ShapeRequest): ShapePlan | null {
  const g = request.graphic;
  const outline = outlineOf(request, frameOf(request));

  if (!outline) return null;

  const box = boxOf(outline.bounds);
  const density = densityOf(box, g.animate);

  if (density < 1) {
    warn(request, 'shape_downsampled', `drawn at ${Math.round(density * 100)}% to stay within ${MAX_SHAPE_PIXELS} px`);
  }

  const drawable = request.ctx.masks?.available !== false;

  if (g.stroke?.draw && !drawable) {
    warn(
      request,
      'shape_draw_unavailable',
      'this engine cannot draw the outline on (no alphamerge); shown with the fill'
    );
  }

  const drawn = drawnOutline(request, outline.commands, drawable);
  const baked = g.stroke !== undefined && drawn === null;
  const spec = specOf(request, outline, box, density, baked);
  const problem = spec && shapeSpecProblem(spec);

  if (problem) {
    warn(request, 'shape_too_large', `${problem}; skipped`);

    return null;
  }

  return { box, density, spec, animate: animateOf(request, drawn), outline: drawn };
}
