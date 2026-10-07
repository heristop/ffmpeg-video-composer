// Draws sampled strokes (stroke-timeline.ts) as filters. Straight pieces are drawbox rectangles, one set
// per sample window, like the other graphics. Rounded pieces (quarter arcs, underline caps) are
// crops of ONE compile-time sprite (fx-sprites.ts, anti-aliased, rendered at its exact size), each overlaid
// once for the whole life of the graphic: its `enable` is the union of the windows where it shows and its
// x/y are step functions of t built from the same samples, so sprites and rectangles agree to the pixel on
// every frame. Alpha ramps on sprites use `fade` with the same frame convention as the drawbox ramps. An
// optional soft shadow (the same shapes in black, offset down-right) is drawn first. Filters: drawbox,
// overlay, split, crop, colorchannelmixer, fps, fade, null (all on the on-device allowlist).

import type { Filter, FilterGraphChain } from '@/core/types';
import { fmt } from '@/core/motion/hermite';
import { boxes, windowExpr, withAlpha, type Rect } from './graphics-spec';
import type { SpriteSpec } from './fx-sprites';
import { drawn, type ArcPiece, type Corner, type Piece } from './stroke-path';
import type { StrokePhase, StrokeSample } from './stroke-timeline';

export interface StrokeShadow {
  offset: number;
  alpha: number;
}

/** What every sprite overlay of one graphic shares. */
export interface SpriteStage {
  /** Alpha ramps of the whole graphic (entrance fade, exit fade), applied to sprites with `fade`. */
  fadeIn: StrokePhase | null;
  fadeOut: StrokePhase | null;
  fps: number;
  prefix: string;
  /** Registers a compile-time sprite; its sub-graph label, or null when the segment cannot take inputs. */
  sprite: (key: string, spec: SpriteSpec) => string | null;
}

export interface StrokeDraw extends SpriteStage {
  /** The paths at an outline inflation of `grow` px. */
  paths: (grow: number) => Piece[][];
  thickness: number;
  /** "#rrggbb" and its alpha. */
  color: string;
  alpha: number;
  shadow: StrokeShadow | null;
  samples: StrokeSample[];
}

/** Where a sprite crop shows: from/to window and its top-left there. */
export interface SpriteStep {
  from: number;
  to: number | undefined;
  x: number;
  y: number;
}

/** One overlaid crop of a sprite: the crop rectangle (sprite px) and its steps. */
export interface SpriteTrack {
  crop: Rect;
  steps: SpriteStep[];
}

export interface SpriteLayer {
  key: string;
  spec: SpriteSpec;
  alpha: number;
  /** Px added to x and y (the shadow's offset). */
  offset: number;
}

const QUADRANT: Record<Corner, [number, number]> = { tl: [0, 0], tr: [1, 0], br: [1, 1], bl: [0, 1] };

/** Appends a step to a track, extending the previous one when it continues it unchanged. */
export function addStep(steps: SpriteStep[], step: SpriteStep): void {
  const last = steps.at(-1);

  if (last && last.to === step.from && last.x === step.x && last.y === step.y) {
    last.to = step.to;

    return;
  }

  steps.push(step);
}

function enableExpr(steps: SpriteStep[]): string {
  const terms = steps.map((s) =>
    s.to === undefined ? `gte(t,${fmt(s.from)})` : `gte(t,${fmt(s.from)})*lt(t,${fmt(s.to)})`
  );

  return terms.join('+');
}

/** A step function of t: each step's value from its start on (values outside the steps do not matter). */
function stepExpr(steps: SpriteStep[], axis: 'x' | 'y', offset: number): string {
  const values = steps.map((s) => s[axis] + offset);

  if (values.every((v) => v === values[0])) return fmt(values[0]);

  return steps
    .slice(1)
    .reduceRight((rest, s, i) => `if(lt(t,${fmt(s.from)}),${fmt(values[i])},${rest})`, fmt(values.at(-1) as number));
}

function ramp(kind: 'in' | 'out', phase: StrokePhase, fps: number): Filter {
  return { type: 'fade', value: `t=${kind}:st=${fmt(phase.start)}:d=${fmt(phase.frames / fps)}:alpha=1` };
}

function fades(stage: SpriteStage): Filter[] {
  return [
    ...(stage.fadeIn ? [ramp('in', stage.fadeIn, stage.fps)] : []),
    ...(stage.fadeOut ? [ramp('out', stage.fadeOut, stage.fps)] : []),
  ];
}

/**
 * One sprite split into every track's crop and overlaid in turn over `base`. Returns the chains and the
 * label of the last overlay, or null when the sprite cannot be registered.
 */
export function spriteOverlays(
  stage: SpriteStage,
  layer: SpriteLayer,
  tracks: SpriteTrack[],
  base: string
): { chains: FilterGraphChain[]; out: string } | null {
  const p = `${stage.prefix}${layer.key}`;
  const sprite = stage.sprite(layer.key, layer.spec);

  if (!sprite) return null;

  const outputs = tracks.map((_, i) => `${p}s${i}`);
  const split: FilterGraphChain = {
    inputs: [sprite],
    filters: [{ type: 'split', value: String(tracks.length) }],
    outputs,
  };
  const alpha: Filter[] = layer.alpha < 1 ? [{ type: 'colorchannelmixer', value: `aa=${fmt(layer.alpha)}` }] : [];
  const chains = tracks.flatMap((track, i): FilterGraphChain[] => {
    const { x, y, w, h } = track.crop;
    const crop: Filter = { type: 'crop', value: `${w}:${h}:${x}:${y}` };
    const at = `x='${stepExpr(track.steps, 'x', layer.offset)}':y='${stepExpr(track.steps, 'y', layer.offset)}'`;
    const overlay: Filter = { type: 'overlay', value: `${at}:enable='${enableExpr(track.steps)}'` };

    return [
      {
        inputs: [`${p}s${i}`],
        filters: [crop, ...alpha, { type: 'fps', value: String(stage.fps) }, ...fades(stage)],
        outputs: [`${p}a${i}`],
      },
      { inputs: [i === 0 ? base : `${p}o${i - 1}`, `${p}a${i}`], filters: [{ ...overlay }], outputs: [`${p}o${i}`] },
    ];
  });

  return { chains: [split, ...chains], out: `${p}o${tracks.length - 1}` };
}

/** Closes a sub-graph: its last chain feeds the section's next filter (no output label). */
export function closeGraph(chains: FilterGraphChain[]): Filter[] {
  const last = chains.at(-1) as FilterGraphChain;

  return [{ type: 'graph', graph: [...chains.slice(0, -1), { ...last, outputs: undefined }] }];
}

/** A chain of `filters` (a `null` pass-through when empty). */
export function stageChain(inputs: string[] | undefined, filters: Filter[], out: string): FilterGraphChain {
  return { ...(inputs ? { inputs } : {}), filters: filters.length > 0 ? filters : [{ type: 'null' }], outputs: [out] };
}

function shifted(rects: Rect[], by: number): Rect[] {
  return rects.map((r) => ({ ...r, x: r.x + by, y: r.y + by }));
}

interface Sampled {
  shadow: Filter[];
  strokes: Filter[];
  arcs: Map<string, { piece: ArcPiece; steps: SpriteStep[] }>;
}

/** drawbox filters of every sample (shadow apart), and where each arc shows. */
function sampled(d: StrokeDraw): Sampled {
  const out: Sampled = { shadow: [], strokes: [], arcs: new Map() };

  for (const sample of d.samples) {
    const paths = d.paths(sample.pose.grow);
    const enable = windowExpr(sample.from, sample.to);

    for (const level of sample.pose.levels) {
      const alpha = level.alpha * sample.pose.alpha;
      const parts = paths.map((pieces, i) => ({ i, ...drawn(pieces, level.spans[i] ?? []) }));
      const rects = parts.flatMap((part) => part.rects);
      const shade = d.shadow ? withAlpha('#000000', d.shadow.alpha * alpha) : '';

      if (d.shadow) out.shadow.push(...boxes(shifted(rects, d.shadow.offset), shade, enable));
      out.strokes.push(...boxes(rects, withAlpha(d.color, d.alpha * alpha), enable));

      for (const part of parts) {
        for (const j of part.arcs) {
          const piece = paths[part.i][j] as ArcPiece;
          const entry = out.arcs.get(`${part.i}_${j}`) ?? { piece, steps: [] };

          out.arcs.set(`${part.i}_${j}`, entry);
          addStep(entry.steps, { from: sample.from, to: sample.to, x: piece.x, y: piece.y });
        }
      }
    }
  }

  return out;
}

/** The sprite every quarter arc is cut from: a circle outline of radius `size`. */
function arcSprite(size: number, thickness: number, color: string): SpriteSpec {
  return { kind: 'stroke', w: 2 * size, h: 2 * size, radius: size, stroke: thickness, color };
}

/** The graphic as filters: plain drawboxes when it has no arcs, else one sub-graph. Null: sprites unavailable. */
export function strokeFilters(d: StrokeDraw): Filter[] | null {
  const { shadow, strokes, arcs } = sampled(d);
  const entries = [...arcs.values()];

  if (entries.length === 0) return [...shadow, ...strokes];

  const size = entries[0].piece.size;
  const tracks = entries.map(({ piece, steps }) => {
    const [qx, qy] = QUADRANT[piece.corner];

    return { crop: { x: qx * size, y: qy * size, w: size, h: size }, steps };
  });
  const p = d.prefix;
  const under =
    d.shadow &&
    spriteOverlays(
      d,
      { key: 'sh', spec: arcSprite(size, d.thickness, '000000'), alpha: d.shadow.alpha, offset: d.shadow.offset },
      tracks,
      `${p}m0`
    );
  const middle = stageChain([under ? under.out : `${p}m0`], strokes, `${p}m1`);
  const hex = d.color.replace('#', '').toLowerCase();
  const over = spriteOverlays(
    d,
    { key: 'st', spec: arcSprite(size, d.thickness, hex), alpha: d.alpha, offset: 0 },
    tracks,
    `${p}m1`
  );

  if (!over || (d.shadow && !under)) return null;

  return closeGraph([stageChain(undefined, shadow, `${p}m0`), ...(under ? under.chains : []), middle, ...over.chains]);
}
