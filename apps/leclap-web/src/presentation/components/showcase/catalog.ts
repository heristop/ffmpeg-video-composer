import catalog from '../../../../../../examples/showcase/catalog.json';
import previews from '../../../../public/videos/showcase/manifest.json';
import type { FilmShape } from '@/presentation/components/film-frame';

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

// The HTML-layer samples, listed together right after Type impact. The catalog keeps its own order, which the
// CLI and the MCP list too; only the library here moves them up.
export const HTML_SAMPLE_IDS: readonly string[] = ['html-card', 'html-testimonial', 'html-speaker', 'html-stats'];
export const HTML_SAMPLES_AFTER = 'type-impact';

// `ids`, in their listed order, moved to just after `anchor`; every other sample keeps catalog order. Missing
// ids are skipped, and without the anchor the catalog order is kept.
export function placeAfter(samples: ShowcaseSample[], ids: readonly string[], anchor: string): ShowcaseSample[] {
  const moved = ids.flatMap((id) => samples.filter((sample) => sample.id === id));
  const rest = samples.filter((sample) => !ids.includes(sample.id));
  const at = rest.findIndex((sample) => sample.id === anchor);

  if (at === -1 || moved.length === 0) return samples;

  return [...rest.slice(0, at + 1), ...moved, ...rest.slice(at + 1)];
}

export const LIBRARY_SAMPLES = placeAfter(SHOWCASE_SAMPLES, HTML_SAMPLE_IDS, HTML_SAMPLES_AFTER);

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

  return LIBRARY_SAMPLES.filter(
    (sample) =>
      (category === 'all' || sample.category === category) &&
      `${sample.title} ${sample.description}`.toLowerCase().includes(needle)
  );
}

export function mediaPath(sample: ShowcaseSample, extension: 'mp4' | 'webp' | 'json'): string {
  return `/videos/showcase/${sample.id}.${extension}`;
}

// Every preview is letterboxed into 16:9 (examples/showcase/render-previews.mjs); the manifest keeps the
// orientation each sample was made in, so a player can size its screen to the film rather than the letterbox.
const SHAPES = new Map(previews.samples.map((preview) => [preview.id, preview.orientation]));

export function sampleShape(sample: ShowcaseSample): FilmShape {
  const shape = SHAPES.get(sample.id);

  return shape === 'portrait' || shape === 'square' ? shape : 'landscape';
}

// Width over height of each shape, for sizing a screen to fit the viewport.
export const SHAPE_RATIO: Record<FilmShape, number> = { landscape: 16 / 9, portrait: 9 / 16, square: 1 };

// Rendered by the engine from native JSON, or by Remotion through the JSON effects example.
export function isNative(sample: ShowcaseSample): boolean {
  return !sample.source.includes('llm-remotion-title');
}
