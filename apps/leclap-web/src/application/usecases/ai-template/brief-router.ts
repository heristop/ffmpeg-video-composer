// Brief routing with a decision model (Jev): one call classifies the user's brief — genre, platform,
// orientation, energy, best seed sample, theme when the engine has themes — each with a calibrated
// confidence. Confident answers (≥ 0.5) are applied as defaults; the rest are shown as suggestions.
// Pure: the transport is injected as `ask`, so routing is unit-tested without a network.
import { motionCatalog } from 'ffmpeg-video-composer/src/core/motion/index.ts';
import { platformCatalog } from 'ffmpeg-video-composer/src/core/platforms.ts';
import type { SampleDetail } from 'ffmpeg-video-composer/src/samples/types.ts';
import type { CatalogEntry } from './engine-catalog';
import { isSeedCandidate } from './sample-picker';

// Typed questions as the AI SDK's evaluation API takes them: choice (a criteria map), score (2–10
// ordered levels) and boolean.
export type JevQuestion =
  | { type: 'choice'; instructions: string; criteria: Record<string, string | null> }
  | { type: 'score'; instructions: string; criteria: string[] }
  | { type: 'boolean'; instructions: string; criteria?: { true?: string | null; false?: string | null } };

// Answers, with Jev's calibrated confidence folded in by the adapter (booleans carry P(true) only).
export type JevAnswer =
  | { type: 'choice'; choice: string; confidence: number; probabilities?: Record<string, number> }
  | { type: 'score'; score: number; confidence: number; probabilities?: Record<string, number> }
  | { type: 'boolean'; probability: number };

export type JevAsk = (state: string, questions: Record<string, JevQuestion>) => Promise<Record<string, JevAnswer>>;

export interface Decision<T> {
  value: T;
  confidence: number;
  // Confident enough to apply by default; otherwise only suggested.
  applied: boolean;
  probabilities?: Record<string, number>;
}

export interface BriefRoute {
  genre?: Decision<string>;
  platform?: Decision<string>;
  orientation?: Decision<string>;
  energy?: Decision<number>;
  theme?: Decision<string>;
  seed?: Decision<string>;
}

export const CONFIDENCE_THRESHOLD = 0.5;
const MAX_SEEDS = 20;

// The engine's genre doctrines (their summaries describe each choice), plus "other".
export const GENRES: Record<string, string | null> = {
  ...Object.fromEntries(Object.entries(motionCatalog().doctrine).map(([genre, doctrine]) => [genre, doctrine.summary])),
  other: null,
};

// Delivery platforms straight from the engine's profiles (the same ids `global.platform` accepts),
// plus "none" for a brief with no destination.
export const PLATFORMS: Record<string, string | null> = {
  ...Object.fromEntries(
    platformCatalog().map((platform) => [platform.id, `${platform.title} (${platform.orientation})`])
  ),
  none: 'No platform is mentioned or implied',
};

export const ORIENTATIONS: Record<string, string | null> = {
  portrait: 'Vertical 9:16, for phone-first platforms and stories',
  landscape: 'Horizontal 16:9, for YouTube, websites and presentations',
  square: 'Square 1:1, for feed posts',
};

export const ENERGY_RUBRIC = [
  'Calm, slow and soothing',
  'Relaxed and gentle',
  'Balanced, steady pace',
  'Punchy and upbeat',
  'Explosive, fast and high-energy',
];

// The packaged samples Jev may pick as the starting point, keyed by id (capped for the request).
export function seedCandidates(samples: SampleDetail[]): SampleDetail[] {
  return samples.filter(isSeedCandidate).slice(0, MAX_SEEDS);
}

export function buildBriefQuestions(samples: SampleDetail[], themes?: CatalogEntry[]): Record<string, JevQuestion> {
  const seeds = seedCandidates(samples);
  const questions: Record<string, JevQuestion> = {
    genre: { type: 'choice', instructions: 'Which kind of video does this brief ask for?', criteria: GENRES },
    platform: { type: 'choice', instructions: 'Which platform is the video for?', criteria: PLATFORMS },
    orientation: {
      type: 'choice',
      instructions: 'Which frame orientation suits the video best?',
      criteria: ORIENTATIONS,
    },
    energy: { type: 'score', instructions: 'How energetic should the video feel?', criteria: ENERGY_RUBRIC },
  };

  if (themes && themes.length > 0) {
    questions.theme = {
      type: 'choice',
      instructions: 'Which visual theme fits the brief best?',
      criteria: Object.fromEntries(themes.map((theme) => [theme.id, theme.description ?? null])),
    };
  }

  if (seeds.length > 1) {
    questions.seed = {
      type: 'choice',
      instructions: 'Which existing template is the closest starting point for this brief?',
      criteria: Object.fromEntries(seeds.map((sample) => [sample.id, `${sample.title}: ${sample.description}`])),
    };
  }

  return questions;
}

function clamp01(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

// A choice answer → a decision, only when its label is one we asked about.
export function choiceDecision(answer: JevAnswer | undefined, allowed: string[]): Decision<string> | undefined {
  if (answer?.type !== 'choice' || !allowed.includes(answer.choice)) return undefined;

  const confidence = clamp01(answer.confidence);

  return {
    value: answer.choice,
    confidence,
    applied: confidence >= CONFIDENCE_THRESHOLD,
    probabilities: answer.probabilities,
  };
}

export function scoreDecision(answer: JevAnswer | undefined, max: number): Decision<number> | undefined {
  if (answer?.type !== 'score' || !Number.isFinite(answer.score)) return undefined;

  const confidence = clamp01(answer.confidence);

  return { value: Math.max(0, Math.min(max, answer.score)), confidence, applied: confidence >= CONFIDENCE_THRESHOLD };
}

export function interpretAnswers(
  answers: Record<string, JevAnswer>,
  questions: Record<string, JevQuestion>
): BriefRoute {
  const labels = (name: string): string[] => {
    const question = questions[name] as JevQuestion | undefined;

    return question?.type === 'choice' ? Object.keys(question.criteria) : [];
  };

  return {
    genre: choiceDecision(answers.genre, labels('genre')),
    platform: choiceDecision(answers.platform, labels('platform')),
    orientation: choiceDecision(answers.orientation, labels('orientation')),
    energy: scoreDecision(answers.energy, ENERGY_RUBRIC.length - 1),
    theme: choiceDecision(answers.theme, labels('theme')),
    seed: choiceDecision(answers.seed, labels('seed')),
  };
}

export async function routeBrief(
  prompt: string,
  samples: SampleDetail[],
  ask: JevAsk,
  themes?: CatalogEntry[]
): Promise<BriefRoute> {
  const questions = buildBriefQuestions(samples, themes);

  return interpretAnswers(await ask(prompt.trim(), questions), questions);
}

// The best sample to open as-is: Jev's pick, unless a confident orientation disagrees — then the
// most probable seed in that orientation (Jev returns a probability per candidate).
export function bestSeed(route: BriefRoute, samples: SampleDetail[]): SampleDetail | undefined {
  const pick = samples.find((sample) => sample.id === route.seed?.value);
  const orientation = route.orientation?.applied ? route.orientation.value : undefined;

  if (!orientation || pick?.orientation === orientation) return pick;

  const probabilities = route.seed?.probabilities ?? {};
  const matching = seedCandidates(samples).filter((sample) => sample.orientation === orientation);
  const ranked = matching.toSorted((a, b) => (probabilities[b.id] ?? 0) - (probabilities[a.id] ?? 0));

  return ranked.at(0) ?? pick;
}
