// Resolves an fx `target` (schemas/fx.schemas.ts) to the rectangle an effect lives in and how its shape is
// masked. Every kind lands on the same shape: an even-pixel rectangle snapped INWARD (never past what the
// author drew) and clamped to the frame, so 4:2:0 chroma never smears its edge and the effect can crop,
// overlay and mask on exact pixels. Pure: a function of the descriptor and the frame, no seed.

import type { Filter, Section } from '@/core/types';
import { FX_TARGET_REF, type FxRectTarget, type FxTarget } from '../../schemas/fx.schemas';
import type { SplitLayout } from '../../schemas/layout.schemas';
import { resolveLayerGeometry } from '../utils/input-sources';
import { splitRects } from './layout';
import { kineticBlockMask } from './kinetic';
import type { SugarContext } from './sugar-context';

/** How the effect is clipped inside its rectangle. */
export type FxMaskKind = 'none' | 'rounded' | 'text';

export interface FxTargetRect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Corner radius in px (rounded masks only). */
  radius: number;
  mask: FxMaskKind;
  /** text: white drawtext units in frame coordinates, drawn on a black frame-sized canvas. */
  textMask?: Filter[];
}

export interface FxTargetEnv {
  section: Section;
  ctx: SugarContext;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function frameSize(ctx: SugarContext): { width: number; height: number } {
  const [width, height] = ctx.scale.split(':').map(Number);

  return { width, height };
}

function evenUp(value: number): number {
  return 2 * Math.ceil(value / 2);
}

function evenDown(value: number): number {
  return 2 * Math.floor(value / 2);
}

/** Intersects a box with the frame and snaps it inward to even pixels; null when nothing is left. */
export function snapToFrame(box: Box, width: number, height: number): Box | null {
  const x = evenUp(Math.max(0, box.x));
  const y = evenUp(Math.max(0, box.y));
  const right = evenDown(Math.min(width, box.x + box.w));
  const bottom = evenDown(Math.min(height, box.y + box.h));

  if (right - x < 2 || bottom - y < 2) return null;

  return { x, y, w: right - x, h: bottom - y };
}

function rectBox(target: FxRectTarget, scale: string): Box {
  return resolveLayerGeometry(target, scale);
}

function paneBox(section: Section, index: number, frame: { width: number; height: number }): Box | null {
  const layout = (section as { layout?: { type: string } }).layout;

  if (!layout) return null;

  if (layout.type !== 'split') return index <= 1 ? { x: 0, y: 0, w: frame.width, h: frame.height } : null;

  return splitRects(layout as SplitLayout, frame.width, frame.height)[index] ?? null;
}

function layerBox(section: Section, index: number, scale: string): Box | null {
  const layer = section.options?.layers?.[index];

  return layer ? resolveLayerGeometry(layer, scale) : null;
}

function refTarget(kind: string, index: number, env: FxTargetEnv): FxTargetRect | null {
  const frame = frameSize(env.ctx);

  if (kind === 'text') {
    const parts = kineticBlockMask(env.section.kinetic, index, env.ctx);
    const box = parts ? snapToFrame(parts.box, frame.width, frame.height) : null;

    return parts && box ? { ...box, radius: 0, mask: 'text', textMask: parts.mask } : null;
  }

  const raw = kind === 'pane' ? paneBox(env.section, index, frame) : layerBox(env.section, index, env.ctx.scale);
  const box = raw && snapToFrame(raw, frame.width, frame.height);

  return box ? { ...box, radius: 0, mask: 'none' } : null;
}

/**
 * The rectangle `target` names, or null when it names nothing in this section (no such pane, layer or
 * kinetic block) or falls entirely outside the frame. Omitted = the whole frame.
 */
export function resolveFxTarget(target: FxTarget | undefined, env: FxTargetEnv): FxTargetRect | null {
  const frame = frameSize(env.ctx);

  if (target === undefined || target === 'frame') return { x: 0, y: 0, ...wh(frame), radius: 0, mask: 'none' };

  if (typeof target === 'string') {
    const ref = FX_TARGET_REF.exec(target);

    return ref ? refTarget(ref[1], Number(ref[2]), env) : null;
  }

  const box = snapToFrame(rectBox(target, env.ctx.scale), frame.width, frame.height);

  if (!box) return null;

  const radius = Math.min(Math.round(target.radius ?? 0), Math.floor(Math.min(box.w, box.h) / 2));

  return { ...box, radius, mask: radius > 0 ? 'rounded' : 'none' };
}

function wh(frame: { width: number; height: number }): { w: number; h: number } {
  return { w: evenDown(frame.width), h: evenDown(frame.height) };
}
