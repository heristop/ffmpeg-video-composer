// Picks the packaged sample templates that make the best few-shot examples for a brief. Only
// samples the builder can open qualify (native backend, no registered-effect sections), and each must
// be compact enough to leave room for the schema. Scoring is plain keyword overlap with the sample's
// title, description and creative direction — deterministic, cheap and good enough to seed style.
import type { SampleDetail } from 'ffmpeg-video-composer/src/samples/types.ts';

// The sample categories that read as whole videos (overlays are single-effect demos).
export const SEED_CATEGORIES = new Set(['templates', 'typography', 'evidence']);
const MAX_SAMPLE_CHARS = 8000;
const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'a', 'an', 'of', 'to', 'in', 'on', 'my', 'our', 'your']);

export function isSeedCandidate(sample: SampleDetail): boolean {
  return (
    sample.backend === 'native' &&
    SEED_CATEGORIES.has(sample.category) &&
    !(sample.template.sections ?? []).some((section) => section.type === 'effect')
  );
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

export function scoreSample(prompt: string, sample: SampleDetail): number {
  const haystack = new Set(
    words(`${sample.id} ${sample.title} ${sample.description} ${sample.creativeDirection ?? ''}`)
  );

  return words(prompt).reduce((score, word) => score + (haystack.has(word) ? 1 : 0), 0);
}

export function sampleJson(sample: SampleDetail): string {
  return JSON.stringify(sample.template);
}

interface PickOptions {
  max?: number;
  // Ids chosen upstream (e.g. by the brief router) go first, in order.
  preferIds?: string[];
  orientation?: string;
}

function orientationBonus(sample: SampleDetail, orientation: string | undefined): number {
  return orientation && sample.orientation === orientation ? 0.5 : 0;
}

export function pickSamples(prompt: string, samples: SampleDetail[], options: PickOptions = {}): SampleDetail[] {
  const max = options.max ?? 2;
  const eligible = samples.filter((sample) => isSeedCandidate(sample) && sampleJson(sample).length <= MAX_SAMPLE_CHARS);
  const preferred = (options.preferIds ?? [])
    .map((id) => eligible.find((sample) => sample.id === id))
    .filter((sample): sample is SampleDetail => sample !== undefined);
  const ranked = eligible
    .filter((sample) => !preferred.includes(sample))
    .map((sample) => ({
      sample,
      score: scoreSample(prompt, sample) + orientationBonus(sample, options.orientation),
    }))
    .toSorted((a, b) => b.score - a.score)
    .map((entry) => entry.sample);

  return [...preferred, ...ranked].slice(0, max);
}
