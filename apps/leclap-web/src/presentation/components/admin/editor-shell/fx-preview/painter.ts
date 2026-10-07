// The shape every live effect preview takes, and the small Canvas2D helpers the painters share. A painter is
// prepared once per graphic (the engine plan is computed then, with the engine's seeded draws) and asked to
// draw at a section time on every animation frame. Coordinates are output pixels (the frame the engine
// renders); the layer scales the canvas to the on-screen frame.

/** A rectangle in output px, with an optional corner radius. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  radius?: number;
}

/** A DOM layer for effects built from the picture under them (frost, defocus, halation): CSS backdrop filters. */
export interface SurfaceLayer {
  box: Box;
  /** Backdrop blur σ in output px (the layer converts it to CSS px). */
  blur: number;
  saturate?: number;
  brightness?: number;
  contrast?: number;
  /** Tint laid over the filtered picture (CSS colour). */
  tint?: string;
  /** A flat veil under the tint that darkens or lifts the picture (CSS colour with alpha). */
  shade?: string;
  /** Top-edge highlight alpha (a lit rim). */
  rim?: number;
  /** Blend with the picture (bloom adds light). */
  blend?: 'screen';
  opacity: number;
}

export interface FxPainter {
  /** Section-time span the canvas loops over when no playhead drives it. */
  span: [number, number];
  /** The target the effect lives on, outlined on the edit canvas; null when it fills the frame. */
  outline: Box | null;
  /** Canvas drawing in output px at section time `t`. */
  paint?: (ctx: CanvasRenderingContext2D, t: number) => void;
  /** The DOM surface at section time `t`, or null while it is not shown. */
  surface?: (t: number) => SurfaceLayer | null;
  /** True when this mode draws nothing (reduced motion drops ambient textures). */
  absent?: boolean;
}

/** A "#rrggbb" or "#rgb" colour with an alpha, as a CSS rgba(); anything else reads as white. */
export function rgba(color: string, alpha: number): string {
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(color);
  const hex = short
    ? short
        .slice(1)
        .map((c) => c + c)
        .join('')
    : (/^#?([0-9a-f]{6})/i.exec(color)?.[1] ?? 'ffffff');
  const [r, g, b] = [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16));

  return `rgba(${r}, ${g}, ${b}, ${Math.round(Math.min(1, Math.max(0, alpha)) * 1000) / 1000})`;
}

/** An [r, g, b] (0..255) colour as "#rrggbb". */
export function hexOf(rgb: readonly number[]): string {
  return `#${rgb
    .map((c) =>
      Math.round(Math.min(255, Math.max(0, c)))
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`;
}

/** Traces `box` (rounded when it has a radius) as the current path. */
export function boxPath(ctx: CanvasRenderingContext2D, box: Box): void {
  ctx.beginPath();
  ctx.roundRect(box.x, box.y, box.w, box.h, box.radius ?? 0);
}

/** Runs `draw` clipped to `box`, the way the engine's fx kit clips a light to its target. */
export function clipped(ctx: CanvasRenderingContext2D, box: Box, draw: () => void): void {
  ctx.save();
  boxPath(ctx, box);
  ctx.clip();
  draw();
  ctx.restore();
}

/** Canvas px per output px under the current transform (shadow blurs are not transformed). */
export function pixelScale(ctx: CanvasRenderingContext2D): number {
  return ctx.getTransform().a || 1;
}
