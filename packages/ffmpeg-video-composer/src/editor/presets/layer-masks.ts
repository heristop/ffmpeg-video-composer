// Layer masks (inputs[].options.mask). Staged with the background sugar, so each shape's compile-time image is
// an extra input (`mask<position>`) before the maps are built; planned per layer when MapManager composites it:
// the source leg chains to prepend and the overlay maps (mask-composite.ts). Without alphamerge nothing is
// staged, each mask says how it degrades (mask_unavailable), and the plan falls back before any composite step
// is built (the compat rules would otherwise null alphamerge inside a two-input chain): a shape to its resting
// box (clip-box.ts), an inverted shape or a track matte to the plain overlay. Mask pads carry a `.mk_` prefix (a "." no input name can contain).

import type { Section } from '@/core/types';
import type { LayerMask, MaskMode, SectionMask } from '../../schemas/mask.schemas';
import { maskFallback } from './mask-fallback';
import { isBackgroundInput } from '../utils/background-input';
import { assertSafePadLabel } from '../utils/filter-option-guard';
import { clipBoxSteps, evenBox, type CutIO, type MapStep } from './clip-box';
import { layerMaskSteps, type MaskSourceLeg } from './mask-composite';
import { matteBlur, shapeMaskPlan } from './mask-source';
import type { SugarContext } from './sugar-context';

/** A track matte layer's grey leg and where it sits (MapManager.registerMatte). */
export interface MatteLeg {
  pad: string;
  overlay: string;
}

export interface LayerMaskEnv {
  io: CutIO;
  /** The layer's index in section.inputs: its mask image key. */
  position: number;
  fps: number;
  frame: [number, number];
  /** The active build has alphamerge; false plans the fallback whatever was staged. */
  available: boolean;
  /** Stream index of a registered extra input; undefined when it was not staged. */
  extraInput: (key: string) => number | undefined;
  /** The matte layer's grey leg, for a track matte whose layer was registered as one. */
  matte?: MatteLeg;
}

export interface LayerMaskPlan {
  /** Source leg chains to prepend to the graph. */
  chains: string[];
  steps: MapStep[];
}

interface Source {
  chains: string[];
  leg: MaskSourceLeg;
}

export function layerMaskKey(position: number): string {
  return `mask${position}`;
}

function fallbackNote(mask: LayerMask): string {
  const { need, outcome } = maskFallback(mask);

  return `${need} needs alphamerge, absent from this FFmpeg build; ${outcome}`;
}

/** Registers every shape mask image of the section as an extra input, or warns when masks are unavailable. */
export function stageLayerMasks(section: Section, ctx: SugarContext): void {
  const masks = ctx.masks;
  // The authored index: the prepended section background is not one of the author's inputs.
  const leading = (section.inputs ?? []).filter((input) => isBackgroundInput(input)).length;

  for (const [position, input] of (section.inputs ?? []).entries()) {
    const mask = input.options?.mask;

    if (!mask || !masks) continue;

    if (!masks.available) {
      masks.warn(`[mask_unavailable] inputs[${position - leading}] "${input.name}": ${fallbackNote(mask)}`);
      continue;
    }

    const plan = shapeMaskPlan(mask, layerMaskKey(position), ctx.fps);

    if (plan) masks.input(plan.key, { url: plan.url, still: true });
  }
}

function shapeSource(mask: LayerMask, env: LayerMaskEnv): Source | null {
  const plan = shapeMaskPlan(mask, layerMaskKey(env.position), env.fps);
  const index = plan ? env.extraInput(plan.key) : undefined;

  if (!plan || index === undefined) return null;

  const still = plan.legFilters.length === 0;
  const pad = still ? `${index}:v` : assertSafePadLabel(`${env.io.name}.mk_l`);

  return {
    chains: still ? [] : [`[${index}:v]${plan.legFilters.join(',')}[${pad}]`],
    leg: { pad, overlay: `x='${plan.x}':y='${plan.y}'`, invert: mask.invert },
  };
}

function matteSource(mask: LayerMask, env: LayerMaskEnv): Source | null {
  if (!env.matte) return null;

  return { chains: [], leg: { ...env.matte, invert: mask.invert, blur: matteBlur(mask.feather) } };
}

function maskSource(mask: LayerMask, env: LayerMaskEnv): Source | null {
  return mask.layer ? matteSource(mask, env) : shapeSource(mask, env);
}

function fallbackSteps(mask: LayerMask, env: LayerMaskEnv): MapStep[] {
  const plan = mask.shape && !mask.invert ? shapeMaskPlan(mask, layerMaskKey(env.position), env.fps) : null;

  if (plan) return clipBoxSteps(env.io, evenBox(plan.box, ...env.frame));

  const { base, leg, overlay, name, filters } = env.io;

  return [{ inputs: [base, leg], filters: [{ type: 'overlay', value: overlay }, ...filters], outputs: [name] }];
}

/** How MapManager composites a masked layer: through its mask, or the fallback when it has no source. */
export function layerMaskPlan(mask: LayerMask, env: LayerMaskEnv): LayerMaskPlan {
  const source = env.available ? maskSource(mask, env) : null;

  if (!source) return { chains: [], steps: fallbackSteps(mask, env) };

  const { base, leg, overlay, name, filters } = env.io;
  const steps = layerMaskSteps({ base, leg, overlay, filters, source: source.leg, prefix: `${name}.mk_`, out: name });

  return { chains: source.chains, steps };
}

/** The reader name of the section's own mask (options.mask.layer): no input can be named so. */
export const SECTION_READER = '@section';

type Reading = readonly [reader: string, mask: LayerMask | SectionMask | undefined];

// Every mask of the section with the name of what it masks: each layer, then the section itself.
function maskReadings(section: Section): Reading[] {
  return [
    ...(section.inputs ?? []).map((input): Reading => [input.name, input.options?.mask]),
    [SECTION_READER, section.options?.mask],
  ];
}

// A layer that is itself a matte, or masks itself, has no leg to take: it draws plain.
function canRead(reader: string, layer: string, named: ReadonlySet<string | undefined>, drawn: ReadonlySet<string>) {
  if (layer === reader || named.has(reader)) return false;

  return drawn.has(layer) && (reader === SECTION_READER || drawn.has(reader));
}

/**
 * The track matte layers by name, each with the one reader that takes it: the first in draw order (a leg can be
 * consumed once), the section's own mask counting as the last. Only layers in `drawn` count, on both sides: an
 * input drawn as plain media registers no leg. A layer that is itself a matte, or masks itself, cannot read
 * one: it draws plain, so a chain or a cycle never leaves a registered leg unconnected.
 */
export function matteReaders(section: Section, drawn: ReadonlySet<string>): Map<string, string> {
  const readings = maskReadings(section);
  const named = new Set(readings.map(([, mask]) => mask?.layer));
  const readers = new Map<string, string>();

  for (const [reader, mask] of readings) {
    const layer = mask?.layer;

    if (layer && !readers.has(layer) && canRead(reader, layer, named, drawn)) readers.set(layer, reader);
  }

  return readers;
}

/**
 * The matte layers and how each is read, by name. They are not drawn: MapManager registers their grey legs for
 * the masks that read them. Without alphamerge there are none: every layer draws plainly.
 */
export function matteModes(section: Section, available: boolean, drawn: ReadonlySet<string>): Map<string, MaskMode> {
  if (!available) return new Map();

  const byName = new Map(maskReadings(section));

  return new Map(
    [...matteReaders(section, drawn)].map(([layer, reader]) => [layer, byName.get(reader)?.mode ?? 'alpha'] as const)
  );
}
