// The path graphic as the graphics table (graphics.ts) sees it: its defaults, its commands in frame px and
// its footprint for the motion timeline. Its `render` hands the element to the compile path's lowering
// (path-draw.ts, reached through SugarContext.masks.strokes like the other strokes), so the rasteriser
// stays out of the browser's eager load; without that lowering (validation, timelines) it draws nothing.

import { flatten, catmullRom, shapeCommands, type PathCommand, type PathShape } from './path-geometry';
import { parseSvgPath } from './path-svg';
import {
  BRAND,
  type Base,
  type Frame,
  type GraphicEnv,
  type GraphicWindow,
  type Of,
  type Rect,
  type Spec,
} from './graphics-spec';

export type PathGraphic = Of<'path'>;

export const PATH_DEFAULTS = {
  duration: 1.2,
  ease: 'cubic-bezier(0.65, 0, 0.35, 1)',
  thickness: 6,
  exit: 'fade',
  exitDuration: 0.3,
  retractDuration: 0.6,
} as const;

type Scale = (x: number, y: number) => [number, number];

function scaleOf(box: Rect | null): Scale {
  return box ? (x, y) => [box.x + x * box.w, box.y + y * box.h] : (x, y) => [x, y];
}

// Px commands of authored ones: every coordinate pair goes through `at`.
function mapped(commands: PathCommand[], at: Scale): PathCommand[] {
  return commands.map((command) => {
    const [kind, ...args] = command;

    if (kind === 'Z' || kind === 'E' || kind === 'W') return command;

    const pairs = Array.from({ length: args.length / 2 }, (_, i) => at(args[2 * i], args[2 * i + 1])).flat();

    return [kind, ...pairs] as PathCommand;
  });
}

function scaledShape(shape: PathShape, box: Rect | null): PathShape {
  if (!box) return shape;

  const at = scaleOf(box);
  const short = Math.min(box.w, box.h);

  if (shape.type === 'wave') {
    const [x, y] = at(shape.x, shape.y);

    return {
      ...shape,
      x,
      y,
      width: shape.width * box.w,
      amplitude: shape.amplitude * box.h,
      wavelength: shape.wavelength * box.w,
    };
  }

  const [cx, cy] = at(shape.cx, shape.cy);

  if (shape.type === 'ellipse') return { ...shape, cx, cy, rx: shape.rx * box.w, ry: shape.ry * box.h };

  return { ...shape, cx, cy, r: shape.r * short };
}

/**
 * The path's commands in frame px: coordinates are px, or fractions of `box` (the resolved target) when one
 * is given. Null when the `d` string does not parse.
 */
export function pathCommandsOf(g: PathGraphic, box: Rect | null): PathCommand[] | null {
  if (g.shape) return shapeCommands(scaledShape(g.shape, box));

  if (g.d !== undefined) {
    const parsed = parseSvgPath(g.d);

    return parsed && mapped(parsed, scaleOf(box));
  }

  const points = (g.points ?? []).map(([x, y]) => {
    const [px, py] = scaleOf(box)(x, y);

    return { x: px, y: py };
  });

  if (points.length < 2) return null;

  if (g.smooth) return catmullRom(points, g.closed ?? false);

  return [
    ['M', points[0].x, points[0].y],
    ...points.slice(1).map((p): PathCommand => ['L', p.x, p.y]),
    ...(g.closed ? [['Z'] as PathCommand] : []),
  ];
}

/** The bounding box of the stroke (its polylines grown by half the thickness), or null when empty. */
export function pathBounds(commands: PathCommand[], thickness: number): Rect | null {
  const points = flatten(commands).flat();

  if (points.length === 0) return null;

  const half = thickness / 2;
  const x = Math.min(...points.map((p) => p.x)) - half;
  const y = Math.min(...points.map((p) => p.y)) - half;

  return { x, y, w: Math.max(...points.map((p) => p.x)) + half - x, h: Math.max(...points.map((p) => p.y)) + half - y };
}

function render(g: PathGraphic) {
  return (window: GraphicWindow, env: GraphicEnv) => {
    const site = env.site;
    const lower = site?.ctx.masks?.strokes;

    return site && lower ? (lower({ graphic: g, ...window, seed: env.seed, ...site }) ?? []) : [];
  };
}

// The footprint resolves a target only when it is the frame; any other target counts as the whole frame.
function footprintBox(g: PathGraphic, frame: Frame): Rect | null {
  if (g.target === undefined) return null;

  return { x: 0, y: 0, w: frame.width, h: frame.height };
}

export function pathSpec(g: PathGraphic, frame: Frame, base: Base): Spec {
  const commands = pathCommandsOf(g, footprintBox(g, frame));
  const bounds = commands && pathBounds(commands, g.thickness ?? PATH_DEFAULTS.thickness);

  return {
    ...base,
    duration: g.duration ?? PATH_DEFAULTS.duration,
    ease: g.ease ?? PATH_DEFAULTS.ease,
    color: g.color ?? BRAND,
    rects: () => (bounds ? [bounds] : []),
    render: render(g),
  };
}
