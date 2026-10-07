// The two halves of a Generate-with-AI run, outside React so the hook stays small: the optional
// planning call, and the template call that follows the (possibly edited) plan.
import { summarizeDescriptor } from '@/application/usecases/ai-template/descriptor-summary';
import { generateTemplate } from '@/application/usecases/ai-template/generate-template';
import { generationContext, promptFor } from '@/application/usecases/ai-template/generation-context';
import type { TemplateModelProvider } from '@/application/usecases/ai-template/model-provider';
import type { TemplatePlan } from '@/application/usecases/ai-template/plan';
import { buildPlanPrompt, planVocabulary } from '@/application/usecases/ai-template/plan-prompt';
import { planTemplate } from '@/application/usecases/ai-template/plan-template';
import type { GenerationHints } from '@/application/usecases/ai-template/system-prompt';
import type { RunAction } from './ai-generation.logic';

export interface GenerateArgs {
  provider: TemplateModelProvider;
  model: string;
  apiKey: string;
  brief: string;
  hints: GenerationHints;
  preferSampleIds: string[];
  // Plan first (one extra, small call), and stop to review the plan before writing.
  planFirst?: boolean;
  reviewPlan?: boolean;
  // Binding keep / avoid rules from an analysed reference ("Match a reference").
  referenceStyle?: string;
}

type Dispatch = (action: RunAction) => void;

export const NO_PLAN_WARNING = "Planning didn't return a usable plan, so the template was written without one.";

function live(signal: AbortSignal, dispatch: Dispatch): Dispatch {
  return (action) => {
    if (!signal.aborted) dispatch(action);
  };
}

export function requestPlan(args: GenerateArgs, signal: AbortSignal, dispatch: Dispatch): Promise<TemplatePlan | null> {
  const { catalog } = generationContext();
  const send = live(signal, dispatch);

  return planTemplate({
    provider: args.provider,
    model: args.model,
    apiKey: args.apiKey,
    system: buildPlanPrompt(catalog, args.hints, args.referenceStyle),
    prompt: args.brief,
    hints: args.hints,
    vocabulary: planVocabulary(catalog),
    signal,
    onProgress: (receivedChars) => {
      send({ type: 'phase', phase: { kind: 'planning', receivedChars } });
    },
  });
}

// The plan's theme and platform become hints, so the system prompt's art direction matches them. An
// attached reference style owns the theme, so the plan's built-in theme pick is ignored then.
export function hintsWithPlan(
  hints: GenerationHints,
  plan: TemplatePlan | null,
  referenceStyle?: string
): GenerationHints {
  if (!plan) return hints;

  return {
    ...hints,
    ...(plan.theme && !referenceStyle ? { theme: plan.theme } : {}),
    ...(plan.platform ? { platform: plan.platform } : {}),
  };
}

export async function writeTemplate(
  args: GenerateArgs,
  plan: TemplatePlan | null,
  signal: AbortSignal,
  dispatch: Dispatch
): Promise<void> {
  const send = live(signal, dispatch);
  const hints = hintsWithPlan(args.hints, plan, args.referenceStyle);
  const prompt = promptFor(args.brief, hints, args.preferSampleIds, args.referenceStyle);
  const result = await generateTemplate({
    provider: args.provider,
    model: args.model,
    apiKey: args.apiKey,
    system: prompt.system,
    prompt: args.brief,
    hints,
    plan,
    signal,
    onPhase: (phase) => {
      send({ type: 'phase', phase });
    },
  });
  const warnings = args.planFirst && !plan ? [NO_PLAN_WARNING, ...result.warnings] : result.warnings;

  send({ type: 'done', result: { ...result, warnings }, summary: summarizeDescriptor(result.descriptor) });
}
