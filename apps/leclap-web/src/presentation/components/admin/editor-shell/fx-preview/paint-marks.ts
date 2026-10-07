// Live previews of the primitives that mark a moment: ripple (rings from a point, or a tap), glint (star
// twinkles) and confetti (a ballistic burst). The plans are the engine's own (ring sizes and windows, star
// spots and timing, every confetti piece's flight), so the preview shows the render's composition; rings are
// stroked with a halo, stars and pieces are the engine's sprites.
import type { FxContext } from 'ffmpeg-video-composer/src/editor/presets/fx-kit.ts';
import {
  planOf as ripplePlan,
  PRESS,
  PRESS_EASE,
  RELEASE_EASE,
  ringWindow,
  type RipplePlan,
} from 'ffmpeg-video-composer/src/editor/presets/fx-ripple.ts';
import { GROW, planOf as glintPlan, SHRINK_EASE } from 'ffmpeg-video-composer/src/editor/presets/fx-glint.ts';
import { OVERSHOOT } from 'ffmpeg-video-composer/src/editor/presets/fx-glint-paths.ts';
import { confettiPieces, DEFAULT_SIZE, spriteOf } from 'ffmpeg-video-composer/src/editor/presets/fx-confetti.ts';
import { frameScale } from 'ffmpeg-video-composer/src/editor/presets/fx-marks.ts';
import { ballisticApex, ballisticAt } from 'ffmpeg-video-composer/src/core/motion/ballistic.ts';
import { parseEasing } from 'ffmpeg-video-composer/src/core/motion/easing.ts';
import { clamp01, inWindow, pulseEnvelope, rampIn, rampOut } from './fx-time';
import { pixelScale, rgba } from './painter';
import { drawSprite } from './sprite-cache';

type Paint = (ctx: CanvasRenderingContext2D, t: number) => void;

/** Pass starts inside the window (the engine's passStarts). */
export function passStarts(fx: { at: number; every: number; passes: number; end: number }): number[] {
  return Array.from({ length: fx.passes }, (_, i) => fx.at + i * fx.every).filter((t0) => t0 < fx.end);
}

/** One ring at section time `t`: its scale (share of the final radius) and alpha, or null outside its life. */
export function ringAt(fx: FxContext<'ripple'>, plan: RipplePlan, win: { start: number; life: number }, t: number) {
  if (t < win.start || t > win.start + win.life) return null;

  const q = clamp01((t - win.start) / win.life);
  const eased = parseEasing(fx.ease).fn(q);
  const ramp = Math.min(4 / fx.frame.fps, win.life / 3);

  return { scale: plan.start + (1 - plan.start) * eased, alpha: fx.peak * rampIn(t, win.start, ramp) * (1 - q) ** 2 };
}

function strokeRing(
  ctx: CanvasRenderingContext2D,
  plan: RipplePlan,
  at: { cx: number; cy: number },
  ring: { scale: number; alpha: number }
) {
  const spec = plan.spec;
  ctx.save();
  ctx.strokeStyle = rgba(`#${spec.color ?? 'ffffff'}`, ring.alpha);
  ctx.shadowColor = rgba(`#${spec.color ?? 'ffffff'}`, ring.alpha);
  ctx.shadowBlur = 2 * (spec.halo ?? 0) * ring.scale * pixelScale(ctx);
  ctx.lineWidth = Math.max(0.5, (spec.stroke ?? 4) * ring.scale);
  ctx.beginPath();
  ctx.arc(at.cx, at.cy, (spec.radius ?? 40) * ring.scale, 0, 2 * Math.PI);
  ctx.stroke();
  ctx.restore();
}

function tapDot(fx: FxContext<'ripple'>, t0: number, t: number): { scale: number; alpha: number } | null {
  if (t < t0 || t > t0 + fx.duration) return null;

  const press = fx.graphic.press ?? 0.09;
  const down = parseEasing(PRESS_EASE).fn(clamp01((t - t0) / (PRESS * 0.4)));
  const up = parseEasing(RELEASE_EASE).fn(clamp01((t - t0 - PRESS * 0.4) / (PRESS * 0.6)));
  const fadeAt = t0 + fx.duration * 0.45;
  const fade = rampOut(t, fadeAt, t0 + fx.duration - fadeAt) ** 2;

  return { scale: 1 - press - press * down + 2 * press * up, alpha: fx.peak * rampIn(t, t0, 4 / fx.frame.fps) * fade };
}

function fillDot(
  ctx: CanvasRenderingContext2D,
  plan: RipplePlan,
  at: { cx: number; cy: number },
  dot: { scale: number; alpha: number }
) {
  ctx.fillStyle = rgba(`#${plan.color}`, dot.alpha);
  ctx.beginPath();
  ctx.arc(at.cx, at.cy, (plan.dot / 2) * dot.scale, 0, 2 * Math.PI);
  ctx.fill();
}

export function paintRipple(fx: FxContext<'ripple'>): Paint | null {
  const plan = ripplePlan(fx);

  if (!plan) return null;

  const at = { cx: fx.target.x + plan.cx, cy: fx.target.y + plan.cy };
  const windows = passStarts(fx).flatMap((t0) =>
    Array.from({ length: plan.rings }, (_, i) => ringWindow(fx, plan, t0, i))
  );

  return (ctx, t) => {
    if (!inWindow(fx, t)) return;

    if (fx.reduced) {
      const alpha = fx.peak * (plan.tap ? 0.6 : 1) * pulseEnvelope(fx, t);

      if (plan.tap) {
        fillDot(ctx, plan, at, { scale: 1, alpha });

        return;
      }

      strokeRing(ctx, plan, at, { scale: (plan.start + 1) / 2, alpha });

      return;
    }

    for (const t0 of plan.tap ? passStarts(fx) : []) {
      const dot = tapDot(fx, t0, t);

      if (dot) fillDot(ctx, plan, at, dot);
    }

    for (const win of windows) {
      const ring = ringAt(fx, plan, win, t);

      if (ring) strokeRing(ctx, plan, at, ring);
    }
  };
}

/** A star's size (share of its sprite) at `t`: it grows on the effect's curve, then shrinks. */
export function starScale(
  fx: FxContext<'glint'>,
  star: { scale: number; start: number; life: number },
  t: number
): number {
  const up = parseEasing(fx.ease).fn(clamp01((t - star.start) / (star.life * GROW)));
  const down = parseEasing(SHRINK_EASE).fn(clamp01((t - star.start - star.life * GROW) / (star.life * (1 - GROW))));

  return (star.scale / OVERSHOOT) * (up - down);
}

export function paintGlint(fx: FxContext<'glint'>): Paint | null {
  const plan = glintPlan(fx);

  if (!plan) return null;

  const spin = ((fx.graphic.spin ?? 15) * Math.PI) / 180;
  const region = { ...fx.target };

  return (ctx, t) => {
    for (const star of plan.stars) {
      const centre = { cx: region.x + star.cx, cy: region.y + star.cy };

      if (fx.reduced) {
        drawSprite(ctx, plan.spec, {
          ...centre,
          scale: (0.5 * star.scale) / OVERSHOOT,
          alpha: fx.peak * pulseEnvelope(fx, t),
        });
        continue;
      }

      if (t < star.start || t > star.start + star.life) continue;

      const ramp = Math.min(4 / fx.frame.fps, star.life / 4);
      const alpha = fx.peak * rampIn(t, star.start, ramp) * rampOut(t, star.start + star.life - ramp, ramp);
      const angle = spin * clamp01((t - star.start) / star.life);
      drawSprite(ctx, plan.spec, { ...centre, scale: starScale(fx, star, t), alpha, angle });
    }
  };
}

export function paintConfetti(fx: FxContext<'confetti'>): Paint {
  const pieces = confettiPieces(fx);
  const size = (fx.graphic.size ?? DEFAULT_SIZE) * frameScale(fx);
  const fade = Math.min(fx.graphic.fade ?? 0.5, fx.duration / 2);

  return (ctx, t) => {
    if (!inWindow(fx, t)) return;

    for (const piece of pieces) {
      const spec = spriteOf(piece.sprite, size);

      if (fx.reduced) {
        const rest = ballisticAt(piece.flight, ballisticApex(piece.flight).T * 0.6);
        drawSprite(ctx, spec, {
          cx: rest.x,
          cy: rest.y,
          scale: piece.scale,
          alpha: piece.alpha * pulseEnvelope(fx, t),
          angle: piece.angle,
        });
        continue;
      }

      const since = t - piece.t0;

      if (since < 0 || since > fx.duration) continue;

      const at = ballisticAt(piece.flight, since);
      const end = piece.t0 + fx.duration;
      const alpha = piece.alpha * rampIn(t, piece.t0, 4 / fx.frame.fps) * rampOut(t, end - fade, fade);
      const squash = Math.max(0.18, Math.abs(Math.cos(piece.flutter * since + piece.flip)));
      drawSprite(ctx, spec, {
        cx: at.x,
        cy: at.y,
        scale: piece.scale,
        alpha,
        angle: piece.angle + piece.spin * since,
        squash,
      });
    }
  };
}
