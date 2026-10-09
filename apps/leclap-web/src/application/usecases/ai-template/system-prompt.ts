// Assembles the system prompt and user brief for template generation, under a size guard. Fixed
// parts (contract, constraints, art direction, catalog) always go in; the schema digest gets the
// space that is left (clipping its descriptions as needed); samples are dropped last-first if the
// total would still overflow. The order puts the stable, cacheable material first.
import type { SampleDetail } from 'ffmpeg-video-composer/src/samples/types.ts';
import {
  artDirection,
  BUILDER_CONSTRAINTS,
  COMPOSE_MOTION,
  ENERGY_WORDS,
  LAZY_DEFAULTS,
  OUTPUT_CONTRACT,
  STORY_SPINE,
} from './art-direction';
import { formatCatalog, type EngineCatalog } from './engine-catalog';
import { sampleJson } from './sample-picker';
import { CLOSED_OBJECTS, compactSchema, fitSchema } from './schema-digest';

export type Orientation = 'landscape' | 'portrait' | 'square';

export interface GenerationHints {
  orientation?: Orientation;
  durationSeconds?: number;
  platform?: string;
  // 0 (calm) … 4 (explosive).
  energy?: number;
  genre?: string;
  // A built-in theme name for global.theme.
  theme?: string;
}

export interface PromptInput {
  schema: unknown;
  catalog: EngineCatalog;
  samples: SampleDetail[];
  hints: GenerationHints;
  // Total character budget for the system prompt.
  budget?: number;
  // Keep / avoid rules from a reference image or clip ("Match a reference"); binding when present.
  referenceStyle?: string;
}

export interface BuiltPrompt {
  system: string;
  // Sample ids actually included, and whether the schema had to be cut.
  sampleIds: string[];
  schemaTruncated: boolean;
}

// Raised from 150_000 when the product-launch sample gained its HTML offer card, so the
// product-launch brief still carries that sample and the whole schema.
export const DEFAULT_PROMPT_BUDGET = 151_000;
// The schema never takes more than this, even with room to spare: past it the model reads noise.
const SCHEMA_CAP = 96_000;
const MIN_SCHEMA = 12_000;

function sampleBlock(samples: SampleDetail[]): string {
  if (samples.length === 0) return '';

  const examples = samples.map((sample) => `Example "${sample.title}" (${sample.orientation}):\n${sampleJson(sample)}`);

  return `Reference templates (match their quality and structure, not their copy):\n\n${examples.join('\n\n')}`;
}

export const REFERENCE_STYLE_HEADING =
  'Reference style guide (BINDING visual rules: they override the art direction and any theme hint where they ' +
  'conflict. They carry the reference\u2019s palette and pacing only: never reproduce its subjects, logos or text):';

/** The binding reference-style block (empty without rules), shared by the plan and template prompts. */
export function referenceBlock(rules: string | undefined): string[] {
  const trimmed = rules?.trim();

  return trimmed ? [`${REFERENCE_STYLE_HEADING}\n${trimmed}`] : [];
}

function fixedBlocks(input: PromptInput): string[] {
  return [
    OUTPUT_CONTRACT,
    BUILDER_CONSTRAINTS,
    artDirection(input.hints),
    STORY_SPINE,
    COMPOSE_MOTION,
    LAZY_DEFAULTS,
    `Engine catalog:\n${formatCatalog(input.catalog, input.hints.genre)}`,
    ...referenceBlock(input.referenceStyle),
  ];
}

// Drop samples (last first) until the whole schema fits, its descriptions trimmed if need be: a truncated
// schema costs more than a third example. The first sample stays unless even a minimal schema cannot fit.
function fittingSamples(
  fixedLength: number,
  samples: SampleDetail[],
  budget: number,
  schemaFloor: number
): SampleDetail[] {
  let kept = samples;

  while (kept.length > 1 && fixedLength + sampleBlock(kept).length + schemaFloor > budget) {
    kept = kept.slice(0, -1);
  }

  while (kept.length > 0 && fixedLength + sampleBlock(kept).length + MIN_SCHEMA > budget) {
    kept = kept.slice(0, -1);
  }

  return kept;
}

export function buildSystemPrompt(input: PromptInput): BuiltPrompt {
  const budget = input.budget ?? DEFAULT_PROMPT_BUDGET;
  const fixed = fixedBlocks(input);
  const fixedLength = fixed.join('\n\n').length;
  // The schema with every description dropped: the least it takes to arrive whole.
  const schemaFloor = Math.min(SCHEMA_CAP, compactSchema(input.schema, 0).length) + 200;
  const samples = fittingSamples(fixedLength, input.samples, budget, schemaFloor);
  const examples = sampleBlock(samples);
  // Headroom for the separators and the schema heading.
  const room = budget - fixedLength - examples.length - 200;
  const schema = fitSchema(input.schema, Math.max(0, Math.min(SCHEMA_CAP, room)));
  const blocks = [
    ...fixed,
    ...(examples ? [examples] : []),
    `Template JSON Schema (compacted; ${CLOSED_OBJECTS}):\n${schema.text}`,
  ];

  return {
    system: blocks.join('\n\n'),
    sampleIds: samples.map((sample) => sample.id),
    schemaTruncated: schema.truncated,
  };
}

function hintLines(hints: GenerationHints): string[] {
  const lines: string[] = [];

  if (hints.orientation) lines.push(`Orientation: ${hints.orientation} (set global.orientation to it).`);

  if (hints.durationSeconds) lines.push(`Target total duration: about ${String(hints.durationSeconds)} seconds.`);

  if (hints.platform && hints.platform !== 'none') {
    lines.push(`Platform: set global.platform to "${hints.platform}" and keep text out of its safe zones.`);
  }

  if (hints.genre) lines.push(`Genre: ${hints.genre} (follow its doctrine in the motion catalog).`);

  if (hints.theme) lines.push(`Theme: set global.theme to "${hints.theme}" and use its $color / $font tokens.`);

  if (hints.energy !== undefined) {
    const word = ENERGY_WORDS.at(Math.round(Math.max(0, Math.min(4, hints.energy))));
    lines.push(`Energy: ${word ?? 'balanced'}.`);
  }

  return lines;
}

export const TEMPLATE_REQUEST = 'Return the template JSON object now.';

export function buildUserBrief(prompt: string, hints: GenerationHints, request = TEMPLATE_REQUEST): string {
  const lines = hintLines(hints);
  const extra = lines.length > 0 ? `\n\n${lines.join('\n')}` : '';

  return `Brief: ${prompt.trim()}${extra}\n\n${request}`;
}
