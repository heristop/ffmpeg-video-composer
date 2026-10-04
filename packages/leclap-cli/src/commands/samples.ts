import { writeFile } from 'node:fs/promises';
import { defineCommand } from 'citty';
import { getSample, listSamples, type SampleDetail, type SampleFilters } from 'ffmpeg-video-composer/samples';
import { wordmark } from '../theme.js';
import { fail, hint, success } from '../ui.js';

function reportError(error: unknown): void {
  console.error(fail(error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
}

function formatDetail(sample: SampleDetail): string {
  const { requirements } = sample;
  const groups = [
    ['Project video clips', requirements.projectVideos],
    ['Form fields', requirements.formFields],
    ['Variables and defaults', requirements.variables],
    ['Referenced assets (media is not bundled)', requirements.assets],
  ] as const;

  return [
    `${sample.title} (${sample.id})`,
    `${sample.category} · ${sample.orientation} · ${sample.backend}`,
    sample.description,
    ...(sample.creativeDirection ? ['\nCreative direction:', sample.creativeDirection] : []),
    ...groups.flatMap(([title, items]) => [
      `\n${title}:`,
      ...(items.length > 0 ? items.map((item) => `  ${JSON.stringify(item)}`) : ['  None']),
    ]),
    '\nRegistered effects:',
    ...(requirements.effects.length > 0
      ? requirements.effects.map(
          (effect) =>
            `  ${effect.id}@${effect.version} — sections: ${effect.sections.join(', ')}${effect.customCatalog ? ' — requires operator catalog registration' : ''}`
        )
      : ['  None']),
    '\nSetup:',
    ...requirements.setup.map((step) => `  ${step}`),
    '\nExport this descriptor, customize its media and fields, then validate before rendering.',
    `  leclap samples export ${sample.id} --output ${sample.id}.json`,
  ].join('\n');
}

const list = defineCommand({
  meta: { name: 'list', description: 'Discover packaged showcase samples and their required inputs' },
  args: {
    category: { type: 'string', description: 'templates, typography, app-demos, overlays or evidence' },
    backend: { type: 'string', description: 'native or remotion' },
    query: { type: 'string', description: 'Search ID, title, description and creative direction' },
    json: { type: 'boolean', description: 'Emit sample metadata as JSON', default: false },
  },
  run({ args }) {
    try {
      const found = listSamples({ category: args.category, backend: args.backend, query: args.query } as SampleFilters);

      if (args.json) {
        process.stdout.write(`${JSON.stringify(found, null, 2)}\n`);

        return;
      }

      process.stdout.write(wordmark());
      process.stdout.write(
        `${found.length} samples\n${found
          .map(
            (sample) =>
              `${sample.id} — ${sample.title} [${sample.category}, ${sample.orientation}, ${sample.backend}]\n  ${sample.description}`
          )
          .join('\n')}\n`
      );
      console.log(hint('Use leclap samples show <id> for creative direction and required inputs.'));
    } catch (error) {
      reportError(error);
    }
  },
});

const show = defineCommand({
  meta: { name: 'show', description: 'Inspect a sample descriptor, creative direction and requirements' },
  args: {
    id: { type: 'positional', description: 'Stable sample ID from samples list', required: true },
    json: { type: 'boolean', description: 'Emit metadata and the descriptor as JSON', default: false },
  },
  run({ args }) {
    try {
      const sample = getSample(args.id);
      process.stdout.write(
        args.json ? `${JSON.stringify(sample, null, 2)}\n` : `${wordmark()}${formatDetail(sample)}\n`
      );
    } catch (error) {
      reportError(error);
    }
  },
});

const exportSample = defineCommand({
  meta: { name: 'export', description: 'Export a self-contained descriptor JSON without media or rendering' },
  args: {
    id: { type: 'positional', description: 'Stable sample ID from samples list', required: true },
    output: { type: 'string', alias: 'o', description: 'Create a new JSON file; existing files are never overwritten' },
  },
  async run({ args }) {
    try {
      const descriptor = `${JSON.stringify(getSample(args.id).template, null, 2)}\n`;

      if (args.output === undefined) {
        process.stdout.write(descriptor);

        return;
      }

      await writeFile(args.output, descriptor, { flag: 'wx' });
      console.error(success(`Exported to ${args.output}`));
    } catch (error) {
      reportError(error);
    }
  },
});

export const samples = defineCommand({
  meta: { name: 'samples', description: 'Discover, inspect and export packaged showcase samples' },
  subCommands: { list, show, export: exportSample },
});
