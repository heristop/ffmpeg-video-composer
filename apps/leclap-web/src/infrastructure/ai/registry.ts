// The text-generation providers offered by "Generate with AI". Adding one is a single adapter file
// implementing TemplateModelProvider plus one line here; the dialog, key storage and pipeline pick
// it up from this list.
import type { TemplateModelProvider } from '@/application/usecases/ai-template/model-provider';
import { anthropicProvider } from './anthropic-provider';
import { openAiProvider } from './openai-provider';

export const TEMPLATE_MODEL_PROVIDERS: readonly TemplateModelProvider[] = [anthropicProvider, openAiProvider];

export function findProvider(id: string): TemplateModelProvider {
  return TEMPLATE_MODEL_PROVIDERS.find((provider) => provider.id === id) ?? anthropicProvider;
}
