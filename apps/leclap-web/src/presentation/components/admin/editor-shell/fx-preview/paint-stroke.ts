// Live previews of the stroke graphics: frame, corners and underline. Each stroke is planned by the engine
// itself (outline + framePlan / cornersPlan + strokeSamples for frame and corners; the
// underline's setup + extents), so the canvas shows the exact pose of every frame — trace order, spring
// close-in, rounded corners, exit and contrast shadow.
import type { Graphic } from 'ffmpeg-video-composer/src/schemas/graphics.schemas.ts';
import type { StrokeRequest } from 'ffmpeg-video-composer/src/editor/presets/sugar-context.ts';
import { inkOf, outline, type Ink } from 'ffmpeg-video-composer/src/editor/presets/stroke-graphics.ts';
import { cornersPlan, framePlan } from 'ffmpeg-video-composer/src/editor/presets/stroke-outline.ts';
import { strokeSamples, type StrokeSample } from 'ffmpeg-video-composer/src/editor/presets/stroke-timeline.ts';
import { drawn, type ArcPiece, type Piece } from 'ffmpeg-video-composer/src/editor/presets/stroke-path.ts';
import { inflate } from 'ffmpeg-video-composer/src/editor/presets/stroke-shapes.ts';
import { DEFAULT_CLEARANCE, even, type OutlineRequest } from 'ffmpeg-video-composer/src/editor/presets/stroke-kit.ts';
import { extents, setup, type UnderlineRequest } from 'ffmpeg-video-composer/src/editor/presets/stroke-underline.ts';
import type { Rect } from 'ffmpeg-video-composer/src/editor/presets/graphics-spec.ts';
import { elementSeed, frameOf, PREVIEW_FPS, previewTarget, seconds, themeColor, type PreviewEnv } from './fx-context';
import { rgba } from './painter';

export type StrokeGraphic = Extract<Graphic, { type: 'frame' | 'corners' | 'underline' }>;
type Paint = (ctx: CanvasRenderingContext2D, t: number) => void;

/** A stroke request as the compile path builds it, from the builder's section (a colour section's layers). */
export function strokeRequest(graphic: StrokeGraphic, index: number, env: PreviewEnv): StrokeRequest {
  const frame = frameOf(env.orientation);
  const section = env.section;
  const options = section.kind === 'color' ? { backgroundColor: section.color, layers: section.layers ?? [] } : {};

  return {
    graphic,
    index,
    seed: elementSeed(index, env),
    at: seconds(graphic.at, 0),
    until: typeof graphic.until === 'number' ? graphic.until : undefined,
    section: { name: 'preview', type: section.kind === 'color' ? 'color_background' : 'video', options },
    ctx: {
      duration: env.sectionSeconds,
      scale: `${frame.width}:${frame.height}`,
      fps: PREVIEW_FPS,
      isVideo: section.kind === 'video',
      theme: env.theme,
      masks: { color: (color: string) => themeColor(color, env.theme) },
    },
  } as unknown as StrokeRequest;
}

/** The rectangle a frame or corners runs along (the engine's boxOf), or null when nothing is left. */
export function outlineBox(request: OutlineRequest, env: PreviewEnv): Rect | null {
  const g = request.graphic;
  const { width, height } = frameOf(env.orientation);

  if (g.target === undefined) {
    const inset = even(g.inset ?? (g.type === 'frame' ? 48 : 56));

    return { x: inset, y: inset, w: width - 2 * inset, h: height - 2 * inset };
  }

  const target = previewTarget(g.target, env);

  if (!target) return null;

  const grown = inflate(target, even(g.clearance ?? DEFAULT_CLEARANCE));
  const [x, y] = [Math.max(0, grown.x), Math.max(0, grown.y)];
  const [right, bottom] = [Math.min(width, grown.x + grown.w), Math.min(height, grown.y + grown.h)];

  return right - x >= 8 && bottom - y >= 8 ? { x, y, w: right - x, h: bottom - y } : null;
}

/** The sample covering section time `t`, or null when nothing is drawn then. */
export function sampleAt(samples: readonly StrokeSample[], t: number): StrokeSample | null {
  return samples.find((sample) => t >= sample.from && (sample.to === undefined || t < sample.to)) ?? null;
}

const ARC_ANGLES: Record<ArcPiece['corner'], [number, number, number, number]> = {
  tl: [1, 1, Math.PI, 1.5 * Math.PI],
  tr: [0, 1, 1.5 * Math.PI, 2 * Math.PI],
  br: [0, 0, 0, 0.5 * Math.PI],
  bl: [1, 0, 0.5 * Math.PI, Math.PI],
};

function drawPieces(
  ctx: CanvasRenderingContext2D,
  pieces: readonly Piece[],
  spans: Parameters<typeof drawn>[1],
  thickness: number
) {
  const { rects, arcs } = drawn(pieces, spans);

  for (const rect of rects) ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

  for (const index of arcs) {
    const arc = pieces[index] as ArcPiece;
    const [fx, fy, from, to] = ARC_ANGLES[arc.corner];
    ctx.lineWidth = thickness;
    ctx.beginPath();
    ctx.arc(arc.x + fx * arc.size, arc.y + fy * arc.size, arc.size - thickness / 2, from, to);
    ctx.stroke();
  }
}

function drawPose(
  ctx: CanvasRenderingContext2D,
  plan: ReturnType<typeof framePlan>,
  sample: StrokeSample,
  look: { ink: Ink; thickness: number; dx: number; color: string; alpha: number }
) {
  const paths = plan.paths(sample.pose.grow);

  for (const level of sample.pose.levels) {
    const paint = rgba(look.color, look.alpha * sample.pose.alpha * level.alpha);
    [ctx.fillStyle, ctx.strokeStyle] = [paint, paint];
    ctx.save();
    ctx.translate(look.dx, look.dx);

    for (const [i, pieces] of paths.entries()) drawPieces(ctx, pieces, level.spans.at(i) ?? [], look.thickness);
    ctx.restore();
  }
}

function paintOutline(request: OutlineRequest, env: PreviewEnv): { paint: Paint; box: Rect } | null {
  const box = outlineBox(request, env);

  if (!box) return null;

  const o = outline(request, box);
  const ink = inkOf(o);
  const plan = request.graphic.type === 'frame' ? framePlan(o) : cornersPlan(o);
  const samples = strokeSamples(plan);

  return {
    box,
    paint: (ctx, t) => {
      const sample = sampleAt(samples, t);

      if (!sample) return;

      if (ink.shadow) {
        drawPose(ctx, plan, sample, {
          ink,
          thickness: o.thickness,
          dx: ink.shadow.offset,
          color: '#000000',
          alpha: ink.shadow.alpha * ink.alpha,
        });
      }
      drawPose(ctx, plan, sample, { ink, thickness: o.thickness, dx: 0, color: ink.color, alpha: ink.alpha });
    },
  };
}

function paintUnderline(request: UnderlineRequest): { paint: Paint; box: Rect } {
  const s = setup(request);
  const all = extents(request, s);
  const { line } = s;

  return {
    box: { x: line.x, y: line.y, w: line.width, h: line.thickness },
    paint: (ctx, t) => {
      const e = all.find((extent) => t >= extent.from && (extent.to === undefined || t < extent.to));

      if (!e || e.right - e.left < 1) return;

      ctx.fillStyle = rgba(s.color, s.alpha * e.alpha);
      ctx.beginPath();
      ctx.roundRect(e.left, line.y, e.right - e.left, line.thickness, s.cap);
      ctx.fill();
    },
  };
}

/** A stroke's painter and the box it draws in, or null when it draws nothing in this section. */
export function strokePainter(
  graphic: StrokeGraphic,
  index: number,
  env: PreviewEnv
): { paint: Paint; box: Rect } | null {
  const request = strokeRequest(graphic, index, env);

  if (graphic.type === 'underline') return paintUnderline(request as UnderlineRequest);

  return paintOutline(request as OutlineRequest, env);
}
