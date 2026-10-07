import catalog from '../../../../../../examples/showcase/catalog.json';

export const CATEGORIES = ['all', 'templates', 'typography', 'effects', 'overlays', 'app-demos', 'evidence'] as const;
export type ShowcaseCategory = (typeof CATEGORIES)[number];
export type ShowcaseSample = {
  id: string;
  title: string;
  description: string;
  category: Exclude<ShowcaseCategory, 'all'>;
  source: string;
  section?: string;
};

export const SHOWCASE_SAMPLES = catalog.samples as ShowcaseSample[];

export function validCategory(value: string | null): ShowcaseCategory {
  return CATEGORIES.find((category) => category === value) ?? 'all';
}

// The film the showcase opens on (and falls back to for an unknown id): the tour of every effect.
const DEFAULT_SAMPLE_ID = 'effects-tour';

export function selectedSample(id: string | null): ShowcaseSample {
  return (
    SHOWCASE_SAMPLES.find((sample) => sample.id === id) ??
    SHOWCASE_SAMPLES.find((sample) => sample.id === DEFAULT_SAMPLE_ID) ??
    SHOWCASE_SAMPLES[0]
  );
}

export function filterSamples(category: ShowcaseCategory, query: string): ShowcaseSample[] {
  const needle = query.trim().toLowerCase();

  return SHOWCASE_SAMPLES.filter(
    (sample) =>
      (category === 'all' || sample.category === category) &&
      `${sample.title} ${sample.description}`.toLowerCase().includes(needle)
  );
}

export function mediaPath(sample: ShowcaseSample, extension: 'mp4' | 'webp' | 'json'): string {
  return `/videos/showcase/${sample.id}.${extension}`;
}
