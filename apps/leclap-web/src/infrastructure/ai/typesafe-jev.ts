// Jev (TypeSafe AI) over the AI SDK's evaluation API. Jev does not write text: it answers typed
// questions — choice, score, yes/no — about a `state` with calibrated probabilities. The builder
// uses it as a decision provider (brief routing, best-match picking), never to write the template.
// The key travels only in the Authorization header. Browser (CORS) support for this API is not
// confirmed; a blocked call surfaces as a 'network' ProviderError the UI explains.
import { createTypeSafeAi } from '@ai-sdk/typesafe-ai';
import { experimental_evaluate as evaluate, type Experimental_EvaluationAnswer as EvaluationAnswer } from 'ai';
import type { JevAnswer, JevAsk, JevQuestion } from '@/application/usecases/ai-template/brief-router';
import { browserFetch } from './browser-fetch';
import { toProviderError } from './provider-errors';

export const JEV_URL = 'https://api.typesafe.ai/v1/systemone';
export const JEV_MODEL = 'jev-latest';
export const JEV_KEY_ID = 'jev';
export const JEV_KEY_URL = 'https://typesafe.ai';

export interface JevRequest {
  apiKey: string;
  state: string;
  questions: Record<string, JevQuestion>;
  signal?: AbortSignal;
  model?: string;
  fetch?: typeof globalThis.fetch;
}

type SdkAnswer = EvaluationAnswer<JevQuestion>;

function readConfidence(metadata: unknown): Record<string, number> {
  const confidence = (metadata as { typesafe?: { confidence?: unknown } } | undefined)?.typesafe?.confidence;

  return confidence && typeof confidence === 'object' ? (confidence as Record<string, number>) : {};
}

// The SDK keeps Jev's per-question confidence in provider metadata; fold it back into each answer.
export function withConfidence(answers: Record<string, SdkAnswer>, metadata: unknown): Record<string, JevAnswer> {
  const confidence = readConfidence(metadata);

  return Object.fromEntries(
    Object.entries(answers).map(([id, answer]) => [
      id,
      answer.type === 'boolean' ? answer : { ...answer, confidence: confidence[id] ?? 0 },
    ])
  );
}

export async function askJev(request: JevRequest): Promise<Record<string, JevAnswer>> {
  const typesafe = createTypeSafeAi({ apiKey: request.apiKey, fetch: browserFetch(request.fetch) });

  try {
    const result = await evaluate({
      model: typesafe.evaluationModel(request.model ?? JEV_MODEL),
      state: request.state,
      questions: request.questions,
      abortSignal: request.signal,
      maxRetries: 0,
    });

    return withConfidence(result.answers, result.providerMetadata);
  } catch (error) {
    throw toProviderError(error, request.signal);
  }
}

// Bind a key (and an abort signal) into the `ask` function the pure router expects.
export function jevAsker(apiKey: string, signal?: AbortSignal, fetch?: typeof globalThis.fetch): JevAsk {
  return (state, questions) => askJev({ apiKey, state, questions, signal, fetch });
}
