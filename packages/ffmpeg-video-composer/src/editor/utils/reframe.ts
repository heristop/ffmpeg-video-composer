// Reframing: how a section's source maps into the output frame (options.fit / fill / focus, with the
// legacy forceAspectRatio / forceOriginalAspectRatio flags as the fallback). Lowered to plain scale / crop
// / pad, and for the blur fit a split → (cover scale, gblur, lutyuv dim) + (contain scale) → overlay
// subgraph — every filter on the on-device allowlist. Without fit/focus the output is byte-identical to
// the historical cover / letterbox chains.

import type { Filter, SectionOptions } from '@/core/types';
import { fmt } from '@/core/motion/hermite';
import { trackExpr, type TrackKey } from '@/core/motion/tracks';
import type { FitFill, Focus, FootageFit } from '../../schemas/footage.schemas';

const ANCHORS: Record<Exclude<Extract<Focus, string>, 'center'>, { x: number; y: number }> = {
  left: { x: 0, y: 0.5 },
  right: { x: 1, y: 0.5 },
  top: { x: 0.5, y: 0 },
  bottom: { x: 0.5, y: 1 },
};

const DEFAULT_FILL = { blur: 20, dim: 0.15, zoom: 1 };

export interface ReframeContext {
  /** Output "W:H" (may be empty: no conform scale is emitted then, as before). */
  scale: string;
  setsar: string | undefined;
  fps: number;
}

/** The effective fit: options.fit, else the legacy aspect flags (letterbox wins, then off, else cover). */
export function resolveFit(options: SectionOptions | undefined): FootageFit {
  if (options?.fit) return options.fit;

  if (options?.forceOriginalAspectRatio) return 'letterbox';

  return options?.forceAspectRatio === false ? 'off' : 'cover';
}

function axis(fraction: number, free: string): string {
  return fraction === 0 ? '0' : `(${free})*${fmt(fraction)}`;
}

function focusTrack(keys: Extract<Focus, unknown[]>, pick: 'x' | 'y'): string {
  const track: TrackKey[] = keys.map((key) => ({ t: key.t, v: key[pick], ...(key.ease ? { ease: key.ease } : {}) }));

  return trackExpr(track, 0, 't');
}

/** crop arguments anchoring a cover crop: the bare "W:H" for the default centre (byte-identical). */
export function coverCrop(scale: string, focus: Focus | undefined): string {
  if (focus === undefined || focus === 'center') return scale;

  if (Array.isArray(focus)) {
    return `${scale}:x='(iw-ow)*(${focusTrack(focus, 'x')})':y='(ih-oh)*(${focusTrack(focus, 'y')})'`;
  }

  const point = typeof focus === 'string' ? ANCHORS[focus] : focus;

  return `${scale}:${axis(point.x, 'iw-ow')}:${axis(point.y, 'ih-oh')}`;
}

function even(value: number): number {
  return Math.round(value / 2) * 2;
}

/**
 * The blur fit as one subgraph: the whole picture (contain-scaled) over a cover-scaled, blurred and
 * dimmed copy of itself. Frames are conformed first and restamped after the overlay so the subgraph
 * neither drops the last frame nor drifts.
 */
export function blurFillGraph(scale: string, fill: FitFill | undefined, fps: number): string {
  const { blur, dim, zoom } = { ...DEFAULT_FILL, ...fill };
  const [width, height] = scale.split(':').map(Number);
  const backdrop = zoom === 1 ? scale : `${even(width * zoom)}:${even(height * zoom)}`;
  const dimmed = dim > 0 ? `,lutyuv=y=val*${fmt(1 - dim)}` : '';

  return (
    `2[fit_bg][fit_fg];` +
    `[fit_bg]scale=${backdrop}:force_original_aspect_ratio=increase,crop=${scale},gblur=sigma=${fmt(blur)}${dimmed}[fit_blur];` +
    `[fit_fg]scale=${scale}:force_original_aspect_ratio=decrease:force_divisible_by=2[fit_pic];` +
    `[fit_blur][fit_pic]overlay=(W-w)/2:(H-h)/2,setpts=N/(${fps}*TB)`
  );
}

function scaleFilter(fit: FootageFit, options: SectionOptions | undefined, ctx: ReframeContext): Filter {
  const scale = ctx.scale;

  if (fit === 'letterbox') {
    return { type: 'scale', value: `${scale}:force_original_aspect_ratio=decrease,pad=${scale}:(ow-iw)/2:(oh-ih)/2` };
  }

  return {
    type: 'scale',
    value: scale ? `${scale}:force_original_aspect_ratio=increase,crop=${coverCrop(scale, options?.focus)}` : scale,
  };
}

/** The reframing head of the section chain (setsar + scale), or none for fit "off". */
export function reframeFilters(options: SectionOptions | undefined, ctx: ReframeContext): Filter[] {
  const fit = resolveFit(options);

  if (fit === 'off') return [];

  const setsar: Filter = { type: 'setsar', value: ctx.setsar };

  if (fit === 'blur' && ctx.scale) {
    return [
      setsar,
      { type: 'fps', value: ctx.fps },
      { type: 'split', value: blurFillGraph(ctx.scale, options?.fill, ctx.fps) },
    ];
  }

  return [setsar, scaleFilter(fit, options, ctx)];
}
