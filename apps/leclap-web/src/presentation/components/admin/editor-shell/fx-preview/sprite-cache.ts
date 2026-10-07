// The engine's compile-time sprites (rings, stars, bokeh discs, confetti pieces, glows, strokes), rasterised
// in the browser from the SAME analytic coverage functions the engine encodes to PNG (fx-sprite-shapes.ts),
// so a ring or a star on the canvas has the engine's exact profile. Rendered at most MAX_SIDE px on their
// long side (the canvas scales them up: every shape is soft or anti-aliased) and cached by spec.
import { spriteCoverage, type SpriteSpec } from 'ffmpeg-video-composer/src/editor/presets/fx-sprite-shapes.ts';

const MAX_SIDE = 320;
const CACHE_LIMIT = 64;
const cache = new Map<string, HTMLCanvasElement>();

function channels(color: string | undefined): [number, number, number] {
  const hex = /^([0-9a-f]{6})$/i.exec(color ?? '')?.[1] ?? 'ffffff';

  return [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16)) as [number, number, number];
}

function rasterise(spec: SpriteSpec): HTMLCanvasElement {
  const shrink = Math.min(1, MAX_SIDE / Math.max(spec.w, spec.h));
  const [w, h] = [Math.max(1, Math.round(spec.w * shrink)), Math.max(1, Math.round(spec.h * shrink))];
  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = [w, h];
  const context = canvas.getContext('2d');

  if (!context) return canvas;

  const image = context.createImageData(w, h);
  const coverage = spriteCoverage(spec);
  const [r, g, b] = channels(spec.color);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const at = 4 * (y * w + x);
      const alpha = coverage((x + 0.5) / shrink - spec.w / 2, (y + 0.5) / shrink - spec.h / 2);
      image.data.set([r, g, b, Math.round(255 * Math.min(1, Math.max(0, alpha)))], at);
    }
  }

  context.putImageData(image, 0, 0);

  return canvas;
}

/** The sprite as a canvas image (drawn at spec.w × spec.h output px by the caller). */
export function spriteImage(spec: SpriteSpec): HTMLCanvasElement {
  const key = JSON.stringify(spec);
  const hit = cache.get(key);

  if (hit) return hit;

  const image = rasterise(spec);

  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  cache.set(key, image);

  return image;
}

/** Draws `spec` centred on (cx, cy) at `scale` of its size, with `alpha` and an optional turn (radians). */
export function drawSprite(
  ctx: CanvasRenderingContext2D,
  spec: SpriteSpec,
  at: { cx: number; cy: number; scale: number; alpha: number; angle?: number; squash?: number }
): void {
  if (at.alpha <= 0.002 || at.scale <= 0) return;

  const [w, h] = [spec.w * at.scale, spec.h * at.scale];
  ctx.save();
  ctx.globalAlpha = Math.min(1, at.alpha);
  ctx.translate(at.cx, at.cy);
  // The engine turns the piece, then squashes the turned square horizontally (a flutter seen edge-on).
  ctx.scale(at.squash ?? 1, 1);

  if (at.angle) ctx.rotate(at.angle);
  ctx.drawImage(spriteImage(spec), -w / 2, -h / 2, w, h);
  ctx.restore();
}
