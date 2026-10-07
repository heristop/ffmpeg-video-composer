// Anthropic Messages API over the AI SDK, called straight from the browser with the user's own key.
// Streams the reply so the dialog can show live progress. The system prompt is marked cacheable:
// repair rounds resend it unchanged, so they are billed at the cache-read rate.
import { createAnthropic } from '@ai-sdk/anthropic';
import type { GenerateRequest, TemplateModelProvider } from '@/application/usecases/ai-template/model-provider';
import { browserFetch } from './browser-fetch';
import { streamGeneration } from './stream-generation';

export const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MAX_OUTPUT_TOKENS = 32_000;

// The provider has no dedicated browser-access setting, so the opt-in header is passed explicitly.
export function anthropicModel(request: GenerateRequest, fetch?: typeof globalThis.fetch) {
  const anthropic = createAnthropic({
    apiKey: request.apiKey,
    headers: { 'anthropic-dangerous-direct-browser-access': 'true' },
    fetch: browserFetch(fetch),
  });

  return anthropic.messages(request.model);
}

export function generateWithAnthropic(request: GenerateRequest, fetch?: typeof globalThis.fetch): Promise<string> {
  return streamGeneration(anthropicModel(request, fetch), request, {
    instructions: {
      role: 'system',
      content: request.system,
      providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
    },
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  });
}

export const anthropicProvider: TemplateModelProvider = {
  id: 'anthropic',
  label: 'Anthropic (Claude)',
  defaultModel: 'claude-opus-5-5',
  models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5-20251001'],
  looksLikeKey: (key) => key.startsWith('sk-ant-') && key.length > 20,
  keyPlaceholder: 'sk-ant-…',
  keyUrl: 'https://console.anthropic.com/settings/keys',
  generate: (request) => generateWithAnthropic(request),
};
