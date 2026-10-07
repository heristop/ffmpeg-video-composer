// Variety eval: five "generated" templates for five briefs (tests/fixtures/variety-templates.ts) must not
// share one motion recipe. Each template is reduced to a parameter vector (its fx parameters with omitted
// fields at their defaults, and the mix of kinetic presets, camera presets and transitions it uses);
// every pair must differ beyond a threshold, no single preset may dominate the set, and none may trip
// the sameness lint. The negative control (one stock recipe for every brief) must fail all three, so the
// thresholds measure something. Deterministic: pure functions over fixed fixtures.

import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { TemplateValidator } from '@/services/TemplateValidator';
import { KINETIC_PRESETS } from '@/schemas/kinetic.schemas';
import { CAMERA_PRESETS } from '@/schemas/camera.schemas';
import { BRIEFS, SLOP_TEMPLATES, VARIED_TEMPLATES } from './fixtures/variety-templates';

type Loose = Record<string, unknown>;

/** Every pair of templates must be at least this far apart (vectors are in 0..1 units per parameter). */
const MIN_DISTANCE = 0.6;
/** No kinetic preset, camera preset, transition or fx profile may take more than this share of its uses. */
const MAX_PRESET_SHARE = 0.4;

const SAMENESS = new Set([
  'fx_untuned',
  'effect_repeated',
  'library_animation_sample',
  'effect_off_theme',
  'decor_overload',
]);
const PROFILES = ['specular', 'soft', 'twin'];
const DIRECTIONS = ['right', 'left', 'down', 'up'];
const TRANSITIONS = ['cut', 'fade', 'fadeblack', 'push-left', 'whip-left', 'iris', 'zoom-through'];

function sections(template: Loose): Loose[] {
  return template.sections as Loose[];
}

function oneHot(value: unknown, options: readonly string[], fallback: string): number[] {
  const index = options.indexOf(typeof value === 'string' ? value : fallback);

  return options.map((_, i) => (i === index ? 1 : 0));
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' ? value : fallback;
}

// One sheen as numbers; an omitted field takes the default, so untuned effects collapse onto one point.
function sheenVector(fx: Loose): number[] {
  return [
    ...oneHot(fx.profile, PROFILES, 'specular'),
    num(fx.width, 0.15) / 0.6,
    (num(fx.tilt, 20) + 60) / 120,
    ...oneHot(fx.direction, DIRECTIONS, 'right'),
    num(fx.intensity, 0.9),
    num(fx.duration, 0.75) / 2,
    (num(fx.repeat, 1) - 1) / 7,
    ...oneHot(fx.color, ['$color.accent', '$color.fg', 'default'], 'default'),
  ];
}

function mean(vectors: number[][], size: number): number[] {
  if (vectors.length === 0) return Array.from({ length: size }, () => 0);

  return vectors[0].map((_, i) => vectors.reduce((sum, vector) => sum + vector[i], 0) / vectors.length);
}

function histogram(values: unknown[], vocabulary: readonly string[]): number[] {
  return vocabulary.map((name) => values.filter((value) => value === name).length / Math.max(1, values.length));
}

/** The template's motion as a parameter vector. */
function motionVector(template: Loose): number[] {
  const fx = sections(template).flatMap((section) =>
    ((section.graphics as Loose[] | undefined) ?? []).filter((graphic) => graphic.type === 'fx')
  );
  const presets = sections(template).flatMap((section) => (section.kinetic as Loose[]).map((block) => block.preset));
  const cameras = sections(template).map((section) => (section.camera as Loose | undefined)?.preset ?? 'none');
  const transitions = sections(template).map((section) => (section.transition as Loose | undefined)?.type ?? 'cut');

  return [
    ...mean(fx.map(sheenVector), sheenVector({}).length),
    ...histogram(presets, KINETIC_PRESETS),
    ...histogram(cameras, CAMERA_PRESETS),
    ...histogram(transitions, TRANSITIONS),
  ];
}

function distance(a: number[], b: number[]): number {
  return Math.hypot(...a.map((value, i) => value - b[i]));
}

function minPairDistance(templates: Loose[]): number {
  const vectors = templates.map(motionVector);

  return Math.min(...vectors.flatMap((a, i) => vectors.slice(i + 1).map((b) => distance(a, b))));
}

/** The largest share any one name takes of its family's uses, across the whole set. */
function dominantShare(templates: Loose[]): { family: string; name: string; share: number } {
  const families: Record<string, unknown[]> = {
    kinetic: templates.flatMap((t) => sections(t).flatMap((s) => (s.kinetic as Loose[]).map((b) => b.preset))),
    camera: templates.flatMap((t) =>
      sections(t).flatMap((s) => ((s.camera as Loose | undefined)?.preset ? [(s.camera as Loose).preset] : []))
    ),
    fx: templates.flatMap((t) =>
      sections(t).flatMap((s) =>
        ((s.graphics as Loose[] | undefined) ?? []).filter((g) => g.type === 'fx').map((g) => g.profile ?? 'default')
      )
    ),
  };
  const shares = Object.entries(families).flatMap(([family, values]) =>
    [...new Set(values)].map((name) => ({
      family,
      name: String(name),
      share: values.filter((v) => v === name).length / values.length,
    }))
  );

  return shares.reduce((top, entry) => (entry.share > top.share ? entry : top));
}

function samenessCodes(template: Loose): string[] {
  return new TemplateValidator()
    .getMotionWarnings(template)
    .filter((w) => SAMENESS.has(w.code))
    .map((w) => w.code);
}

describe('variety eval', () => {
  it('has five valid templates from five different briefs', () => {
    expect(new Set(BRIEFS.map((brief) => brief.brief)).size).toBe(5);

    for (const template of VARIED_TEMPLATES) {
      const result = new TemplateValidator().validateTemplate(template);

      expect(result.errors ?? [], String((template.meta as Loose).name)).toEqual([]);
    }
  });

  it('keeps every pair of templates apart in effect-parameter space', () => {
    expect(minPairDistance(VARIED_TEMPLATES)).toBeGreaterThan(MIN_DISTANCE);
  });

  it('lets no single preset dominate the set', () => {
    expect(dominantShare(VARIED_TEMPLATES).share).toBeLessThanOrEqual(MAX_PRESET_SHARE);
  });

  it('raises no sameness finding on composed templates', () => {
    expect(VARIED_TEMPLATES.flatMap(samenessCodes)).toEqual([]);
  });

  it('fails every check on the one-recipe control set', () => {
    expect(minPairDistance(SLOP_TEMPLATES)).toBeLessThan(MIN_DISTANCE);
    expect(dominantShare(SLOP_TEMPLATES)).toMatchObject({ share: 1 });
    expect(SLOP_TEMPLATES.flatMap(samenessCodes)).toEqual(expect.arrayContaining(['fx_untuned', 'effect_repeated']));
  });
});
