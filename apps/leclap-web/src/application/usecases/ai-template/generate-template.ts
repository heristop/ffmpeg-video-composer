// The generation pipeline: brief (+ approved plan) → model → JSON extraction → engine validation →
// automatic repair. When the reply is not valid, the validator's issues go back to the model as a
// follow-up turn and it returns a corrected template — up to `maxRepairs` times. Once valid, the
// engine's advisory lint (pacing, accent, palette) gets at most `maxAdvisoryRounds` "improve if
// cheap" turns; a polish that breaks validation is discarded, so advisories never fail a run.
// No React, no DOM: the provider is injected, so the whole loop runs in unit tests against a fake.
import type { TemplateDescriptor } from '@leclap/creative-kit/editor';
import { extractJsonObject } from './extract-json';
import type { ChatMessage, TemplateModelProvider } from './model-provider';
import { formatPlan, type TemplatePlan } from './plan';
import { buildUserBrief, TEMPLATE_REQUEST, type GenerationHints } from './system-prompt';
import {
  formatIssues,
  motionAdvisories,
  validateGenerated,
  type Advisory,
  type ValidationIssue,
} from './validate-generated';

export type GenerationPhase =
  | { kind: 'planning'; receivedChars: number }
  | { kind: 'thinking'; receivedChars: number }
  | { kind: 'validating'; round: number }
  | { kind: 'repairing'; round: number; issueCount: number; receivedChars: number }
  | { kind: 'polishing'; advisoryCount: number; receivedChars: number };

export interface GenerateTemplateInput {
  provider: TemplateModelProvider;
  model: string;
  apiKey: string;
  system: string;
  prompt: string;
  hints: GenerationHints;
  // The approved plan: the template must follow it beat for beat.
  plan?: TemplatePlan | null;
  signal?: AbortSignal;
  onPhase?: (phase: GenerationPhase) => void;
  maxRepairs?: number;
  maxAdvisoryRounds?: number;
}

export interface GenerationResult {
  descriptor: TemplateDescriptor;
  // Model calls made for the template (plan call excluded): 1 when the first reply validated.
  rounds: number;
  // Of those, validation repairs and advisory polish turns.
  repairs: number;
  polished: number;
  warnings: string[];
  // The engine's advisory lint on the final descriptor.
  advisories: Advisory[];
  plan?: TemplatePlan;
}

export class GenerationFailedError extends Error {
  readonly issues: ValidationIssue[];
  readonly rounds: number;

  constructor(issues: ValidationIssue[], rounds: number) {
    super(
      `The generated template still had ${String(issues.length)} validation issue(s) after ${String(rounds)} attempts.`
    );
    this.name = 'GenerationFailedError';
    this.issues = issues;
    this.rounds = rounds;
  }
}

export const DEFAULT_MAX_REPAIRS = 3;
export const DEFAULT_MAX_ADVISORY_ROUNDS = 1;

export function repairMessage(issues: ValidationIssue[]): string {
  return [
    'That template does not validate. Fix every issue below and reply with the complete corrected JSON object only.',
    formatIssues(issues),
  ].join('\n\n');
}

export function advisoryMessage(advisories: Advisory[]): string {
  return [
    "That template is valid. The engine's art-direction lint left the advisory notes below. Improve the ones that are " +
      'cheap to fix without changing the plan, the copy or the structure; skip any that are not. Reply with the ' +
      'complete JSON object only.',
    formatIssues(advisories),
  ].join('\n\n');
}

type Check = { ok: true; descriptor: TemplateDescriptor } | { ok: false; issues: ValidationIssue[] };

export function checkReply(reply: string): Check {
  const extracted = extractJsonObject(reply);

  if (!extracted.ok) return { ok: false, issues: [{ path: 'root', code: 'invalid_json', message: extracted.error }] };

  return validateGenerated(extracted.value);
}

interface Valid {
  descriptor: TemplateDescriptor;
  messages: ChatMessage[];
  rounds: number;
  repairs: number;
}

function call(input: GenerateTemplateInput, messages: ChatMessage[], progress: (chars: number) => void) {
  return input.provider.generate({
    system: input.system,
    messages,
    model: input.model,
    apiKey: input.apiKey,
    signal: input.signal,
    onProgress: progress,
  });
}

function emit(input: GenerateTemplateInput, round: number, issueCount: number, receivedChars: number): void {
  input.onPhase?.(
    round === 1
      ? { kind: 'thinking', receivedChars }
      : { kind: 'repairing', round: round - 1, issueCount, receivedChars }
  );
}

async function attempt(
  input: GenerateTemplateInput,
  messages: ChatMessage[],
  round: number,
  lastIssues: ValidationIssue[]
): Promise<Valid> {
  emit(input, round, lastIssues.length, 0);
  const reply = await call(input, messages, (chars) => {
    emit(input, round, lastIssues.length, chars);
  });
  input.onPhase?.({ kind: 'validating', round });
  const check = checkReply(reply);
  const next: ChatMessage[] = [...messages, { role: 'assistant', content: reply }];

  if (check.ok) return { descriptor: check.descriptor, messages: next, rounds: round, repairs: round - 1 };

  if (round > (input.maxRepairs ?? DEFAULT_MAX_REPAIRS)) throw new GenerationFailedError(check.issues, round);

  return attempt(input, [...next, { role: 'user', content: repairMessage(check.issues) }], round + 1, check.issues);
}

// One bounded "improve if cheap" turn per allowed round. Keeps the last valid descriptor on failure.
async function polish(input: GenerateTemplateInput, valid: Valid, used = 0): Promise<Valid & { dropped: boolean }> {
  const advisories = motionAdvisories(valid.descriptor).filter((advisory) => advisory.severity === 'warn');

  if (advisories.length === 0 || used >= (input.maxAdvisoryRounds ?? DEFAULT_MAX_ADVISORY_ROUNDS)) {
    return { ...valid, dropped: false };
  }

  const progress = (receivedChars: number) => {
    input.onPhase?.({ kind: 'polishing', advisoryCount: advisories.length, receivedChars });
  };
  progress(0);
  const messages: ChatMessage[] = [...valid.messages, { role: 'user', content: advisoryMessage(advisories) }];
  const reply = await call(input, messages, progress);
  const rounds = valid.rounds + 1;
  input.onPhase?.({ kind: 'validating', round: rounds });
  const check = checkReply(reply);

  if (!check.ok) return { ...valid, rounds, dropped: true };

  const next = {
    ...valid,
    descriptor: check.descriptor,
    rounds,
    messages: [...messages, { role: 'assistant' as const, content: reply }],
  };

  return polish(input, next, used + 1);
}

function resultWarnings(
  descriptor: TemplateDescriptor,
  input: GenerateTemplateInput,
  final: Valid & { dropped: boolean }
) {
  const warnings: string[] = [];
  const wanted = input.hints.orientation;

  if (wanted && descriptor.global?.orientation !== wanted) {
    warnings.push(`Asked for ${wanted}, the model chose ${descriptor.global?.orientation ?? 'landscape'}.`);
  }

  if (final.repairs > 0) {
    warnings.push(`Fixed validation issues automatically (${String(final.repairs)} repair round(s)).`);
  }

  if (final.dropped) warnings.push('Kept the first valid version: the polish pass did not validate.');

  return warnings;
}

export function templateBrief(prompt: string, hints: GenerationHints, plan?: TemplatePlan | null): string {
  return buildUserBrief(prompt, hints, plan ? `${formatPlan(plan)}\n\n${TEMPLATE_REQUEST}` : TEMPLATE_REQUEST);
}

export async function generateTemplate(input: GenerateTemplateInput): Promise<GenerationResult> {
  const brief = templateBrief(input.prompt, input.hints, input.plan);
  const valid = await attempt(input, [{ role: 'user', content: brief }], 1, []);
  const final = await polish(input, valid);

  return {
    descriptor: final.descriptor,
    rounds: final.rounds,
    repairs: final.repairs,
    polished: final.rounds - final.repairs - 1,
    warnings: resultWarnings(final.descriptor, input, final),
    advisories: motionAdvisories(final.descriptor),
    ...(input.plan ? { plan: input.plan } : {}),
  };
}
