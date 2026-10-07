// The planning call: brief → compact JSON plan, with one repair turn when the plan does not check
// out. Resolves null when the plan still fails, so generation can carry on without one rather than
// stopping the run over an optional step. Provider errors (abort, auth…) propagate unchanged.
import type { ChatMessage, TemplateModelProvider } from './model-provider';
import { parsePlan, type PlanVocabulary, type TemplatePlan } from './plan';
import { planRepairMessage } from './plan-prompt';
import { buildUserBrief, type GenerationHints } from './system-prompt';

export interface PlanTemplateInput {
  provider: TemplateModelProvider;
  model: string;
  apiKey: string;
  system: string;
  prompt: string;
  hints: GenerationHints;
  vocabulary?: PlanVocabulary;
  signal?: AbortSignal;
  onProgress?: (receivedChars: number) => void;
}

export const PLAN_REQUEST = 'Return the plan JSON object now.';

async function ask(input: PlanTemplateInput, messages: ChatMessage[]): Promise<string> {
  return input.provider.generate({
    system: input.system,
    messages,
    model: input.model,
    apiKey: input.apiKey,
    signal: input.signal,
    onProgress: input.onProgress,
  });
}

export async function planTemplate(input: PlanTemplateInput): Promise<TemplatePlan | null> {
  const first: ChatMessage[] = [{ role: 'user', content: buildUserBrief(input.prompt, input.hints, PLAN_REQUEST) }];
  const reply = await ask(input, first);
  const parsed = parsePlan(reply, input.vocabulary);

  if (parsed.ok) return parsed.plan;

  const retry = await ask(input, [
    ...first,
    { role: 'assistant', content: reply },
    { role: 'user', content: planRepairMessage(parsed.errors) },
  ]);
  const repaired = parsePlan(retry, input.vocabulary);

  return repaired.ok ? repaired.plan : null;
}
