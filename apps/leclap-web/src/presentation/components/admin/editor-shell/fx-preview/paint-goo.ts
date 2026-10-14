// Live preview of the goo primitive: the engine's own blob plan (the seeded choreography or the authored
// tracks), evaluated at the section time, then drawn the way the render builds it: each blob's gaussian
// falloff united (1 − Π(1 − aᵢ)) and cut at the threshold with a one-pixel ramp. The field is computed
// on a half-resolution grid over the blobs' bounding box and scaled up, so a frame costs a few hundred
// thousand exp() calls at most.
import type { FxContext } from 'ffmpeg-video-composer/src/editor/presets/fx-kit.ts';
import { blobsAt, gooPlan, type GooPlan } from 'ffmpeg-video-composer/src/editor/presets/fx-goo-plan.ts';
import { themeColors } from 'ffmpeg-video-composer/src/editor/presets/fx-marks.ts';
import { rgba } from './painter';

type Paint = (ctx: CanvasRenderingContext2D, t: number) => void;
type Blob = { cx: number; cy: number; r: number };

/** Grid step of the preview field, output px. */
const STEP = 2;

/**
 * The goo coverage (0..1) over a `w` × `h` grid of `step` px cells whose origin is (x0, y0) in target px:
 * the union of the blobs' gaussians, thresholded with a ~1 px ramp, as the render's lutyuv does.
 */
export function gooCoverage(
  blobs: Blob[],
  grid: { x0: number; y0: number; w: number; h: number; step: number },
  threshold: number
): Float32Array {
  const k2 = 2 * Math.log(1 / threshold);
  const live = blobs.filter((blob) => blob.r > 0.5).map((blob) => ({ ...blob, inv: k2 / (2 * blob.r * blob.r) }));
  const largest = Math.max(1, ...live.map((blob) => blob.r));
  // The union's slope at a lone blob's edge, per px: the ramp spans one px of it.
  const ramp = (threshold * k2) / largest;
  const out = new Float32Array(grid.w * grid.h);

  for (let j = 0; j < grid.h; j++) {
    const y = grid.y0 + (j + 0.5) * grid.step;

    for (let i = 0; i < grid.w; i++) {
      const x = grid.x0 + (i + 0.5) * grid.step;
      let miss = 1;

      for (const blob of live) miss *= 1 - Math.exp(-((x - blob.cx) ** 2 + (y - blob.cy) ** 2) * blob.inv);

      out[j * grid.w + i] = Math.min(1, Math.max(0, (1 - miss - threshold) / ramp + 0.5));
    }
  }

  return out;
}

function fillOf(fx: FxContext<'goo'>): string {
  if (fx.graphic.color) return fx.color;

  const accent = themeColors(fx, ['accent'])[0];

  return accent ? `#${accent}` : fx.color;
}

function boxOf(blobs: Blob[]): { x0: number; y0: number; x1: number; y1: number } {
  const reach = (blob: Blob) => blob.r * 1.6 + STEP;

  return {
    x0: Math.min(...blobs.map((blob) => blob.cx - reach(blob))),
    y0: Math.min(...blobs.map((blob) => blob.cy - reach(blob))),
    x1: Math.max(...blobs.map((blob) => blob.cx + reach(blob))),
    y1: Math.max(...blobs.map((blob) => blob.cy + reach(blob))),
  };
}

// The coverage as a white mask on a scratch canvas, `grid` cells wide.
function maskCanvas(coverage: Float32Array, grid: { w: number; h: number }): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = [grid.w, grid.h];
  const context = canvas.getContext('2d');
  const image = context?.createImageData(grid.w, grid.h);

  if (!context || !image) return null;

  for (let i = 0; i < coverage.length; i++) image.data.set([255, 255, 255, Math.round(255 * coverage[i])], i * 4);

  context.putImageData(image, 0, 0);

  return canvas;
}

// The mask filled with the colour (source-in), on its own scratch canvas.
function tinted(mask: HTMLCanvasElement, color: string): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = [mask.width, mask.height];
  const context = canvas.getContext('2d');

  if (!context) return null;

  context.drawImage(mask, 0, 0);
  context.globalCompositeOperation = 'source-in';
  context.fillStyle = color;
  context.fillRect(0, 0, canvas.width, canvas.height);

  return canvas;
}

function draw(ctx: CanvasRenderingContext2D, plan: GooPlan, fx: FxContext<'goo'>, t: number, color: string): void {
  const blobs = blobsAt(plan, t).filter((blob) => blob.r > 0.5);

  if (blobs.length === 0 || typeof document === 'undefined') return;

  const box = boxOf(blobs);
  const grid = {
    x0: box.x0,
    y0: box.y0,
    w: Math.ceil((box.x1 - box.x0) / STEP),
    h: Math.ceil((box.y1 - box.y0) / STEP),
    step: STEP,
  };
  const mask = maskCanvas(gooCoverage(blobs, grid, plan.threshold), grid);
  const fill = mask ? tinted(mask, rgba(color, fx.peak)) : null;

  if (!fill) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(fx.target.x, fx.target.y, fx.target.w, fx.target.h);
  ctx.clip();
  ctx.drawImage(fill, fx.target.x + grid.x0, fx.target.y + grid.y0, grid.w * STEP, grid.h * STEP);
  ctx.restore();
}

/** The goo painter: the plan is the render's, sampled at the section time. */
export function paintGoo(fx: FxContext<'goo'>): Paint {
  const plan = gooPlan(fx.graphic, fx.target, { ...fx, reduced: fx.reduced });
  const color = fillOf(fx);

  return (ctx, t) => {
    const fade = fx.reduced ? 1 - Math.abs((t - fx.at) / Math.max(1e-6, fx.end - fx.at) - 0.5) * 2 : 1;

    if (t < fx.at || t > fx.end || fade <= 0) return;

    ctx.save();
    ctx.globalAlpha = fade;
    draw(ctx, plan, fx, t, color);
    ctx.restore();
  };
}
