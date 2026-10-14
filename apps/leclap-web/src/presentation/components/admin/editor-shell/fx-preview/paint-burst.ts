// Live preview of burst (impact lines from a point). The plan is the engine's own (every ray's angle, travel,
// length and window, every dot), sampled at one section time the way the engine's expressions are per frame:
// the head and tail of each ray run on the pass ease, the ray is drawn between them (floored at a stub,
// its stroke thinning with it, as the scaled sprite does), faded in over 4 frames and out over its tail.
import type { FxContext } from 'ffmpeg-video-composer/src/editor/presets/fx-kit.ts';
import {
  DOT_SHRINK,
  dotSpec,
  FADE,
  FLOOR,
  HEAD,
  planOf,
  TAIL,
  type BurstPlan,
  type Dot,
  type Ray,
} from 'ffmpeg-video-composer/src/editor/presets/fx-burst.ts';
import { parseEasing } from 'ffmpeg-video-composer/src/core/motion/easing.ts';
import { clamp01, inWindow, pulseEnvelope, rampIn, rampOut } from './fx-time';
import { rgba } from './painter';

type Paint = (ctx: CanvasRenderingContext2D, t: number) => void;
type Ease = (progress: number) => number;

interface Origin {
  x: number;
  y: number;
}

function line(ctx: CanvasRenderingContext2D, origin: Origin, angle: number, from: number, to: number): void {
  const [c, s] = [Math.cos((angle * Math.PI) / 180), Math.sin((angle * Math.PI) / 180)];

  ctx.beginPath();
  ctx.moveTo(origin.x + c * from, origin.y + s * from);
  ctx.lineTo(origin.x + c * to, origin.y + s * to);
  ctx.stroke();
}

/** A ray at section time `t`: its extent (px from the origin), share of its full size and alpha, or null. */
export function rayAt(ease: Ease, ray: Ray, t: number, frame: number) {
  if (t < ray.start || t > ray.start + ray.life) return null;

  const span = ray.outer - ray.inner;
  const head = ease(clamp01((t - ray.start) / (ray.life * HEAD)));
  const tail = ease(clamp01((t - ray.start - ray.life * TAIL) / (ray.life * (1 - TAIL))));
  const share = Math.min(1, Math.max(FLOOR, ((head - tail) * span) / ray.length));
  const mid = ray.inner + (span * (head + tail)) / 2;
  const fadeAt = ray.start + ray.life * FADE;
  const alpha = rampIn(t, ray.start, Math.min(4 * frame, ray.life / 4)) * rampOut(t, fadeAt, ray.life * (1 - FADE));

  return { from: mid - (share * ray.length) / 2, to: mid + (share * ray.length) / 2, share, alpha };
}

type RayState = NonNullable<ReturnType<typeof rayAt>>;

function drawRay(ctx: CanvasRenderingContext2D, plan: BurstPlan, origin: Origin, ray: Ray, at: RayState): void {
  const half = plan.thickness / 2;

  ctx.strokeStyle = rgba(`#${plan.color}`, at.alpha);
  ctx.lineWidth = Math.max(0.5, plan.thickness * at.share);
  // The round caps are inside the ray's length, as in the sprite.
  line(ctx, origin, ray.angle, at.from + half * at.share, at.to - half * at.share);
}

interface DotScene {
  plan: BurstPlan;
  origin: Origin;
  ease: Ease;
  frame: number;
  peak: number;
}

function drawDot(ctx: CanvasRenderingContext2D, scene: DotScene, dot: Dot, t: number): void {
  const { plan, origin, ...clock } = scene;

  if (t < dot.start || t > dot.start + dot.life) return;

  const travel = clock.ease(clamp01((t - dot.start) / dot.life));
  const radius = dot.from + dot.travel * travel;
  const theta = (dot.angle * Math.PI) / 180;
  const ramp = Math.min(4 * clock.frame, dot.life / 4);
  const alpha = clock.peak * rampIn(t, dot.start, ramp) * rampOut(t, dot.start + dot.life * 0.5, dot.life * 0.5);

  ctx.fillStyle = rgba(`#${plan.color}`, alpha);
  ctx.beginPath();
  ctx.arc(
    origin.x + Math.cos(theta) * radius,
    origin.y + Math.sin(theta) * radius,
    (dotSpec(plan).w / 2) * (1 - DOT_SHRINK * travel),
    0,
    2 * Math.PI
  );
  ctx.fill();
}

export function paintBurst(fx: FxContext<'burst'>): Paint | null {
  const plan = planOf(fx);

  if (!plan) return null;

  const origin = { x: fx.target.x + plan.ox, y: fx.target.y + plan.oy };
  const ease = parseEasing(fx.ease).fn;
  const frame = 1 / fx.frame.fps;

  return (ctx, t) => {
    if (!inWindow(fx, t)) return;

    ctx.save();
    ctx.lineCap = 'round';

    for (const ray of fx.reduced ? plan.rays.filter((r) => r.start < fx.at + fx.duration) : plan.rays) {
      const middle = (ray.inner + ray.outer) / 2;
      const still = { from: middle - ray.length * 0.35, to: middle + ray.length * 0.35, share: 0.7 };
      const at = fx.reduced ? { ...still, alpha: pulseEnvelope(fx, t) } : rayAt(ease, ray, t, frame);

      if (at) drawRay(ctx, plan, origin, ray, { ...at, alpha: at.alpha * fx.peak });
    }

    for (const dot of fx.reduced ? [] : plan.dots) drawDot(ctx, { plan, origin, ease, frame, peak: fx.peak }, dot, t);

    ctx.restore();
  };
}
