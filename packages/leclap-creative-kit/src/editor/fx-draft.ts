// A fresh placement from the animation library: the graphic a builder inserts when an author picks an
// engine primitive. It lands on the section's default target (its main card layer, else the frame) with
// parameters derived from that context — the target's size and aspect, the section's length, the theme
// tokens and a per-placement seed — so two placements never start from the same stock look, and the
// author tunes from there in the parameter panel. Pure, UI-free; shared by web and Expo.

import type { Graphic } from 'ffmpeg-video-composer/src/schemas/graphics.schemas.ts';
import type { FxTarget } from 'ffmpeg-video-composer/src/schemas/fx.schemas.ts';
import type { EngineLibraryEntry } from './animation-library';
import type { BackgroundLayer, EditorSection, Orientation } from './model';

/** Output frame per orientation (the engine's defaults). */
export const FRAME_SIZE: Record<Orientation, [number, number]> = {
  landscape: [1280, 720],
  portrait: [720, 1280],
  square: [1080, 1080],
};

export interface DraftContext {
  section: EditorSection;
  orientation: Orientation;
  /** Mixed into the seed so placements in different sections differ (e.g. the section index). */
  salt?: number | string;
}

/** The geometry a draft derives its parameters from. */
export interface DraftGeometry {
  target: FxTarget;
  rect: { x: number; y: number; w: number; h: number; radius: number };
  frame: { width: number; height: number };
  /** Seconds the section lasts (bounded for effects that span it). */
  span: number;
  seed: number;
}

type Tune = (geo: DraftGeometry) => Record<string, unknown>;

function numeric(value: BackgroundLayer['x'], fallback: number): number | null {
  if (value === undefined) return fallback;

  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function layerRect(layer: BackgroundLayer, width: number, height: number) {
  const x = numeric(layer.x, 0);
  const y = numeric(layer.y, 0);
  const w = numeric(layer.w, width);
  const h = numeric(layer.h, height);

  if (x === null || y === null || w === null || h === null) return null;

  // color_background layers are square-cornered.
  return { x, y, w, h, radius: 0 };
}

/**
 * The section's main card: its largest numeric color_background layer that is not the full frame, as a
 * `layer:<i>` target, or null when the section has none (video, image, a bare colour).
 */
export function mainLayerTarget(section: EditorSection, orientation: Orientation) {
  if (section.kind !== 'color') return null;

  const [width, height] = FRAME_SIZE[orientation];
  let main: { target: FxTarget; rect: NonNullable<ReturnType<typeof layerRect>> } | null = null;

  for (const [index, layer] of (section.layers ?? []).entries()) {
    const rect = layerRect(layer, width, height);
    const area = rect ? rect.w * rect.h : 0;

    // A card, not the backdrop: positive and clearly smaller than the frame; the largest one wins.
    if (rect && area > 0 && area < width * height * 0.9 && area > (main ? main.rect.w * main.rect.h : 0)) {
      main = { target: `layer:${index}`, rect };
    }
  }

  return main;
}

function hash(text: string): number {
  let value = 2166136261;

  for (const char of text) value = Math.imul(value ^ (char.codePointAt(0) ?? 0), 16777619) >>> 0;

  return value;
}

function sectionSeconds(section: EditorSection): number {
  return 'duration' in section && typeof section.duration === 'number' && section.duration > 0 ? section.duration : 4;
}

/** Where `entry` lands in this section, and the numbers its parameters derive from. */
export function draftGeometry(entry: EngineLibraryEntry, ctx: DraftContext): DraftGeometry {
  const [width, height] = FRAME_SIZE[ctx.orientation];
  const graphics = ('graphics' in ctx.section ? ctx.section.graphics : undefined) ?? [];
  const card = entry.anchor === 'subject' ? mainLayerTarget(ctx.section, ctx.orientation) : null;
  const rect = card?.rect ?? { x: 0, y: 0, w: width, h: height, radius: 0 };

  return {
    target: card?.target ?? 'frame',
    rect,
    frame: { width, height },
    span: Math.min(12, Math.round(sectionSeconds(ctx.section) * 10) / 10),
    seed: hash(`${entry.id}:${ctx.orientation}:${ctx.salt ?? ''}:${graphics.length}`) % 10000,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function even(value: number): number {
  return Math.round(value / 2) * 2;
}

function short(geo: DraftGeometry): number {
  return Math.min(geo.rect.w, geo.rect.h);
}

function isFrame(geo: DraftGeometry): boolean {
  return geo.target === 'frame';
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// The beat the effect lands on: early in the section, never in its first frames.
function landing(geo: DraftGeometry): number {
  return round2(clamp(geo.span * 0.1, 0.2, 0.6));
}

// Sustained effects (ambient textures, glass, glows) last the whole section.
function spanning(geo: DraftGeometry) {
  return { at: 0, duration: geo.span };
}

const LEAK_EDGES = ['top-left', 'top-right', 'left', 'right'] as const;

const FX_TUNES: Record<string, Tune> = {
  sheen: (geo) => ({
    at: landing(geo),
    direction: geo.rect.w >= geo.rect.h ? 'right' : 'down',
    width: round2(clamp(36 / Math.sqrt(short(geo)), 0.08, 0.18)),
    profile: isFrame(geo) ? 'soft' : 'specular',
  }),
  'glint-orbit': (geo) => ({ at: landing(geo), count: 2, size: even(clamp(short(geo) * 0.06, 16, 40)) }),
  glint: (geo) => ({
    at: round2(landing(geo) + 0.3),
    path: isFrame(geo) ? 'scatter' : 'corners',
    count: geo.rect.w * geo.rect.h > 400_000 ? 5 : 3,
    size: even(clamp(short(geo) * 0.07, 18, 44)),
  }),
  'edge-glow': (geo) => ({ ...spanning(geo), glow: '$color.accent', spread: even(clamp(short(geo) * 0.04, 8, 24)) }),
  leak: (geo) => ({ at: 0, duration: round2(clamp(geo.span * 0.6, 2, 4)), edge: LEAK_EDGES[geo.seed % 4] }),
  bloom: (geo) => ({ ...spanning(geo), threshold: 0.78 }),
  ripple: (geo) => ({ at: landing(geo), color: '$color.accent', rings: 2, radius: isFrame(geo) ? 0.35 : 0.6 }),
  // A fingertip, not a spotlight: the dot stays ~56 px whatever the target's size.
  'ripple-tap': (geo) => ({ at: landing(geo), color: '$color.accent', dot: round2(clamp(56 / short(geo), 0.05, 0.3)) }),
  resolve: () => ({ at: 0 }),
  glass: (geo) => ({ ...spanning(geo), tone: 'dark' }),
  'vignette-breathe': (geo) => ({ ...spanning(geo), period: round2(clamp(geo.span / 1.5, 4, 10)) }),
  confetti: (geo) => ({
    at: landing(geo),
    origin: { x: 0.5, y: isFrame(geo) ? 0.9 : 0.6 },
    count: geo.frame.width * geo.frame.height > 1_000_000 ? 30 : 24,
  }),
  bokeh: (geo) => ({ ...spanning(geo), count: geo.frame.width >= geo.frame.height ? 8 : 6 }),
  dust: (geo) => ({ ...spanning(geo), count: 18 }),
  grain: (geo) => ({ ...spanning(geo), size: 1.5 }),
};

function placement(geo: DraftGeometry, inset: number): Record<string, unknown> {
  return isFrame(geo) ? { inset } : { target: geo.target, clearance: 16 };
}

const STROKE_TUNES: Record<string, Tune> = {
  frame: (geo) => ({
    at: 0.2,
    ...placement(geo, even(short(geo) * 0.06)),
    trace: 'path',
    exit: 'fade',
    color: '$color.fg',
  }),
  corners: (geo) => ({
    at: 0.2,
    ...placement(geo, even(short(geo) * 0.08)),
    trace: 'clockwise',
    exit: 'expand',
    color: '$color.accent',
  }),
  underline: (geo) => {
    const width = even(isFrame(geo) ? geo.frame.width * 0.4 : geo.rect.w * 0.6);

    return {
      at: landing(geo),
      x: even(geo.rect.x + (geo.rect.w - width) / 2),
      y: even(isFrame(geo) ? geo.frame.height * 0.7 : geo.rect.y + geo.rect.h + 16),
      width,
      thickness: even(clamp(Math.min(geo.frame.width, geo.frame.height) / 120, 4, 12)),
      caps: 'round',
      exit: 'fade',
      color: '$color.accent',
    };
  },
};

/** The graphic a pick of `entry` inserts into `ctx.section`. */
export function draftGraphic(entry: EngineLibraryEntry, ctx: DraftContext): Graphic {
  const geo = draftGeometry(entry, ctx);

  if (entry.preset.type !== 'fx') return { ...entry.preset, ...STROKE_TUNES[entry.id](geo) };

  return { ...entry.preset, target: geo.target, seed: geo.seed, ...FX_TUNES[entry.id](geo) };
}
