import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { footageUrl } from './media.ts';
import { sanitize } from './sanitize.ts';
import type { Format, Json, JsonObject, RenderJob, ReviewOptions } from './types.ts';

// Bundled templates: one sheet each, six moments spread over the whole video. The shared partials are
// injected into the descriptor (the engine expands `descriptor.partials`), every project_video section
// is fed the footage stand-in, and LFS media go through the same sanitizer as the fixtures.

// The six legacy overlay recipes on synthetic shapes (all APNG layers): a template-shaped seed.
const SEED = 'examples/overlay-effects/preview-template.json';
const SEED_NAMES: Record<string, string | undefined> = { 'overlay-effects': 'overlay-effects-preview' };

const TEMPLATE_MOMENTS = ['8%', '25%', '42%', '58%', '75%', '92%'];

function readJson(file: string): JsonObject {
  return JSON.parse(readFileSync(file, 'utf8')) as JsonObject;
}

function jsonFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort();
}

function partials(kitDir: string): Map<string, JsonObject> {
  const dir = path.join(kitDir, 'src/partials');

  return new Map(jsonFiles(dir).map((file) => [path.basename(file, '.json'), readJson(path.join(dir, file))]));
}

function refsOf(sections: Json | undefined): string[] {
  const list = Array.isArray(sections) ? (sections as JsonObject[]) : [];

  return list
    .map((section) => (section.type === 'partial' ? section.ref : null))
    .filter((ref) => typeof ref === 'string');
}

/** Only the partials the template uses (nested refs included), so the notes describe this template. */
function usedPartials(descriptor: JsonObject, registry: Map<string, JsonObject>): Json[] {
  const used = new Map<string, JsonObject>();
  const queue = refsOf(descriptor.sections);

  for (let ref = queue.shift(); ref !== undefined; ref = queue.shift()) {
    const partial = registry.get(ref);

    if (partial && !used.has(ref)) {
      used.set(ref, partial);
      queue.push(...refsOf(partial.sections));
    }
  }

  return [...used].map(([id, partial]) => ({ id, ...partial }));
}

function orientation(descriptor: JsonObject): Format {
  const global = descriptor.global as JsonObject | undefined;
  const value = global?.orientation;

  return value === 'portrait' || value === 'square' ? value : 'landscape';
}

function projectVideoNames(descriptor: JsonObject): string[] {
  const sections = Array.isArray(descriptor.sections) ? descriptor.sections : [];

  return sections
    .map((section) => section as JsonObject)
    .map((section) => (section.type === 'project_video' ? section.name : null))
    .filter((name): name is string => typeof name === 'string');
}

// Every form field is filled with its English label (cut to maxLength), so text renders at a realistic
// length instead of the raw {{ placeholder }}.
function fieldArgs(descriptor: JsonObject): string[] {
  const sections = Array.isArray(descriptor.sections) ? (descriptor.sections as JsonObject[]) : [];
  const fields = sections
    .filter((section) => section.type === 'form')
    .flatMap((section) => ((section.options as JsonObject | undefined)?.fields ?? []) as JsonObject[]);

  return fields.flatMap((field) => {
    const name = typeof field.name === 'string' ? field.name : '';
    const label = (field.label as JsonObject | undefined)?.en;
    const value = typeof label === 'string' ? label : name;
    const max = typeof field.maxLength === 'number' ? field.maxLength : value.length;

    return name ? ['--field', `${name}=${value.slice(0, max)}`] : [];
  });
}

function templateJob(
  file: string,
  kitPartials: Map<string, JsonObject>,
  options: ReviewOptions,
  stage: string
): RenderJob {
  const name = SEED_NAMES[path.basename(path.dirname(file))] ?? path.basename(file, '.json');
  const raw = readJson(file);
  const format = orientation(raw);
  const clean = sanitize({ ...raw, partials: usedPartials(raw, kitPartials) }, options.assets, format);
  const videos = projectVideoNames(raw);
  const footage = path.join(stage, footageUrl(format).slice('/assets/'.length));

  return {
    key: `template__${name}`,
    group: 'template',
    title: name,
    kind: 'template',
    descriptor: clean.descriptor,
    at: TEMPLATE_MOMENTS,
    args: [...videos.flatMap((section) => ['--video', `${section}=${footage}`]), ...fieldArgs(raw)],
    notes: [...clean.notes, ...videos.map((section) => `${section}: footage stand-in`)],
  };
}

/** One job per bundled template of the creative kit at `repoRoot`, plus the overlay-effects seed. */
export function templateJobs(repoRoot: string, options: ReviewOptions, stage: string): RenderJob[] {
  const kitDir = path.join(repoRoot, 'packages/leclap-creative-kit');
  const dir = path.join(kitDir, 'src/templates');
  const kitPartials = partials(kitDir);
  const seed = path.join(repoRoot, SEED);
  const files = [...jsonFiles(dir).map((file) => path.join(dir, file)), ...(existsSync(seed) ? [seed] : [])];

  return files.map((file) => templateJob(file, kitPartials, options, stage));
}
