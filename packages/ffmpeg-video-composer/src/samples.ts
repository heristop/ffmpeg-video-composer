import registry from './samples/generated.json';
import {
  SAMPLE_BACKENDS,
  SAMPLE_CATEGORIES,
  type SampleDetail,
  type SampleFilters,
  type SampleSummary,
} from './samples/types';

export * from './samples/types';

const samples = registry as SampleDetail[];
const byId = new Map(samples.map((sample) => [sample.id, sample]));

/** Discover samples without loading the renderer or accessing media. Returns independent copies. */
export function listSamples(filters: SampleFilters = {}): SampleSummary[] {
  if (filters.category !== undefined && !SAMPLE_CATEGORIES.includes(filters.category)) {
    throw new Error(`Invalid sample category: ${filters.category}. Choose ${SAMPLE_CATEGORIES.join(', ')}.`);
  }

  if (filters.backend !== undefined && !SAMPLE_BACKENDS.includes(filters.backend)) {
    throw new Error(`Invalid sample backend: ${filters.backend}. Choose ${SAMPLE_BACKENDS.join(', ')}.`);
  }

  if (filters.query !== undefined && typeof filters.query !== 'string') {
    throw new Error('Invalid sample query: expected a string.');
  }
  const query = filters.query?.trim().toLowerCase() ?? '';

  return samples
    .filter(
      (sample) =>
        (!filters.category || sample.category === filters.category) &&
        (!filters.backend || sample.backend === filters.backend) &&
        (!query ||
          [sample.id, sample.title, sample.description, sample.creativeDirection ?? ''].some((text) =>
            text.toLowerCase().includes(query)
          ))
    )
    .map(({ template: _template, ...summary }) => structuredClone(summary));
}

/** Retrieve a descriptor and its requirements by stable catalog ID. Returns an independent copy. */
export function getSample(id: string): SampleDetail {
  const sample = byId.get(id);

  if (!sample) throw new Error(`Unknown sample: ${id}. Use listSamples() to discover available IDs.`);

  return structuredClone(sample);
}
