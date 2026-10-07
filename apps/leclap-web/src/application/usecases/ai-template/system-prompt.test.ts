import { describe, expect, it } from 'vitest';
import { templateDescriptorJsonSchema } from 'ffmpeg-video-composer/src/schemas/template.schemas.ts';
import { FX_PRIMITIVES } from 'ffmpeg-video-composer/src/schemas/fx-primitives.schemas.ts';
import { compactSchema, fitSchema } from './schema-digest';
import { generationContext, promptFor } from './generation-context';
import { buildSystemPrompt, buildUserBrief, DEFAULT_PROMPT_BUDGET, REFERENCE_STYLE_HEADING } from './system-prompt';
import { artDirection, GENRE_FONTS } from './art-direction';
import { buildPlanPrompt } from './plan-prompt';

describe('art direction', () => {
  it('ships the story spine and the lazy-defaults block, without pinned centring or a fixed font trio', () => {
    const built = promptFor('30s product launch for a note-taking app', { genre: 'product-launch' });
    const direction = artDirection({ genre: 'product-launch' });

    expect(built.system).toContain('Story spine:');
    expect(built.system).toContain('Lazy defaults to avoid');
    expect(built.system).toContain('Everything centred.');
    expect(built.system).toContain('Purple-to-blue neon gradients.');
    expect(built.system).toContain('Every element entering at t=0');
    expect(built.system).toContain('"Welcome to…"');
    expect(built.system).toContain('slowest beat lasts at least 3× the fastest');
    expect(built.system).toContain('value claim by beat 2');
    expect(built.system).toContain('edge-anchored');
    expect(built.system).not.toContain('Centre with x');
    expect(built.system).not.toContain('BebasNeue, Anton, Oswald');
    expect(direction).not.toContain('(w-text_w)/2');
    expect(direction).toContain(GENRE_FONTS['product-launch']);
  });

  it('points at the theme tokens when a theme is set, and varies fonts by genre otherwise', () => {
    expect(artDirection({ theme: 'editorial' })).toContain('"$font.display"');
    expect(artDirection({ theme: 'editorial' })).toContain('"$color.accent"');
    expect(artDirection({ genre: 'cinematic-trailer' })).toContain('PlayfairDisplay.ttf');
    expect(artDirection({ genre: 'explainer' })).not.toContain('PlayfairDisplay.ttf');
    expect(artDirection({})).toContain('pick by tone');
  });
});

type Node = Record<string, unknown>;

// The fx primitives' union inside the JSON Schema (variants with `type: "fx"` and an `effect` const).
function fxUnion(node: unknown): Node[] {
  if (node === null || typeof node !== 'object') return [];

  const record = node as Node;
  const variants = Array.isArray(record.oneOf) ? (record.oneOf as Node[]) : [];
  const isFx = (variant: Node) => (variant.properties as Node | undefined)?.effect !== undefined;

  if (variants.length > 0 && variants.every(isFx)) return variants;

  for (const child of Object.values(record)) {
    const found = fxUnion(child);

    if (found.length > 0) return found;
  }

  return [];
}

// A new primitive shaped like sheen: its own effect name, own field descriptions and summary.
function primitiveLike(sheen: Node, own: string[], index: number): Node {
  const clone = structuredClone(sheen);
  const properties = clone.properties as Record<string, Node>;

  properties.effect = { type: 'string', const: `primitive-${String(index)}` };

  for (const key of own) {
    properties[`${key}${String(index)}`] = {
      ...properties[key],
      description: `Primitive ${String(index)}: ${String(properties[key].description)}`,
    };
    delete properties[key];
  }

  clone.description = `Primitive ${String(index)}. ${String(clone.description)}`;

  return clone;
}

describe('schema digest', () => {
  it('shrinks the engine schema by an order of magnitude and stays valid JSON', () => {
    const raw = JSON.stringify(templateDescriptorJsonSchema).length;
    const digest = compactSchema(templateDescriptorJsonSchema, 120);

    expect(digest.length).toBeLessThan(raw / 4);
    expect(() => JSON.parse(digest) as unknown).not.toThrow();
  });

  it('stays under a quarter of the schema as the fx union grows (12 more primitives)', () => {
    const schema = structuredClone(templateDescriptorJsonSchema) as unknown;
    const union = fxUnion(schema);
    const [sheen] = union;
    const own = Object.keys(FX_PRIMITIVES.sheen.params);

    for (let index = 1; index <= 12; index++) {
      union.push(primitiveLike(sheen, own, index));
    }

    const raw = JSON.stringify(schema).length;
    const digest = compactSchema(schema, 120);

    expect(digest.length).toBeLessThan(raw / 4);
    // Each extra primitive costs its own fields only: the shared fx fields are stated once.
    expect(digest.length - compactSchema(templateDescriptorJsonSchema, 120).length).toBeLessThan(12 * 1_600);
  });

  it('states the fields every variant of a union repeats once', () => {
    const shared = { at: { type: 'number', description: 'Start, in seconds from the section start.' } };
    const variant = (name: string) => ({
      type: 'object',
      properties: { type: { const: name }, ...shared, color: { type: 'string', description: 'A long colour note.' } },
    });
    const parsed = JSON.parse(compactSchema({ oneOf: ['a', 'b', 'c'].map(variant) }, 160)) as {
      oneOf: Array<{ properties: Record<string, unknown>; allOf: unknown[] }>;
    };

    expect(parsed.oneOf.map((entry) => Object.keys(entry.properties))).toEqual([['type'], ['type'], ['type']]);
    expect(new Set(parsed.oneOf.map((entry) => JSON.stringify(entry.allOf))).size).toBe(1);
  });

  it('keeps field names that collide with schema keywords (a section has a title and a description)', () => {
    const schema = {
      type: 'object',
      description: 'root',
      properties: { title: { type: 'string' }, description: { type: 'object' } },
    };
    const parsed = JSON.parse(compactSchema(schema, 0)) as {
      properties: Record<string, unknown>;
      description?: string;
    };

    expect(Object.keys(parsed.properties)).toEqual(['title', 'description']);
    expect(parsed.description).toBeUndefined();
  });

  it('clips descriptions harder to meet a budget, and flags a hard cut', () => {
    const roomy = fitSchema(templateDescriptorJsonSchema, 200_000);
    const tight = fitSchema(templateDescriptorJsonSchema, 40_000);
    const tiny = fitSchema(templateDescriptorJsonSchema, 1_000);

    expect(roomy.descriptionLength).toBe(160);
    expect(tight.text.length).toBeLessThanOrEqual(40_000);
    expect(tight.descriptionLength).toBeLessThan(160);
    expect(tiny.truncated).toBe(true);
    expect(tiny.text).toHaveLength(1_000);
  });
});

describe('buildSystemPrompt', () => {
  it('contains the contract, catalog, samples and schema, under the size budget', () => {
    const built = promptFor('30s product launch for a note-taking app, bold, punchy kinetic type', {
      orientation: 'portrait',
      genre: 'product-launch',
    });

    expect(built.system.length).toBeLessThanOrEqual(DEFAULT_PROMPT_BUDGET);
    expect(built.system).toContain('exactly ONE JSON object');
    expect(built.system).toContain('Template JSON Schema');
    expect(built.system).toContain('"sections"');
    expect(built.system).toContain('kenburns');
    expect(built.system).toContain('Motion catalog');
    expect(built.system).toContain('"kinetic"');
    expect(built.system).toContain('BebasNeue.ttf');
    expect(built.system).toContain('"doctrine":{"product-launch"');
    expect(built.system).not.toContain('"calm-tutorial":{"summary"');
    expect(built.system).toContain('"blueprints"');
    expect(built.sampleIds.length).toBeGreaterThan(0);
    expect(built.sampleIds).toContain('product-launch');
    expect(built.schemaTruncated).toBe(false);
  });

  it('steers the model to compose motion from the engine, with library animations as labelled samples', () => {
    const { system } = promptFor('30s product launch for a note-taking app', { genre: 'product-launch' });
    const motion = system.indexOf('Motion catalog (');
    const samples = system.indexOf('Sample animation overlays (stock demo assets, last resort only');

    expect(system).toContain("Compose motion, don't pick it");
    expect(system).toContain('Never ship an effect with all-default parameters.');
    expect(system).toContain('One or two signature moves for the whole video');
    expect(system).toContain('"samples":{"note":"Sample assets, not building blocks');
    expect(system).not.toContain('Animation overlays (inputs[].url');
    expect(motion).toBeGreaterThan(0);
    // The engine catalog comes first; the stock overlays come after it, labelled.
    expect(samples).toBeGreaterThan(motion);
  });

  it('drops samples before squeezing the schema below a minimum', () => {
    const context = generationContext();
    const input = { schema: context.schema, catalog: context.catalog, samples: context.samples.slice(0, 3), hints: {} };
    // Room for a few KB of schema past the fixed blocks (catalog, rules): less than the schema minimum, so
    // the samples go first. Derived from the fixed size, which grows with the engine's vocabulary.
    const budget = buildSystemPrompt({ ...input, schema: {}, samples: [] }).system.length + 4_000;
    const built = buildSystemPrompt({ ...input, budget });

    expect(built.system.length).toBeLessThanOrEqual(budget);
    expect(built.sampleIds.length).toBeLessThan(3);
  });

  it('only offers builder-compatible samples (no effect sections)', () => {
    for (const sample of generationContext().samples) {
      expect(sample.backend).toBe('native');
      expect((sample.template.sections ?? []).some((section) => section.type === 'effect')).toBe(false);
    }
  });
});

describe('buildUserBrief', () => {
  it('appends hints in plain words', () => {
    const brief = buildUserBrief('  calm tutorial intro, 3 steps ', {
      orientation: 'landscape',
      durationSeconds: 30,
      platform: 'youtube',
      energy: 0,
    });

    expect(brief).toContain('Brief: calm tutorial intro, 3 steps');
    expect(brief).toContain('Orientation: landscape');
    expect(brief).toContain('about 30 seconds');
    expect(brief).toContain('global.platform to "youtube"');
    expect(brief).toContain('Energy: calm');
  });

  it('asks for the chosen theme', () => {
    expect(buildUserBrief('x', { theme: 'midnight' })).toContain('global.theme to "midnight"');
  });

  it('omits the "none" platform', () => {
    expect(buildUserBrief('x', { platform: 'none' })).not.toContain('platform');
  });
});

describe('reference style guide', () => {
  const rules = 'Set global.theme to exactly: {"extends":"leclap","colors":{"bg":"#101830"}}\nAvoid:\n- Film grain';

  it('adds the reference rules as a binding block', () => {
    const built = promptFor('a launch video', {}, [], rules);

    expect(built.system).toContain(REFERENCE_STYLE_HEADING);
    expect(built.system).toContain('"bg":"#101830"');
    expect(built.system).toContain('never reproduce its subjects, logos or text');
    expect(built.system.length).toBeLessThanOrEqual(DEFAULT_PROMPT_BUDGET);
  });

  it('carries the reference rules into the planning prompt', () => {
    const { catalog } = generationContext();

    expect(buildPlanPrompt(catalog, {}, rules)).toContain(REFERENCE_STYLE_HEADING);
    expect(buildPlanPrompt(catalog, {})).not.toContain(REFERENCE_STYLE_HEADING);
  });

  it('leaves the prompt unchanged without a reference', () => {
    expect(promptFor('a launch video', {}, [], '   ').system).toBe(promptFor('a launch video', {}).system);
    expect(promptFor('a launch video', {}).system).not.toContain(REFERENCE_STYLE_HEADING);
  });
});
