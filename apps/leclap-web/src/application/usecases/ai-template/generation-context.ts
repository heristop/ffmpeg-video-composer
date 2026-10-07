// Gathers the engine's public material the prompt is built from — the template JSON Schema, the
// packaged sample catalogue and the effect/media vocabulary — once, lazily. This module pulls in the
// ~300 KB sample registry, so it is only imported by the (lazy) Generate-with-AI dialog.
import { templateDescriptorJsonSchema } from 'ffmpeg-video-composer/src/schemas/template.schemas.ts';
import { getSample, listSamples } from 'ffmpeg-video-composer/src/samples.ts';
import type { SampleDetail } from 'ffmpeg-video-composer/src/samples/types.ts';
import { ANIMATION_LIBRARY, MUSIC_LIBRARY } from '@/data/mediaCatalog';
import { buildEngineCatalog, type EngineCatalog } from './engine-catalog';
import { promptSchema } from './prompt-schema';
import { isSeedCandidate, pickSamples } from './sample-picker';
import { buildSystemPrompt, type BuiltPrompt, type GenerationHints } from './system-prompt';

export interface GenerationContext {
  schema: unknown;
  samples: SampleDetail[];
  catalog: EngineCatalog;
}

let cached: GenerationContext | null = null;

export function generationContext(): GenerationContext {
  cached ??= {
    schema: promptSchema(templateDescriptorJsonSchema),
    samples: listSamples()
      .map((summary) => getSample(summary.id))
      .filter(isSeedCandidate),
    catalog: buildEngineCatalog({
      music: MUSIC_LIBRARY.map((track) => track.file),
      animations: ANIMATION_LIBRARY.map((animation) => animation.file),
    }),
  };

  return cached;
}

// The system prompt for one brief: the two most relevant samples (router picks first) as examples,
// plus the binding rules of an attached reference style guide.
export function promptFor(
  prompt: string,
  hints: GenerationHints,
  preferSampleIds: string[] = [],
  referenceStyle?: string
): BuiltPrompt {
  const context = generationContext();
  const samples = pickSamples(prompt, context.samples, {
    max: 2,
    preferIds: preferSampleIds,
    orientation: hints.orientation,
  });

  return buildSystemPrompt({ schema: context.schema, catalog: context.catalog, samples, hints, referenceStyle });
}
