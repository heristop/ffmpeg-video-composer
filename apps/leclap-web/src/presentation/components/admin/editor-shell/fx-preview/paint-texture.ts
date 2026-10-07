// Live previews of the ambient textures (bokeh discs and dust motes, from the engine's own particle fields;
// film grain) and of the primitives built from the picture itself (glass frost, resolve defocus, bloom
// halation), which the browser approximates with CSS backdrop filters on a DOM surface over the target.
import type { FxContext } from 'ffmpeg-video-composer/src/editor/presets/fx-kit.ts';
import { bokehField, dustField, type ParticleField } from 'ffmpeg-video-composer/src/editor/presets/fx-particles.ts';
import { glassLook } from 'ffmpeg-video-composer/src/editor/presets/fx-glass.ts';
import { lookOf } from 'ffmpeg-video-composer/src/editor/presets/fx-resolve.ts';
import { bloomOf } from 'ffmpeg-video-composer/src/editor/presets/fx-bloom.ts';
import { seededRandom } from 'ffmpeg-video-composer/src/core/determinism/hash.ts';
import { parseEasing } from 'ffmpeg-video-composer/src/core/motion/easing.ts';
import { ambientEnvelope, clamp01, inWindow, rampIn, rampOut } from './fx-time';
import { clipped, hexOf, type SurfaceLayer } from './painter';
import { drawSprite } from './sprite-cache';

type Paint = (ctx: CanvasRenderingContext2D, t: number) => void;
type Surface = (t: number) => SurfaceLayer | null;

/** A particle's centre (target px) at section time `t`: drift plus a sway across it. */
export function particleAt(fx: { at: number }, p: ParticleField['particles'][number], t: number): [number, number] {
  const since = t - fx.at;
  const wave = Math.sin(p.omega * since + p.phase);

  return [p.x + p.vx * since + p.sx * wave, p.y + p.vy * since + p.sy * wave];
}

function paintField(fx: FxContext<'bokeh'> | FxContext<'dust'>, field: ParticleField): Paint {
  return (ctx, t) => {
    if (!inWindow(fx, t)) return;

    clipped(ctx, fx.target, () => {
      for (const p of field.particles) {
        if (t < p.from || t > p.to) continue;

        const [x, y] = particleAt(fx, p, t);
        const alpha = p.alpha * rampIn(t, p.from, p.ramp) * rampOut(t, p.to - p.ramp, p.ramp);
        drawSprite(ctx, field.tiers[p.tier], { cx: fx.target.x + x, cy: fx.target.y + y, scale: 1, alpha });
      }
    });
  };
}

export function paintBokeh(fx: FxContext<'bokeh'>): Paint {
  return paintField(fx, bokehField(fx));
}

export function paintDust(fx: FxContext<'dust'>): Paint {
  return paintField(fx, dustField(fx));
}

const GRAIN_TILE = 160;

function grainTile(seed: number, frame: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = [GRAIN_TILE, GRAIN_TILE];
  const context = canvas.getContext('2d');

  if (!context) return canvas;

  const image = context.createImageData(GRAIN_TILE, GRAIN_TILE);
  const random = seededRandom(seed + frame * 7919);

  for (let i = 0; i < image.data.length; i += 4) {
    const v = Math.round(random() * 255);
    image.data.set([v, v, v, 255], i);
  }

  context.putImageData(image, 0, 0);

  return canvas;
}

export function paintGrain(fx: FxContext<'grain'>): Paint {
  const animated = fx.graphic.animated !== false;
  const size = Math.max(1, fx.graphic.size ?? 1);
  const tiles = Array.from({ length: animated ? 6 : 1 }, (_, i) => grainTile(fx.seed, i));

  return (ctx, t) => {
    if (!inWindow(fx, t)) return;

    const tile = tiles[animated ? Math.floor(t * fx.frame.fps) % tiles.length : 0];
    const pattern = ctx.createPattern(tile, 'repeat');

    if (!pattern) return;

    pattern.setTransform(new DOMMatrix().scale(size / 2));
    clipped(ctx, fx.target, () => {
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = Math.min(1, fx.peak * 3) * ambientEnvelope(fx, t, fx.graphic.ramp ?? 0.3);
      ctx.fillStyle = pattern;
      ctx.fillRect(fx.target.x, fx.target.y, fx.target.w, fx.target.h);
    });
  };
}

/** The glass surface: frosted, desaturated, toned toward its tint, with a lit top rim; it frosts in and out. */
export function glassSurface(fx: FxContext<'glass'>): Surface {
  const look = glassLook(fx);
  const tint = hexOf(look.tint.map((c) => c * 255));

  return (t) =>
    inWindow(fx, t)
      ? {
          box: fx.target,
          blur: look.frost,
          saturate: look.saturation,
          // The engine squeezes the picture's luma into a band (dark glass tops out at 0.40, light glass
          // bottoms out at 0.66, GLASS_LUMA) so text on it stays legible: a black veil scales it down to
          // 0.38, a white one lifts it to 0.6 and up.
          shade: look.tone === 'dark' ? 'rgba(0, 0, 0, 0.62)' : 'rgba(255, 255, 255, 0.6)',
          tint: `color-mix(in srgb, ${tint} ${Math.round(look.mix * 100)}%, transparent)`,
          rim: look.rim,
          opacity: rampIn(t, fx.at, look.ramp) * rampOut(t, fx.end - look.ramp, look.ramp),
        }
      : null;
}

/** Resolve: the target held as a soft glow, then settling into focus on the effect's curve from `at`. */
export function resolveSurface(fx: FxContext<'resolve'>): Surface {
  const look = lookOf(fx, Math.min(fx.target.w, fx.target.h));
  const curve = parseEasing(fx.ease).fn;

  return (t) => {
    if (t > fx.end) return null;

    const settle = curve(clamp01((t - fx.at) / fx.duration));
    const focus = rampIn(t, fx.at, look.fade);
    const blur = look.glow * (1 - focus) + look.blur * (1 - settle) * focus;

    return blur < 0.25 ? null : { box: fx.target, blur, opacity: 1 };
  };
}

/** Bloom: the bright parts of the picture spread into a soft halation, added over it. */
export function bloomSurface(fx: FxContext<'bloom'>): Surface {
  const bloom = bloomOf(fx);
  const threshold = (bloom.low + bloom.high) / 2 / 255;

  return (t) =>
    inWindow(fx, t)
      ? {
          box: fx.target,
          blur: bloom.sigma * 2,
          brightness: 1 - threshold * 0.5,
          contrast: 1 + threshold * 2.5,
          tint: `color-mix(in srgb, ${bloom.color} 18%, transparent)`,
          blend: 'screen',
          opacity: Math.min(1, fx.peak * 5) * ambientEnvelope(fx, t, fx.graphic.ramp ?? 0.6),
        }
      : null;
}
