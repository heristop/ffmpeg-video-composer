// packages/ffmpeg-video-composer/src/editor/presets/shape-geometry.ts
// The maths of the shape graphic (graphics[].type "shape"): where its box sits, and its outline as the path
// graphic's canonical commands in frame px, from a preset laid in the box or a parsed SVG `d` (px, fractions
// of the target, or a viewBox mapped into the box). Star, polygon, heart and blob fit the centred square of
// the box, so a portrait or square frame never stretches them; arrow and rect fill the box. Pure functions
// of their input (a blob's seed included).

import { seededRandom } from '@/core/determinism/hash';
import { mapCommands } from './graphics-path';
import type { Frame, Of, Rect } from './graphics-spec';
import { catmullRom, flattenWithin, type PathCommand, type Pt } from './path-geometry';
import { parseSvgPath } from './path-svg';
import { MAX_SHAPE_POINTS } from './shape-raster';

export type ShapeGraphic = Of<'shape'>;
export type ShapePreset = NonNullable<ShapeGraphic['preset']>;
export type ShapeOutlineInput = Pick<ShapeGraphic, 'preset' | 'd' | 'viewBox' | 'x' | 'y' | 'width' | 'height'>;

export const SHAPE_DEFAULTS = {
  /** Default box side, as a share of the frame's short side. */
  box: 0.4,
  /** Fill fade-in when there are no tracks. */
  duration: 0.4,
  /** Outline draw with stroke.draw. */
  drawDuration: 1.2,
  /** Fill fade-in once a drawn outline closes. */
  fillFade: 0.3,
  ease: 'cubic-bezier(0.16, 1, 0.3, 1)',
  strokeWidth: 4,
  gradientAngle: 180,
} as const;

// Control-point distance of a quarter circle as a cubic, as a share of its radius.
const KAPPA = 0.5523;

// A unit heart (bounds exactly [0, 1]²): the point down, two lobes up.
const HEART: PathCommand[] = [
  ['M', 0.5, 1],
  ['C', 0.12, 0.72, 0, 0.5, 0, 0.28],
  ['C', 0, 0.12, 0.13, 0, 0.28, 0],
  ['C', 0.4, 0, 0.48, 0.08, 0.5, 0.18],
  ['C', 0.52, 0.08, 0.6, 0, 0.72, 0],
  ['C', 0.87, 0, 1, 0.12, 1, 0.28],
  ['C', 1, 0.5, 0.88, 0.72, 0.5, 1],
  ['Z'],
];

type Turn = (u: number, v: number) => [number, number];

// A right-pointing unit arrow turned to its direction (the tip, u = 1, lands on that edge's middle).
const ARROW_TURNS: Record<'right' | 'left' | 'up' | 'down', Turn> = {
  right: (u, v) => [u, v],
  left: (u, v) => [1 - u, v],
  up: (u, v) => [v, 1 - u],
  down: (u, v) => [1 - v, u],
};

/** The box the shape is laid in: px, or fractions of the target; what is not placed is centred. */
export function placementBox(
  g: Pick<ShapeGraphic, 'x' | 'y' | 'width' | 'height'>,
  frame: Frame,
  target: Rect | null
): Rect {
  if (target) {
    const w = (g.width ?? 1) * target.w;
    const h = (g.height ?? g.width ?? 1) * target.h;

    return {
      x: target.x + (g.x === undefined ? (target.w - w) / 2 : g.x * target.w),
      y: target.y + (g.y === undefined ? (target.h - h) / 2 : g.y * target.h),
      w,
      h,
    };
  }

  const side = SHAPE_DEFAULTS.box * Math.min(frame.width, frame.height);
  const w = g.width ?? side;
  const h = g.height ?? g.width ?? side;

  return { x: g.x ?? (frame.width - w) / 2, y: g.y ?? (frame.height - h) / 2, w, h };
}

function closedPolyline(points: Pt[]): PathCommand[] {
  return [['M', points[0].x, points[0].y], ...points.slice(1).map((p): PathCommand => ['L', p.x, p.y]), ['Z']];
}

// `count` points around the centre of the box's centred square, the first at 12 o'clock, clockwise.
function ring(box: Rect, count: number, radiusAt: (i: number) => number): Pt[] {
  const r = Math.min(box.w, box.h) / 2;
  const [cx, cy] = [box.x + box.w / 2, box.y + box.h / 2];

  return Array.from({ length: count }, (_, i) => {
    const angle = ((-90 + (i * 360) / count) * Math.PI) / 180;
    const radius = r * radiusAt(i);

    return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
  });
}

function star(p: Extract<ShapePreset, { type: 'star' }>, box: Rect): PathCommand[] {
  const inner = p.inner ?? 0.5;

  return closedPolyline(ring(box, 2 * (p.points ?? 5), (i) => (i % 2 === 0 ? 1 : inner)));
}

function regular(p: Extract<ShapePreset, { type: 'polygon' }>, box: Rect): PathCommand[] {
  return closedPolyline(ring(box, p.sides ?? 6, () => 1));
}

function heart(_p: Extract<ShapePreset, { type: 'heart' }>, box: Rect): PathCommand[] {
  const side = Math.min(box.w, box.h);
  const [ox, oy] = [box.x + (box.w - side) / 2, box.y + (box.h - side) / 2];

  return mapCommands(HEART, (x, y) => [ox + x * side, oy + y * side]);
}

function arrow(p: Extract<ShapePreset, { type: 'arrow' }>, box: Rect): PathCommand[] {
  const [head, shaft] = [p.head ?? 0.4, p.shaft ?? 0.4];
  const turn = ARROW_TURNS[p.direction ?? 'right'];
  const [top, bottom, neck] = [0.5 - shaft / 2, 0.5 + shaft / 2, 1 - head];
  const unit: Array<[number, number]> = [
    [0, top],
    [neck, top],
    [neck, 0],
    [1, 0.5],
    [neck, 1],
    [neck, bottom],
    [0, bottom],
  ];

  return closedPolyline(
    unit.map(([u, v]) => {
      const [x, y] = turn(u, v);

      return { x: box.x + x * box.w, y: box.y + y * box.h };
    })
  );
}

function blob(p: Extract<ShapePreset, { type: 'blob' }>, box: Rect, seed: number): PathCommand[] {
  const random = seededRandom(p.seed ?? seed);
  const wobble = p.wobble ?? 0.25;
  const points = ring(box, p.lobes ?? 6, () => 1 - wobble * random());

  return [...catmullRom(points, true), ['Z']];
}

function rect(p: Extract<ShapePreset, { type: 'rect' }>, box: Rect): PathCommand[] {
  const { x, y, w, h } = box;
  const r = Math.min(p.radius ?? 0.15, 0.5) * Math.min(w, h);

  if (r === 0) {
    return closedPolyline([
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ]);
  }

  const c = KAPPA * r;

  return [
    ['M', x + r, y],
    ['L', x + w - r, y],
    ['C', x + w - r + c, y, x + w, y + r - c, x + w, y + r],
    ['L', x + w, y + h - r],
    ['C', x + w, y + h - r + c, x + w - r + c, y + h, x + w - r, y + h],
    ['L', x + r, y + h],
    ['C', x + r - c, y + h, x, y + h - r + c, x, y + h - r],
    ['L', x, y + r],
    ['C', x, y + r - c, x + r - c, y, x + r, y],
    ['Z'],
  ];
}

const PRESETS: {
  [K in ShapePreset['type']]: (p: Extract<ShapePreset, { type: K }>, box: Rect, seed: number) => PathCommand[];
} = { star, polygon: regular, heart, arrow, blob, rect };

/** A preset's outline laid in `box` (frame px). `seed` is the blob's when it has none of its own. */
export function presetCommands(preset: ShapePreset, box: Rect, seed: number): PathCommand[] {
  const build = PRESETS[preset.type] as (p: ShapePreset, box: Rect, seed: number) => PathCommand[];

  return build(preset, box, seed);
}

/** `commands` drawn in `viewBox` mapped into `box`, keeping proportions, centred (SVG "xMidYMid meet"). */
export function viewBoxCommands(
  commands: readonly PathCommand[],
  viewBox: readonly [number, number, number, number],
  box: Rect
): PathCommand[] {
  const [vx, vy, vw, vh] = viewBox;
  const scale = Math.min(box.w / vw, box.h / vh);
  const ox = box.x + (box.w - vw * scale) / 2 - vx * scale;
  const oy = box.y + (box.h - vh * scale) / 2 - vy * scale;

  return mapCommands(commands, (x, y) => [ox + x * scale, oy + y * scale]);
}

/** The shape's outline in frame px; null when its `d` does not parse (or it has no outline at all). */
export function shapeOutline(
  g: ShapeOutlineInput,
  frame: Frame,
  target: Rect | null,
  seed: number
): PathCommand[] | null {
  if (g.preset) return presetCommands(g.preset, placementBox(g, frame, target), seed);

  const parsed = g.d === undefined ? null : parseSvgPath(g.d);

  if (!parsed) return null;

  if (g.viewBox) return viewBoxCommands(parsed, g.viewBox, placementBox(g, frame, target));

  if (!target) return parsed;

  return mapCommands(parsed, (x, y) => [target.x + x * target.w, target.y + y * target.h]);
}

/**
 * The outline's box grown by half the stroke, null when it is empty, or 'dense' when it flattens past the
 * point cap. Loops, not spreads: d can be long.
 */
export function shapeBounds(commands: readonly PathCommand[], strokeWidth: number): Rect | 'dense' | null {
  const lines = flattenWithin(commands, MAX_SHAPE_POINTS);

  if (!lines) return 'dense';

  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];

  for (const p of lines.flat()) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }

  const half = strokeWidth / 2;
  const [x, y] = [minX - half, minY - half];
  const [w, h] = [maxX + half - x, maxY + half - y];

  return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? { x, y, w, h } : null;
}

/** Canonical M/L/C/Q/Z commands as an absolute SVG `d` (2 decimals), for the path graphic's draw-on. */
export function svgPathText(commands: readonly PathCommand[]): string {
  return commands
    .map(([kind, ...args]) => [kind, ...args.map((v) => String(Number(v.toFixed(2))))].join(' '))
    .join(' ');
}
