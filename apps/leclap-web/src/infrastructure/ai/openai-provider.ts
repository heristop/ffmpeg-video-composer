// OpenAI Chat Completions over the AI SDK, called from the browser with the user's own key, in JSON
// mode and streamed for live progress. The model id is free text because OpenAI's catalogue moves
// fast — an unknown id is passed through and the API decides.
import { createOpenAI } from '@ai-sdk/openai';
import { Output } from 'ai';
import type { GenerateRequest, TemplateModelProvider } from '@/application/usecases/ai-template/model-provider';
import { browserFetch } from './browser-fetch';
import { streamGeneration } from './stream-generation';

export const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

export function openAiModel(request: GenerateRequest, fetch?: typeof globalThis.fetch) {
  return createOpenAI({ apiKey: request.apiKey, fetch: browserFetch(fetch) }).chat(request.model);
}

export function generateWithOpenAi(request: GenerateRequest, fetch?: typeof globalThis.fetch): Promise<string> {
  // Output.json() asks the API for a JSON object (`response_format: json_object`); the raw text is
  // still returned and parsed by the pipeline, which tolerates and repairs it.
  return streamGeneration(openAiModel(request, fetch), request, {
    instructions: request.system,
    output: Output.json(),
  });
}

export const openAiProvider: TemplateModelProvider = {
  id: 'openai',
  label: 'OpenAI',
  defaultModel: 'gpt-5',
  models: ['gpt-5', 'gpt-5-mini', 'gpt-4.1'],
  freeformModel: true,
  looksLikeKey: (key) => key.startsWith('sk-') && !key.startsWith('sk-ant-') && key.length > 20,
  keyPlaceholder: 'sk-…',
  keyUrl: 'https://platform.openai.com/api-keys',
  generate: (request) => generateWithOpenAi(request),
};
