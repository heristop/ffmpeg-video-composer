import 'reflect-metadata';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDescriptor } from '../../../examples/showcase/load-descriptor';
import { TemplateValidator } from '../src/services/TemplateValidator';
import { expandPartials } from '../src/core/partials';
import { SAMPLE_CATEGORIES, type SampleCategory, type SampleDetail } from '../src/samples/types';
import { sampleRequirements } from './sample-metadata';

interface CatalogSample {
  id: string;
  title: string;
  description: string;
  category: SampleCategory;
  source: string;
  section?: string;
}

const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = path.join(root, 'packages/ffmpeg-video-composer/src/samples/generated.json');
const validator = new TemplateValidator();

async function buildSample(sample: CatalogSample): Promise<SampleDetail> {
  const template = await loadDescriptor(root, sample);
  const result = validator.validateTemplate(template);

  if (!result.success) throw new Error(`${sample.id}: ${JSON.stringify(result.errors)}`);
  const requirements = sampleRequirements(expandPartials(template));

  return {
    ...sample,
    orientation: template.global?.orientation ?? 'landscape',
    backend: requirements.effects.length > 0 ? 'remotion' : 'native',
    creativeDirection: template.meta?.creativeDirection,
    showcasePath: `/showcase?sample=${sample.id}`,
    preview: {
      video: `/videos/showcase/${sample.id}.mp4`,
      poster: `/videos/showcase/${sample.id}.webp`,
      template: `/videos/showcase/${sample.id}.json`,
    },
    requirements,
    template,
  };
}

async function generate(): Promise<void> {
  const catalog: { schemaVersion: number; samples: CatalogSample[] } = JSON.parse(
    await fs.readFile(path.join(root, 'examples/showcase/catalog.json'), 'utf8')
  );
  const ids = new Set<string>();

  for (const sample of catalog.samples) {
    if (ids.has(sample.id)) throw new Error(`Duplicate sample ID: ${sample.id}`);

    if (!SAMPLE_CATEGORIES.includes(sample.category)) {
      throw new Error(`Invalid category for ${sample.id}: ${sample.category}`);
    }
    ids.add(sample.id);
  }
  const samples = await Promise.all(catalog.samples.map(buildSample));

  if (process.argv.includes('--check')) {
    const current = JSON.parse(await fs.readFile(output, 'utf8'));
    // Formatting can be applied by vp; compare canonical JSON rather than whitespace.
    if (JSON.stringify(current) !== JSON.stringify(samples)) {
      throw new Error(
        'Packaged samples are stale. Run pnpm --filter ffmpeg-video-composer generate:samples and commit the generated registry.'
      );
    }
    console.log(`Packaged samples are fresh (${samples.length} entries).`);

    return;
  }
  await fs.writeFile(output, `${JSON.stringify(samples, null, 2)}\n`);
  console.log(`Generated ${samples.length} packaged samples.`);
}

await generate();
