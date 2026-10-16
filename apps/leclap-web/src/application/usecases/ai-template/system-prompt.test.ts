import { describe, expect, it } from 'vitest';
import { templateDescriptorJsonSchema } from 'ffmpeg-video-composer/src/schemas/template.schemas.ts';
import { FX_PRIMITIVES } from 'ffmpeg-video-composer/src/schemas/fx-primitives.schemas.ts';
import { compactSchema, fitSchema } from './schema-digest';
import { generationContext, promptFor } from './generation-context';
import { buildSystemPrompt, buildUserBrief, DEFAULT_PROMPT_BUDGET, REFERENCE_STYLE_HEADING } from './system-prompt';
import { artDirection, GENRE_FONTS } from './art-direction';
import { buildPlanPrompt } from './plan-prompt';
import { analyzeStructure } from 'ffmpeg-video-composer/src/core/structure/analyze.ts';
import { structurePromptRules } from 'ffmpeg-video-composer/src/core/structure/prompt.ts';
import { analyzeStyle, styleGuidePromptRules } from 'ffmpeg-video-composer/src/core/style/index.ts';
import type { StyleFrame } from 'ffmpeg-video-composer/src/core/style/types.ts';

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

  it('shares short schemas when many path coordinates repeat them', () => {
    const coordinate = { type: 'number', minimum: 0, maximum: 1 };
    const schema = { properties: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`point${i}`, coordinate])) };
    const digest = compactSchema(schema, 120);
    const parsed = JSON.parse(digest) as { properties: Record<string, { $ref?: string }> };

    expect(parsed.properties.point0.$ref).toBeDefined();
    expect(digest.length).toBeLessThan(JSON.stringify(schema).length);
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

// A 30 s reference clip as the builder samples it (120 frames, 0.25 s apart): 40 shots of 0.75 s alternating
// dark and light grounds, each with a coloured block that moves through the 3x3 grid. Its rules come from the
// real analyzers, so the budget test measures the block the builder actually sends.
const CLIP_W = 160;
const CLIP_H = 90;
const CLIP_HUES = [
  [230, 40, 60],
  [30, 120, 230],
  [250, 200, 30],
  [40, 200, 120],
  [180, 60, 220],
  [250, 120, 20],
  [20, 210, 230],
];

function clipFrame(shot: number, k: number, time: number): StyleFrame {
  const data = new Uint8Array(CLIP_W * CLIP_H * 3);
  const [r, g, b] = CLIP_HUES[shot % CLIP_HUES.length];
  const ground = shot % 2 === 0 ? [r * 0.12, g * 0.12, b * 0.12] : [235 - r * 0.1, 235 - g * 0.1, 235 - b * 0.1];
  const cell = shot % 9;
  const left = (cell % 3) * (CLIP_W / 3) + 4 * k;
  const top = Math.floor(cell / 3) * (CLIP_H / 3);

  for (let y = 0; y < CLIP_H; y++) {
    for (let x = 0; x < CLIP_W; x++) {
      const inBlock = x >= left && x < left + CLIP_W / 3 - 8 && y >= top && y < top + CLIP_H / 3;
      const color = inBlock ? [r, g, b] : ground;
      const grain = ((x * 7 + y * 13 + k * 5) % 9) - 4;
      const i = (y * CLIP_W + x) * 3;

      for (let c = 0; c < 3; c++) data[i + c] = Math.max(0, Math.min(255, color[c] + grain));
    }
  }

  return { data, width: CLIP_W, height: CLIP_H, time };
}

function clipReferenceRules(): { format: string; rules: string } {
  const frames = Array.from({ length: 120 }, (_, f) => clipFrame(Math.floor(f / 3), f % 3, f * 0.25));
  const format = structurePromptRules(analyzeStructure({ frames, duration: 30 }));

  return { format, rules: `${styleGuidePromptRules(analyzeStyle({ frames, duration: 30 }))}\n\n${format}` };
}

describe('reference style guide', () => {
  const rules = 'Set global.theme to exactly: {"extends":"leclap","colors":{"bg":"#101830"}}\nAvoid:\n- Film grain';

  it('adds the reference rules as a binding block', () => {
    const built = promptFor('a launch video', {}, [], rules);

    expect(built.system).toContain(REFERENCE_STYLE_HEADING);
    expect(built.system).toContain('"bg":"#101830"');
    expect(built.system).toContain('never reproduce its subjects, logos or text');
    expect(built.system.length).toBeLessThanOrEqual(DEFAULT_PROMPT_BUDGET);
  });

  it('heads the block as carrying a clip’s format too, not the palette alone', () => {
    expect(REFERENCE_STYLE_HEADING).toContain('format');
    expect(REFERENCE_STYLE_HEADING).not.toContain('only');
  });

  it('fits a real reference clip’s style and format (more than 24 shots) under the budget', () => {
    const { format, rules: clipRules } = clipReferenceRules();
    const built = promptFor(
      '30s product launch for a note-taking app, bold, punchy kinetic type',
      { orientation: 'portrait', genre: 'product-launch' },
      [],
      clipRules
    );

    expect(format).toMatch(/and \d+ more shots in the same rhythm/);
    expect(clipRules).toContain('Set global.theme to exactly:');
    expect(clipRules).toContain('Avoid:');
    expect(built.system).toContain(format);
    expect(built.system.length).toBeLessThanOrEqual(DEFAULT_PROMPT_BUDGET);
    expect(built.sampleIds).toContain('product-launch');
    expect(built.schemaTruncated).toBe(false);
  }, 60_000);

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

describe('brand kit', () => {
  it('adds the brand as its own binding block, apart from the reference', () => {
    const brand = 'Brand kit (BINDING: …):\n- Brand: Acme.\n- Set global.theme to exactly: {"extends":"leclap"}';
    const built = promptFor('a launch video', {}, [], undefined, brand);

    expect(built.system).toContain('- Brand: Acme.');
    expect(built.system).not.toContain(REFERENCE_STYLE_HEADING);
    expect(built.system.length).toBeLessThanOrEqual(DEFAULT_PROMPT_BUDGET);
  });

  it('reaches the plan prompt too, and an empty brand adds nothing', () => {
    const { catalog } = generationContext();

    expect(buildPlanPrompt(catalog, {}, undefined, '- Brand: Acme.')).toContain('- Brand: Acme.');
    expect(promptFor('a launch video', {}, [], undefined, '  ').system).toBe(promptFor('a launch video', {}).system);
  });

  it('lets the brand own the theme when a reference is attached too, and the reference keep its pacing', () => {
    const reference = [
      'Set global.theme to exactly: {"extends":"leclap","colors":{"bg":"#101830"}}',
      'Use $color.<role> tokens for every colour instead of literal hex values.',
      'Direct it as the "product-launch" genre.',
      'Keep:',
      '- Quick cuts, about 1.2 s a shot',
      'Avoid:',
      '- Film grain',
    ].join('\n');
    const brand = 'Brand kit (BINDING: …):\n- Brand: Acme.\n- Set global.theme to exactly: {"extends":"leclap"}';
    const { catalog } = generationContext();

    for (const prompt of [
      promptFor('a launch video', {}, [], reference, brand).system,
      buildPlanPrompt(catalog, {}, reference, brand),
    ]) {
      expect(prompt.match(/Set global\.theme to exactly:/g)).toHaveLength(1);
      expect(prompt).toContain('- Set global.theme to exactly: {"extends":"leclap"}');
      expect(prompt).not.toContain('"bg":"#101830"');
      expect(prompt).toContain('- Quick cuts, about 1.2 s a shot');
      expect(prompt).toContain('Direct it as the "product-launch" genre.');
      expect(prompt).toContain('overrides the reference style guide’s palette and fonts');
    }
  });

  it('adds no override line without a reference', () => {
    const brand = 'Brand kit (BINDING: …):\n- Brand: Acme.';

    expect(promptFor('a launch video', {}, [], undefined, brand).system).not.toContain('overrides the reference');
  });

  it('keeps the whole schema for the tightest brief with a realistic brand block', () => {
    const brand = [
      'Brand kit (BINDING: …):',
      '- Brand: Acme. Write its name exactly so.',
      `- Set global.theme to exactly: ${JSON.stringify({ extends: 'leclap', colors: { primary: '#3ce6ac', ink: '#101010', surface: '#f4f1ea' } })}`,
      '- Exact brand fonts, for text fields that take a font object (Node and phone renders): display {"family":"Inter","weight":700}; body {"family":"Inter"}.',
    ].join('\n');
    const built = promptFor(
      '30s product launch for a note-taking app',
      { genre: 'product-launch' },
      [],
      undefined,
      brand
    );

    expect(built.schemaTruncated).toBe(false);
    expect(built.system.length).toBeLessThanOrEqual(DEFAULT_PROMPT_BUDGET);
  });
});
