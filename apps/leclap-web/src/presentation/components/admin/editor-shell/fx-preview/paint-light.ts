// Live previews of the light primitives that wash over their target: sheen (a band crossing it), leak (warm
// lobes from off-frame), edge-glow (a bloom around a card) and vignette-breathe. Each takes the engine's own
// plan (bandOf, leak plan, glowOf, vignetteOf: same seeded defaults) and draws it with canvas gradients.
import type { FxContext } from 'ffmpeg-video-composer/src/editor/presets/fx-kit.ts';
import { bandOf, type Band } from 'ffmpeg-video-composer/src/editor/presets/fx-sheen.ts';
import { bandProfile } from 'ffmpeg-video-composer/src/editor/presets/fx-sprite-shapes.ts';
import {
  plan as leakPlan,
  REDUCED_GAIN,
  stopColor,
  leakStops,
} from 'ffmpeg-video-composer/src/editor/presets/fx-leak.ts';
import { ENTER, EXIT, glowOf } from 'ffmpeg-video-composer/src/editor/presets/fx-edge-glow.ts';
import { RAMP, SHADE, vignetteOf } from 'ffmpeg-video-composer/src/editor/presets/fx-vignette.ts';
import { ambientEnvelope, inWindow, lightEnvelope, passProgress, pulseEnvelope } from './fx-time';
import { boxPath, clipped, hexOf, pixelScale, rgba, type Box } from './painter';

type Paint = (ctx: CanvasRenderingContext2D, t: number) => void;

const SHEEN_STILL = 0.08;
const BAND_SAMPLES = 25;

/** The band centre along the travel axis (target px) at eased progress `p`: fully before the target at 0, past it at 1. */
export function sheenAlong(band: Band, size: number, p: number): number {
  const span = size + band.along;
  const lead = band.forward ? -band.along + span * p : span - band.along - span * p;

  return lead + band.along / 2;
}

export function paintSheen(fx: FxContext<'sheen'>): Paint {
  const g = fx.graphic;
  const band = bandOf(fx);
  const target: Box = fx.target;
  const reach = 2.6 * band.width;
  const profile = { width: band.width, peak: fx.peak, bloom: g.bloom ?? 0.25, profile: g.profile ?? 'specular' };
  const size = band.horizontal ? target.w : target.h;
  const [nx, ny] = band.horizontal
    ? [Math.cos(band.tilt), Math.sin(band.tilt)]
    : [Math.sin(band.tilt), Math.cos(band.tilt)];

  return (ctx, t) => {
    const p = passProgress(fx, t);

    if (p === null) return;

    clipped(ctx, target, () => {
      if (fx.reduced) {
        ctx.fillStyle = rgba(fx.color, Math.min(SHEEN_STILL, fx.peak) * pulseEnvelope(fx, t));
        ctx.fillRect(target.x, target.y, target.w, target.h);

        return;
      }

      const along = sheenAlong(band, size, p);
      const [cx, cy] = band.horizontal
        ? [target.x + along, target.y + target.h / 2]
        : [target.x + target.w / 2, target.y + along];
      const gradient = ctx.createLinearGradient(cx - nx * reach, cy - ny * reach, cx + nx * reach, cy + ny * reach);

      for (let i = 0; i < BAND_SAMPLES; i++) {
        const u = i / (BAND_SAMPLES - 1);
        gradient.addColorStop(u, rgba(fx.color, bandProfile(Math.abs((2 * u - 1) * reach), profile)));
      }

      ctx.fillStyle = gradient;
      ctx.fillRect(target.x, target.y, target.w, target.h);
    });
  };
}

export function paintLeak(fx: FxContext<'leak'>): Paint {
  const g = fx.graphic;
  const travel = leakPlan(fx);
  const gain = fx.reduced ? REDUCED_GAIN : 1;

  return (ctx, t) => {
    if (!inWindow(fx, t)) return;

    const envelope = lightEnvelope(fx, t, g.rise ?? 0.3, g.fall ?? 0.5);
    const p = fx.reduced ? 0 : (passProgress(fx, t) ?? 0);

    clipped(ctx, fx.target, () => {
      for (const lobe of travel.lobes) {
        const stops = leakStops(lobe.alpha * gain * envelope);
        ctx.save();
        ctx.translate(fx.target.x + lobe.cx + travel.dx * p, fx.target.y + lobe.cy + travel.dy * p);
        ctx.scale(lobe.rx, lobe.ry);
        const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);

        for (const [i, alpha] of stops.entries()) {
          const u = i / (stops.length - 1);
          gradient.addColorStop(u, rgba(stopColor(lobe.color, u), alpha));
        }
        ctx.fillStyle = gradient;
        ctx.fillRect(-1, -1, 2, 2);
        ctx.restore();
      }
    });
  };
}

export function paintEdgeGlow(fx: FxContext<'edge-glow'>): Paint {
  const glow = glowOf(fx);
  const target: Box = fx.target;
  const life = fx.end - fx.at;
  const line = hexOf(glow.color.map((c) => 255 + (c - 255) * 0.15));

  return (ctx, t) => {
    if (!inWindow(fx, t)) return;

    const envelope = lightEnvelope(fx, t, Math.min(0.45, ENTER / life), Math.min(0.45, EXIT / life));
    const breathe = 1 + glow.breathe * 2 * Math.sin((2 * Math.PI * (t - fx.at)) / glow.period);
    const k = pixelScale(ctx);
    ctx.save();
    // The bloom: the target's outline lit by a soft shadow that falls off outward (the engine's glow sprite).
    ctx.shadowColor = rgba(hexOf(glow.color), Math.min(1, fx.peak * 2.4 * envelope * breathe));
    ctx.shadowBlur = 2 * glow.sigma * k;
    ctx.strokeStyle = rgba(hexOf(glow.color), fx.peak * envelope);
    ctx.lineWidth = Math.max(1, glow.sigma * 0.5);
    boxPath(ctx, target);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = rgba(line, glow.line * envelope);
    ctx.lineWidth = glow.lineWidth;
    boxPath(ctx, {
      ...target,
      x: target.x + glow.lineWidth / 2,
      y: target.y + glow.lineWidth / 2,
      w: target.w - glow.lineWidth,
      h: target.h - glow.lineWidth,
    });
    ctx.stroke();
    ctx.restore();
  };
}

const VIGNETTE_STOPS = 10;

export function paintVignette(fx: FxContext<'vignette-breathe'>): Paint {
  const v = vignetteOf(fx);
  const target: Box = fx.target;
  const shade = fx.graphic.color ? fx.color : SHADE;
  const [cx, cy] = [target.x + v.fx * target.w, target.y + v.fy * target.h];
  const far = Math.max(
    ...[
      [target.x, target.y],
      [target.x + target.w, target.y],
      [target.x, target.y + target.h],
      [target.x + target.w, target.y + target.h],
    ].map(([x, y]) => Math.hypot(x - cx, y - cy))
  );

  return (ctx, t) => {
    if (!inWindow(fx, t)) return;

    const angle = v.angle + v.swing * Math.sin((2 * Math.PI * (t - fx.at)) / v.period);
    const envelope = ambientEnvelope(fx, t, RAMP);

    clipped(ctx, target, () => {
      const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, far);

      for (let i = 0; i < VIGNETTE_STOPS; i++) {
        const u = i / (VIGNETTE_STOPS - 1);
        const darkening = 1 - Math.cos(Math.min(Math.PI / 2, angle * u)) ** 4;
        gradient.addColorStop(u, rgba(shade, Math.min(fx.peak, darkening * v.gain) * envelope));
      }

      ctx.fillStyle = gradient;
      ctx.fillRect(target.x, target.y, target.w, target.h);
    });
  };
}
