import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { motionCatalog } from '@/core/motion/catalog';
import { MOTION_GENRES } from '@/core/motion/catalog-doctrine';
import { CAMERA_PRESETS } from '@/schemas/camera.schemas';
import { DESIGNED_TRANSITIONS } from '@/core/motion/transitions';
import { XFADE_TRANSITIONS } from '@/schemas/effects.schemas';
import { GraphicSchema } from '@/schemas/graphics.schemas';
import { TemplateValidator } from '@/services/TemplateValidator';

const ROLES = ['hook', 'problem', 'product-intro', 'proof', 'cta', 'outro'];

function expectGuide(entry: { verb: string; useWhen: string; avoidWhen: string; pairsWith: string[] }, name: string) {
  expect(entry.verb, name).toMatch(/^[A-Z][A-Z ]+$/);
  expect(entry.useWhen.length, name).toBeGreaterThan(5);
  expect(entry.avoidWhen.length, name).toBeGreaterThan(5);
  expect(entry.pairsWith.length, name).toBeGreaterThan(0);
}

// Every `[slot]` filled with plausible copy, as an agent would.
function filled(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value).replaceAll(/\[[a-z ]+\]/g, 'Ship it today'));
}

describe('motion catalog', () => {
  const catalog = motionCatalog();

  it('gives every kinetic preset, camera preset, transition and graphic a verb and art direction', () => {
    for (const preset of catalog.kinetic.presets) expectGuide(preset, preset.preset);
    expect(catalog.camera.presets.map((p) => p.preset)).toEqual([...CAMERA_PRESETS]);
    for (const preset of catalog.camera.presets) expectGuide(preset, preset.preset);
    for (const [name, entry] of Object.entries(catalog.transitions)) {
      expectGuide(entry, name);
      expect(entry.description.length, name).toBeGreaterThan(10);
      expect(name === 'cut' || [...DESIGNED_TRANSITIONS, ...XFADE_TRANSITIONS].includes(name as never), name).toBe(
        true
      );
    }
    for (const type of DESIGNED_TRANSITIONS) expect(catalog.transitions[type]).toBeDefined();
    // fx is itself a union (one member per primitive), keyed by `effect`.
    const graphicTypes = GraphicSchema.options.map((option) => ('shape' in option ? option.shape.type.value : 'fx'));
    expect(Object.keys(catalog.graphics).sort()).toEqual([...graphicTypes].sort());
    for (const [name, entry] of Object.entries(catalog.graphics)) expectGuide(entry, name);
    expect(catalog.kinetic.presets.find((p) => p.preset === 'impact')?.verb).toBe('SLAMS');
    expect(catalog.kinetic.presets.find((p) => p.preset === 'typewriter')?.verb).toBe('TYPES');
    expect(catalog.graphics.underline.verb).toBe('DRAWS');
    expect(catalog.camera.presets.find((p) => p.preset === 'push-in')?.verb).toBe('LEANS IN');
  });

  it('states a doctrine per genre: defaults, a primary transition with accents, do and avoid', () => {
    expect(Object.keys(catalog.doctrine).sort()).toEqual([...MOTION_GENRES].sort());

    for (const [genre, doctrine] of Object.entries(catalog.doctrine)) {
      expect(doctrine.defaults.energy, genre).toBeGreaterThan(0);
      expect(doctrine.defaults.transition.accents.length, genre).toBeGreaterThan(0);
      expect(doctrine.defaults.transition.accents.length, genre).toBeLessThanOrEqual(2);
      expect(catalog.transitions[doctrine.defaults.transition.primary], genre).toBeDefined();
      expect(doctrine.do.length, genre).toBeGreaterThan(1);
      expect(doctrine.avoid.length, genre).toBeGreaterThan(1);
    }

    expect(catalog.doctrine['product-launch'].avoid.join(' ')).toMatch(/overshoot/i);
  });

  it('ships 8–10 blueprints covering every narrative role', () => {
    expect(catalog.blueprints.length).toBeGreaterThanOrEqual(8);
    expect(catalog.blueprints.length).toBeLessThanOrEqual(10);
    expect(new Set(catalog.blueprints.flatMap((b) => b.roles))).toEqual(new Set(ROLES));

    for (const blueprint of catalog.blueprints) {
      const [min, max] = blueprint.bestSpan;
      const duration = (blueprint.section.options as { duration: number }).duration;

      expect(blueprint.signatureMove.length, blueprint.name).toBeGreaterThan(20);
      expect(min, blueprint.name).toBeLessThan(max);
      expect(duration, blueprint.name).toBeGreaterThanOrEqual(min);
      expect(duration, blueprint.name).toBeLessThanOrEqual(max);
      expect(JSON.stringify(blueprint.section), blueprint.name).toMatch(/\[[a-z ]+\]/);
    }
  });

  it('every blueprint section validates, assertions included, and is lint-clean once its slots are filled', () => {
    for (const blueprint of catalog.blueprints) {
      const descriptor = {
        meta: { name: blueprint.name },
        global: { orientation: 'landscape', fps: 30, seed: 1 },
        sections: [filled(blueprint.section)],
      };

      expect(new TemplateValidator().validateTemplate(descriptor).errors ?? [], blueprint.name).toEqual([]);
      expect(new TemplateValidator().getMotionWarnings(descriptor), blueprint.name).toEqual([]);
    }
  });

  it('keeps the starter valid', () => {
    expect(new TemplateValidator().validateTemplate(catalog.starter).errors ?? []).toEqual([]);
  });
});
