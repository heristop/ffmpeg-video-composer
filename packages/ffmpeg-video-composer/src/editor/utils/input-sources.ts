import { assertSafeArgToken } from '@/core/arg-guard';
import type { RevealEasing } from '../presets/text';
import { easedRamp, phaseDuration } from '../presets/eased-ramp';
import type { BackgroundLayer } from '../../schemas/template.schemas';
import type { GlobalAnimation } from '@/core/types';

// Pure builders for the `-i` source fragments of composited inputs (animations and gradient layers).
// They return fully-formed fragment strings (already containing `-i`, plus any `-framerate` /
// `-stream_loop` / `-c:v` flags) so SegmentBuilder can push them verbatim into the sources list.
// The path/pattern token is guarded; the surrounding flags are literals built here.

/** Playback bounds for an animation overlay — see buildLoopFlags. */
type LoopOptions = { loop?: boolean; loops?: number; duration?: number; start?: number };

/**
 * Input-option flags (before `-i`) that bound WHEN and HOW LONG an animation overlay plays.
 * `start` delays the overlay via `-itsoffset` (it shows from that second on); the extent precedence is
 * `duration` > `loops` > `loop`:
 *   - duration D: `-stream_loop -1 -t D` (loop the source, then cut at D seconds).
 *   - loops N (finite): `-stream_loop {N-1}` (play N times); when a `maxDuration` ceiling is given
 *     (the whole-video pass passes the base-video length), add `-t <ceiling>` so an over-long looped
 *     overlay can't lengthen the output. N <= 1 plays once (no flag).
 *   - loop true (legacy): `-stream_loop -1` (infinite; the caller bounds it with overlay `shortest=1`).
 *   - none: play once (no flag).
 */
export function buildLoopFlags(options: LoopOptions, maxDuration?: number): string {
  const offset = options.start && options.start > 0 ? `-itsoffset ${options.start} ` : '';

  if (options.duration !== undefined) return `-stream_loop -1 ${offset}-t ${options.duration} `;

  if (options.loops !== undefined) {
    const repeat = options.loops > 1 ? `-stream_loop ${options.loops - 1} ` : '';
    const ceiling = maxDuration === undefined ? '' : `-t ${maxDuration} `;

    return `${repeat}${offset}${ceiling}`;
  }

  return options.loop ? `-stream_loop -1 ${offset}` : offset;
}

// Single-file formats FFmpeg decodes as a LIVE/animated stream — mirrors the gate
// SegmentBuilder.resolveAnimationSource already uses for the section path, so both paths agree on
// what counts as "animated". `.webp` CAN be a still image, but the whole-video path has always
// stream-looped it (there is no `type` discriminator on GlobalAnimation to disambiguate, unlike the
// section input's `type: 'image' | 'animation'`); keeping it here preserves that existing behavior
// instead of silently reinterpreting an already-working `.webp` overlay as a still.
const ANIMATED_EXTENSIONS = /\.(apng|webp|gif|webm)$/i;

// Still-raster formats a global animation overlay can name: anything that looks like a plain image
// and is NOT already claimed by ANIMATED_EXTENSIONS above (so `.webp` never matches here).
const STILL_IMAGE_EXTENSIONS = /\.(png|jpe?g)$/i;

/**
 * True when a `global.animations[].url` names a still raster image (`.png`/`.jpg`/`.jpeg`) rather than
 * an animated single-file format. Used by AnimationComposer to route the overlay to the `-loop 1`
 * still-image source (buildSingleFileImageSource) instead of the stream-looped animation source —
 * without this, a still decodes as ONE frame and vanishes (or freezes only incidentally via
 * `persistent: true`'s `eof_action=repeat`).
 *
 * This is a fallback HEURISTIC for untyped `global.animations` entries only — see `isStillAnimation`
 * below, which prefers an explicit `still` flag when the caller (a watermark) already knows the answer.
 */
export function isStillAnimationUrl(url: string): boolean {
  return !ANIMATED_EXTENSIONS.test(url) && STILL_IMAGE_EXTENSIONS.test(url);
}

/**
 * `GlobalAnimation` augmented with an internal `still` flag, produced in-process by
 * `watermarkToAnimation` (editor/presets/watermark.ts) — a watermark KNOWS it is a still image, so it
 * sets this explicitly rather than leaving AnimationComposer to sniff it from a url. Deliberately NOT
 * part of the public `GlobalAnimationSchema`: an authored `global.animations` entry has no such flag
 * (there is no `type: 'image' | 'animation'` discriminator on that schema, unlike a section input), so
 * widening the public schema would only invite authors to hand-author a flag that means nothing to them
 * — the internal-only augmentation keeps it purely a compiler-side optimization.
 */
export type InternalAnimation = GlobalAnimation & { still?: boolean };

/**
 * True when a staged whole-video overlay should be treated as a still image. Prefers `anim.still` when
 * the caller set it explicitly (watermarkToAnimation always does); otherwise falls back to sniffing the
 * STAGED path — the real, locally-resolved file (post `{{ var }}` substitution and download/copy) —
 * rather than the raw `anim.url`, so a `{{ var }}`-url plain animation is classified by its real
 * extension instead of always missing the still regex.
 */
export function isStillAnimation(anim: { still?: boolean }, path: string): boolean {
  return anim.still ?? isStillAnimationUrl(path);
}

/**
 * Single-file animation source (`.apng`/`.webp`/`.gif`/`.webm`): `[-c:v libvpx-vp9] [loop flags] -i <path>`.
 * `.webm` gets `-c:v libvpx-vp9` BEFORE everything so its alpha channel decodes. The loop/duration
 * flags come from buildLoopFlags; `maxDuration` is the optional whole-video ceiling for finite loops.
 * Still images (isStillAnimationUrl) never reach this function — AnimationComposer routes them to
 * buildSingleFileImageSource instead.
 */
export function buildSingleFileAnimationSource(
  input: { url: string; options: LoopOptions },
  path: string,
  opts?: { maxDuration?: number }
): string {
  const codec = /\.webm$/i.test(input.url) ? '-c:v libvpx-vp9 ' : '';
  const flags = buildLoopFlags(input.options, opts?.maxDuration);

  return `${codec}${flags}-i ${assertSafeArgToken(path, 'animation source')}`;
}

/** How an overlay maps into its "w:h" scale box (see buildAnimationLegFilters). */
export type OverlayFit = 'stretch' | 'contain' | 'cover';

/** Mirror applied to the overlay leg before rotation (see buildAnimationLegFilters). */
export type OverlayFlip = 'horizontal' | 'vertical' | 'both';

// flip → the hflip/vflip leg filters ('both' = hflip then vflip). The same core LGPL filters the
// section motion flip emits (presets/looks.ts), so on-device (--disable-gpl) parity is proven.
function flipLegFilters(flip: OverlayFlip | undefined): string[] {
  if (!flip) return [];

  if (flip === 'horizontal') return ['hflip'];

  if (flip === 'vertical') return ['vflip'];

  return ['hflip', 'vflip'];
}

// fit only has meaning against a fixed pixel box: both scale components must be plain positive
// integers. The "w:-1" keep-aspect trick and expression scales fall back to the free scale, since
// pad/crop against a -1 or expression dimension would be invalid or meaningless.
function fitBoxFrom(scale: string | undefined, fit: OverlayFit | undefined): string | undefined {
  if (!fit || fit === 'stretch' || !scale) return undefined;

  const parts = scale.split(':');

  if (parts.length !== 2) return undefined;

  if (!parts.every((part) => /^\d+$/.test(part.trim()) && Number(part) > 0)) return undefined;

  return scale;
}

/**
 * Filters applied to an animation leg before it is overlaid: scale it to its declared size (so `scale`
 * sizes the animation itself, not the already-composited frame), rotate it clockwise when `rotation` is
 * a nonzero angle, then fade it via colorchannelmixer when opacity < 1 (the same alpha-multiply the
 * gradient layer uses). Shared by the per-section overlay (MapManager.addAnimationOverlay) and the
 * whole-video pass (AnimationComposer) so both stay identical.
 *
 * `fit` keeps the source aspect inside the "w:h" box instead of free-stretching it:
 *   - contain: scale down to fit, then pad back up to the box with a TRANSPARENT letterbox
 *     (pad needs an rgba frame first or the bars come out black).
 *   - cover: scale up to fill, then centre-crop the overflow to the box.
 * scale, pad and crop are all core LGPL filters, so the on-device (--disable-gpl) build keeps parity.
 *
 * `flip` mirrors the overlay itself (hflip/vflip — core LGPL, same filters the section motion flip
 * emits) BEFORE the rotate, so a mirrored sticker still rotates around its own visual centre. Because
 * it runs on the overlay leg, only the overlay mirrors — the per-input `filters` array can't do this,
 * as MapManager chains those AFTER the overlay and would flip the whole composited frame.
 *
 * Chain order: scale/fit → flip → rotate → fade. The `rotate` runs on an `format=rgba` frame with
 * `c=none` so the corners the rotation exposes stay transparent (no black box around a rotated
 * PNG/APNG), and `ow=rotw(…)/oh=roth(…)` grow the output frame to the rotated bounds so it is never
 * clipped.
 */
// scale/fit leg filters: a `contain` fit scales down then pads back up with a transparent letterbox,
// a `cover` fit scales up then centre-crops, and a plain `scale` (no valid fit box) free-stretches.
// fitBoxFrom returns a box only for contain/cover with an integer "w:h" scale, so a truthy box always
// pairs with one of those two fits.
function fitLegFilters(scale: string | undefined, fit: OverlayFit | undefined): string[] {
  const fitBox = fitBoxFrom(scale, fit);

  if (fitBox && fit === 'contain') {
    return [
      `scale=${fitBox}:force_original_aspect_ratio=decrease`,
      'format=rgba',
      `pad=${fitBox}:(ow-iw)/2:(oh-ih)/2:color=black@0`,
      'setsar=1',
    ];
  }

  if (fitBox && fit === 'cover') {
    return [`scale=${fitBox}:force_original_aspect_ratio=increase`, `crop=${fitBox}`, 'setsar=1'];
  }

  if (!fitBox && scale) return [`scale=${scale}`, 'setsar=1'];

  return [];
}

export function buildAnimationLegFilters(options: {
  scale?: string;
  fit?: OverlayFit;
  flip?: OverlayFlip;
  rotation?: number;
  opacity?: number;
}): string[] {
  const opacity = options.opacity ?? 1;
  const rotation = options.rotation ?? 0;
  const legFilters: string[] = [];

  legFilters.push(...fitLegFilters(options.scale, options.fit));

  legFilters.push(...flipLegFilters(options.flip));

  // rotate's `c=none` and the alpha multiply both need an alpha channel; convert to rgba once and
  // reuse it for whichever steps follow so the chain never re-formats the same frame. A contain fit
  // already left the frame rgba (for its transparent pad), so it never re-formats either.
  const hasAlpha = legFilters.includes('format=rgba');
  const needsAlpha = rotation !== 0 || opacity < 1;

  if (needsAlpha && !hasAlpha) legFilters.push('format=rgba');

  if (rotation !== 0) {
    const angle = `${rotation}*PI/180`;

    legFilters.push(`rotate=a=${angle}:ow=rotw(${angle}):oh=roth(${angle}):c=none`);
  }

  if (opacity < 1) legFilters.push(`colorchannelmixer=aa=${opacity}`);

  return legFilters;
}

// ---------------------------------------------------------------------------
// overlay motion — an animated entrance for a composited overlay
// ---------------------------------------------------------------------------
//
// Reuses the `reveal` vocabulary (rise / slide / fade) but emits OVERLAY-filter coordinates (W,H,w,h,t)
// — NOT the drawtext text_w coords `revealToExpr` produces. slide/rise become `overlay` x/y time
// expressions easing from an offset back to the base position; fade reuses an alpha fade-in on the
// overlay leg (the opacity path) instead of moving the overlay. `easing` curves the rise/slide ramp
// (shared easeRampExpr — pure expression math, LGPL-safe); a fade motion IGNORES it, because the fade
// FILTER only ramps linearly.

type OverlayMotionInput =
  | string
  | { type: string; delay?: number; duration?: number; distance?: number; easing?: RevealEasing };

export type OverlayMotion = {
  /** Overlay x expression (already incorporates the base x); paired with `y` for slide/rise. */
  x?: string;
  /** Overlay y expression (already incorporates the base y). */
  y?: string;
  /** A leg filter (alpha fade-in) for the `fade` motion, applied to the overlay source before compositing. */
  legFilter?: string;
};

const MOTION_DELAY = 0.3;
const MOTION_DURATION = 0.6;
const MOTION_DISTANCE = 60;

function trimNum(value: number): string {
  return Number(value.toFixed(4)).toString();
}

/**
 * Translates an overlay `motion` intent into overlay-filter expressions, given the static `position`
 * ("x:y"). Returns {} for no/none motion (the overlay sits at its static position).
 */
export function overlayMotionExpr(motion: OverlayMotionInput | undefined, position: string): OverlayMotion {
  if (!motion) {
    return {};
  }

  const intent = typeof motion === 'string' ? { type: motion } : motion;

  if (intent.type === 'none') {
    return {};
  }

  const delay = intent.delay ?? MOTION_DELAY;
  const duration = phaseDuration(intent.duration, intent.easing, MOTION_DURATION);
  const distance = intent.distance ?? MOTION_DISTANCE;
  const [bx = '0', by = '0'] = position.split(':');
  const ramp = easedRamp(delay, duration, intent.easing);

  if (intent.type === 'fade') {
    return { legFilter: `fade=t=in:st=${trimNum(delay)}:d=${trimNum(duration)}:alpha=1` };
  }

  if (intent.type === 'rise') {
    return { x: bx, y: `(${by})+(1-(${ramp}))*${distance}` };
  }

  if (intent.type === 'slide-left') {
    return { x: `(${bx})+(1-(${ramp}))*${distance}`, y: by };
  }

  // slide-right enters from the left.
  return { x: `(${bx})-(1-(${ramp}))*${distance}`, y: by };
}

/**
 * Still-image overlay source (`.jpg`/`.png`/`.webp`): `-loop 1 -i <path>` — the image2 demuxer holds
 * the single frame as a stream so it composites over the section for its whole duration (bounded by
 * the main video via `-shortest`), the same way an animation's `-stream_loop -1` holds it. Shared by
 * the per-section overlay (SegmentBuilder.resolveAnimationSource) and the whole-video pass
 * (AnimationComposer.buildOverlaySources, gated by isStillAnimationUrl) — both hold a still identically,
 * only the enable-gate's `t` semantics differ (see imageOverlayEnable).
 */
export function buildSingleFileImageSource(path: string): string {
  return `-loop 1 -i ${assertSafeArgToken(path, 'image source')}`;
}

/**
 * Timeline gate for a STILL-IMAGE overlay's start/duration: the `:enable=…` suffix appended to the
 * overlay filter's option string. Images are held with a bare `-loop 1` source (buildSingleFileImageSource
 * ignores the `-itsoffset`/`-t` flags animations use), so their show window lowers to the overlay
 * filter's timeline support instead — core LGPL, no extra filter:
 *   - start S + duration D → `:enable='between(t,S,S+D)'`
 *   - duration D only      → `:enable='between(t,0,D)'`
 *   - start S only         → `:enable='gte(t,S)'` (visible until the section/video ends)
 *   - neither              → '' (the image spans the whole window, unchanged behavior)
 * `t` is the section-relative timestamp for the per-section path (each section compiles as its own
 * segment starting at 0); AnimationComposer reuses the exact same expression for its whole-video
 * still overlays, where `t` is instead the VIDEO-GLOBAL timestamp (the post-concat pass runs once
 * over the whole joined output) — the formula is agnostic to what `t` means, only the caller's
 * `start`/`duration` values (already in the right timebase) differ.
 */
export function imageOverlayEnable(options: { start?: number; duration?: number }): string {
  const start = options.start ?? 0;

  if (options.duration !== undefined) {
    return `:enable='between(t,${trimNum(start)},${trimNum(start + options.duration)})'`;
  }

  if (start > 0) {
    return `:enable='gte(t,${trimNum(start)})'`;
  }

  return '';
}

/** A background layer's box lowered to concrete output pixels. */
export type ResolvedLayerGeometry = { x: number; y: number; w: number; h: number };

// The builder UI authors layer geometry as `iw*<fraction>` / `ih*<fraction>` expressions
// (see the web app's layerGeometry helpers); this recognises exactly that shape.
const LAYER_FRACTION_EXPR = /^(iw|ih)\s*\*\s*(\d*\.?\d+)$/;

function parseScaleDim(token: string | undefined, fallback: number): number {
  const value = Number(token);

  // Keep-aspect (-1/-2) or expression components can't size a raster box; fall back.
  if (!Number.isFinite(value) || value <= 0) return fallback;

  return value;
}

function resolveGeometryValue(
  value: number | string | undefined,
  frameW: number,
  frameH: number,
  fallback: number
): number {
  if (value === undefined) return fallback;

  if (typeof value === 'number') return Math.round(value);

  const match = LAYER_FRACTION_EXPR.exec(value.trim());

  // Free-form FFmpeg expressions can't be evaluated statically; fall back rather than emit a
  // token the gradients `s=` option (which needs plain WxH pixels) would reject.
  if (!match) return fallback;

  const basis = match[1] === 'iw' ? frameW : frameH;

  return Math.round(basis * Number(match[2]));
}

/**
 * Lowers a background layer's x/y/w/h (pixels or `iw*f`/`ih*f` fraction expressions) to concrete
 * pixels against the project scale ("W:H"). Needed because the lavfi `gradients` source is sized
 * with a literal `s=WxH` and the overlay filter has no iw/ih variables — raw layer expressions
 * would either be rejected or mis-evaluated at run time. Unresolvable values fall back to the
 * legacy behaviour: full-frame w/h, origin x/y.
 */
export function resolveLayerGeometry(
  layer: Pick<BackgroundLayer, 'x' | 'y' | 'w' | 'h'>,
  scale: string
): ResolvedLayerGeometry {
  const [wToken, hToken] = scale.split(':');
  const frameW = parseScaleDim(wToken, 1280);
  const frameH = parseScaleDim(hToken, 720);

  return {
    x: resolveGeometryValue(layer.x, frameW, frameH, 0),
    y: resolveGeometryValue(layer.y, frameW, frameH, 0),
    // A raster source can't be 0-sized; clamp to 1px so a degenerate box stays renderable.
    w: Math.max(1, resolveGeometryValue(layer.w, frameW, frameH, frameW)),
    h: Math.max(1, resolveGeometryValue(layer.h, frameW, frameH, frameH)),
  };
}

// %R / %B stand for the box's last column / row (w-1, h-1), never w/h: the gradients source swaps any
// point outside [0, w-1]×[0, h-1] for a random one drawn from its seed, so an end point ON the far edge
// renders a different sweep length on every run.
const GRADIENT_DIRECTION_COORDS: Record<string, string> = {
  // gradients defaults to a top→bottom (vertical) sweep; we set the end coords explicitly per direction.
  horizontal: 'x0=0:y0=0:x1=%R:y1=0',
  vertical: 'x0=0:y0=0:x1=0:y1=%B',
  diagonal: 'x0=0:y0=0:x1=%R:y1=%B',
};

/** Rounds a coordinate into the gradients source's accepted range, [0, size-1]. */
function insideBox(value: number, size: number): number {
  return Math.min(Math.max(Math.round(value), 0), size - 1);
}

/**
 * lavfi gradients source for a gradient background layer:
 * `-f lavfi -i gradients=s=<WxH>:c0=<from>:c1=<to>:d=<duration>:<direction coords>`.
 * Colors are guarded; W/H come from the (already validated) scale; duration is numeric.
 * `gradients` is an LGPL lavfi source, but the on-device build only ships explicitly enabled
 * filters — it must stay in FF_COMMON's --enable-filter list (scripts/ffmpeg/common.sh, guarded
 * by tests/engine-filter-config.test.ts) or gradient layers fail on device only.
 */
export function buildGradientSource(layer: BackgroundLayer, scale: string, duration: number): string {
  const gradient = layer.gradient;

  if (!gradient) {
    throw new Error('buildGradientSource called on a layer without a gradient');
  }

  // Size the source to the LAYER's box (w/h resolved against the scale), not the full frame —
  // otherwise a 50%-wide gradient layer renders full-frame and its geometry fields do nothing.
  const { w, h } = resolveLayerGeometry(layer, scale);
  const size = `${w}x${h}`;
  const coords = gradientCoords(gradient.shape, gradient.direction, gradient.angle, w, h);

  const from = assertSafeArgToken(gradient.from, 'gradient from');
  const to = assertSafeArgToken(gradient.to, 'gradient to');
  // Only emit `type=` when the descriptor sets a shape, so older descriptors keep byte-identical
  // commands; a frozen `speed` is ALWAYS explicit — the source's default 0.01 slowly rotates the
  // gradient over the section, an unexposed side effect a background layer must not have. The value
  // is the option's minimum (0.00001, imperceptible), not 0: older FFmpeg builds — including the
  // ffmpeg.wasm core — enforce the minimum and abort on 0 ("Error setting option speed to value 0").
  const type = gradient.shape ? `:type=${gradient.shape}` : '';

  return `-f lavfi -i gradients=s=${size}:c0=${from}:c1=${to}:d=${duration}:${coords}:speed=0.00001${type}`;
}

// linear sweeps between two points along a direction; radial/circular/spiral radiate from the
// (x0,y0) origin, so they get a centred origin with (x1,y1) at the far corner pixel (w-1, h-1;
// radial reach ≈ half-diagonal, filling the whole box) — the direction coords would pin them to the
// top-left. A free `angle` (degrees) wins over the direction enum, unlocking the reverse and diagonal
// sweeps the three fixed directions can't express; the enum stays as sugar for old descriptors.
function gradientCoords(
  shape: string | undefined,
  direction: string | undefined,
  angle: number | undefined,
  w: number,
  h: number
): string {
  if (shape && shape !== 'linear') {
    return `x0=${insideBox(w / 2, w)}:y0=${insideBox(h / 2, h)}:x1=${w - 1}:y1=${h - 1}`;
  }

  if (angle !== undefined) return angleCoords(angle, w, h);

  const sweep = GRADIENT_DIRECTION_COORDS[direction ?? 'vertical'] ?? GRADIENT_DIRECTION_COORDS.vertical;

  return sweep.replace('%R', String(w - 1)).replace('%B', String(h - 1));
}

// Lowers a CSS-convention angle (0=bottom→top, 90=left→right, clockwise) to gradients sweep
// endpoints: a ray through the box centre, cut where it exits the box — the gradients source
// re-randomises coordinates outside the box, so the endpoints must stay within [0,w-1]×[0,h-1].
function angleCoords(angleDeg: number, w: number, h: number): string {
  const theta = (((angleDeg % 360) + 360) % 360) * (Math.PI / 180);
  // CSS angles run clockwise from "up"; screen y grows downward, hence dy = -cos.
  const dx = Math.sin(theta);
  const dy = -Math.cos(theta);
  const tx = Math.abs(dx) < 1e-9 ? Infinity : w / 2 / Math.abs(dx);
  const ty = Math.abs(dy) < 1e-9 ? Infinity : h / 2 / Math.abs(dy);
  const reach = Math.min(tx, ty);

  const x0 = insideBox(w / 2 - dx * reach, w);
  const y0 = insideBox(h / 2 - dy * reach, h);
  const x1 = insideBox(w / 2 + dx * reach, w);
  const y1 = insideBox(h / 2 + dy * reach, h);

  return `x0=${x0}:y0=${y0}:x1=${x1}:y1=${y1}`;
}
