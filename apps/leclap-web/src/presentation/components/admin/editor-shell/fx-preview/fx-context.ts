// The live canvas preview's bridge to the engine: builds the SAME context the engine's fx dispatcher hands a
// primitive (editor/presets/fx.ts), from the builder's section and template settings, so the preview reuses
// the engine's own plan functions (band, rings, pieces, lobes…) and draws what the render will draw, with
// the same seeded context defaults. Only the drawing differs (Canvas2D instead of a filtergraph). Pure.
import type { Graphic } from 'ffmpeg-video-composer/src/schemas/graphics.schemas.ts';
import type { FxGraphic, FxTarget } from 'ffmpeg-video-composer/src/schemas/fx.schemas.ts';
import { FX_PRIMITIVES } from 'ffmpeg-video-composer/src/schemas/fx-primitives.schemas.ts';
import type { MotionTokens } from 'ffmpeg-video-composer/src/schemas/motion.schemas.ts';
import type { AnyFxContext } from 'ffmpeg-video-composer/src/editor/presets/fx-kit.ts';
import type { FxTargetRect } from 'ffmpeg-video-composer/src/editor/presets/fx-target.ts';
import { FX_PASS_REST } from 'ffmpeg-video-composer/src/editor/presets/fx-spec.ts';
import { defaultLightColor, WARM_WHITE } from 'ffmpeg-video-composer/src/editor/presets/fx-color.ts';
import { resolveLayerGeometry } from 'ffmpeg-video-composer/src/editor/utils/input-sources.ts';
import { deriveSeed, fnv1a32, seededRandom } from 'ffmpeg-video-composer/src/core/determinism/hash.ts';
import { resolveTheme } from 'ffmpeg-video-composer/src/core/theme/resolve.ts';
import type { ThemeSpec } from 'ffmpeg-video-composer/src/core/theme/themes.ts';
import { resolveEasingRef, resolveTokens } from 'ffmpeg-video-composer/src/core/motion/tokens.ts';
import { parseEasing, type EasingSpec } from 'ffmpeg-video-composer/src/core/motion/easing.ts';
import type { EditorSection, Orientation } from '../../templateEditorModel';
import { FRAME_SIZE } from '../../editor/animationOverlay';

/** The preview's frame rate: the engine snaps effect timing to the output grid (templates default to 30). */
export const PREVIEW_FPS = 30;

/** Everything the preview needs from the template around one effect. */
export interface PreviewEnv {
  orientation: Orientation;
  section: EditorSection;
  /** The section's position in the template (it names the section, and so seeds its effects). */
  sectionIndex: number;
  /** How long the section lasts (a stroke exits before its end). */
  sectionSeconds: number;
  /** global.theme, global.seed and global.motion (tokens and energy), as the template carries them. */
  theme?: unknown;
  globalSeed?: number;
  tokens?: MotionTokens;
  /** The viewer asks for reduced motion: draw the primitive's reduced form, as the engine does at energy 0. */
  reduced: boolean;
}

export interface Frame {
  width: number;
  height: number;
}

export function frameOf(orientation: Orientation): Frame {
  const { w, h } = FRAME_SIZE[orientation];

  return { width: w, height: h };
}

/** The descriptor name the builder gives a section (build-descriptor.ts): the effect seeds derive from it. */
export function sectionName(section: EditorSection, index: number): string {
  if (section.kind === 'video') return `${section.videoUrl ? 'clip' : 'video'}_${index}`;

  return `${section.kind}_${index}`;
}

/** A time field as seconds: time references ("beat:8", "end - 0.3") resolve only at compile time. */
export function seconds(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function layerBox(section: EditorSection, index: number, scale: string) {
  const layer = section.kind === 'color' ? section.layers?.[index] : undefined;

  return layer ? resolveLayerGeometry(layer, scale) : null;
}

function refBox(target: string, env: PreviewEnv, frame: Frame) {
  const ref = /^(pane|layer|text):(\d+)$/.exec(target);

  if (!ref) return null;

  if (ref[1] === 'layer') return layerBox(env.section, Number(ref[2]), `${frame.width}:${frame.height}`);

  // Panes and kinetic blocks are laid out at compile time: the preview shows them on the frame.
  return { x: 0, y: 0, w: frame.width, h: frame.height };
}

function rawBox(target: FxTarget | undefined, env: PreviewEnv, frame: Frame) {
  if (target === undefined || target === 'frame') return { x: 0, y: 0, w: frame.width, h: frame.height };

  if (typeof target === 'string') return refBox(target, env, frame);

  return resolveLayerGeometry(target, `${frame.width}:${frame.height}`);
}

/** The rectangle `target` names (the engine's fx-target rules for frame, layers and rectangles), clamped to the frame. */
export function previewTarget(target: FxTarget | undefined, env: PreviewEnv): FxTargetRect | null {
  const frame = frameOf(env.orientation);
  const raw = rawBox(target, env, frame);

  if (!raw) return null;

  const x = Math.max(0, raw.x);
  const y = Math.max(0, raw.y);
  const w = Math.min(frame.width, raw.x + raw.w) - x;
  const h = Math.min(frame.height, raw.y + raw.h) - y;

  if (w < 2 || h < 2) return null;

  const authored = typeof target === 'object' ? (target.radius ?? 0) : 0;
  const radius = Math.min(Math.round(authored), Math.floor(Math.min(w, h) / 2));

  return { x, y, w, h, radius, mask: radius > 0 ? 'rounded' : 'none' };
}

/** A colour with its theme token resolved (an @alpha suffix kept), as the compile path's colour mask does. */
export function themeColor(color: string, theme: unknown): string {
  const token = /^\$color\.([a-zA-Z0-9]+)(@[0-9.]+)?$/.exec(color);

  if (!token) return color;

  const colors = resolveTheme(theme as ThemeSpec | undefined)?.colors as Record<string, string> | undefined;
  const hex = colors?.[token[1]];

  return hex ? `${hex.split('@')[0]}${token.at(2) ?? ''}` : color;
}

/** A colour as the engine draws it: theme tokens resolved, any @alpha dropped, the default light when unset. */
export function previewColor(color: string | undefined, theme: unknown): string {
  if (!color) return defaultLightColor(theme);

  return themeColor(color, theme).split('@')[0] || WARM_WHITE;
}

/** An easing spec (motion tokens resolved) as a curve; an unparseable one falls back to linear. */
export function curveOf(spec: EasingSpec, tokens?: MotionTokens): (x: number) => number {
  try {
    return parseEasing(resolveEasingRef(spec, resolveTokens(tokens))).fn;
  } catch {
    return (x) => x;
  }
}

/** The effect's window, as the dispatcher computes it: energy-scaled default duration on the frame grid. */
export function fxWindow(g: FxGraphic, energy: number) {
  const fps = PREVIEW_FPS;
  const defaults = FX_PRIMITIVES[g.effect].defaults;
  const scaled = defaults.duration / Math.sqrt(Math.min(2, Math.max(0.5, energy || 1)));
  const duration = Math.max(2, Math.round((g.duration ?? scaled) * fps)) / fps;
  const at = Math.round(seconds(g.at, 0) * fps) / fps;
  const passes = g.repeat ?? 1;
  const every = Math.max(duration, Math.round((g.every ?? duration + FX_PASS_REST) * fps) / fps);
  const last = at + (passes - 1) * every + duration;
  const until = typeof g.until === 'number' ? Math.round(g.until * fps) / fps : undefined;
  const end = until === undefined ? last : Math.min(last, until);

  return end > at ? { at, duration, passes, every, end } : null;
}

/** The engine's per-element seed: global.seed and the element's path (sections.<name>.graphics[i]). */
export function elementSeed(index: number, env: PreviewEnv): number {
  return deriveSeed(env.globalSeed ?? 0, `sections.${sectionName(env.section, env.sectionIndex)}.graphics[${index}]`);
}

/** An fx element's seed: the element seed, mixed with its own `seed` when it sets one. */
export function fxSeed(g: FxGraphic, index: number, env: PreviewEnv): number {
  const base = elementSeed(index, env);

  return g.seed === undefined ? base : fnv1a32(`${base}:${g.seed}`);
}

/**
 * The engine FxContext of `graphic[index]` in this section, or null when it draws nothing (no such target,
 * an empty window). `has` reports every filter present, so the plans take their full-featured branch.
 */
export function previewFxContext(graphic: Graphic, index: number, env: PreviewEnv): AnyFxContext | null {
  if (graphic.type !== 'fx') return null;

  const g = graphic;
  const target = previewTarget(g.target, env);
  const energy = env.reduced ? 0 : (env.tokens?.energy ?? 1);
  const time = fxWindow(g, energy);

  if (!target || !time) return null;

  const frame = frameOf(env.orientation);
  const defaults = FX_PRIMITIVES[g.effect].defaults;
  const seed = fxSeed(g, index, env);

  return {
    graphic: g,
    target,
    frame: { ...frame, fps: PREVIEW_FPS },
    ...time,
    ease: resolveEasingRef(g.ease ?? defaults.ease, resolveTokens(env.tokens)),
    color: previewColor(g.color, env.theme),
    theme: env.theme,
    peak: defaults.ceiling * (g.intensity ?? defaults.intensity),
    energy,
    reduced: energy === 0,
    seed,
    random: seededRandom(fnv1a32(`${seed}:defaults`)),
    prefix: `fx${index}_`,
    has: () => true,
    sprite: () => null,
  };
}
