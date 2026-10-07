// The Generate-with-AI dialog's run state as a pure reducer, plus the mapping from failures to the
// copy the dialog shows. Kept free of React so every transition is unit-tested.
import {
  GenerationFailedError,
  type GenerationPhase,
  type GenerationResult,
} from '@/application/usecases/ai-template/generate-template';
import { isAbortError, ProviderError } from '@/application/usecases/ai-template/model-provider';
import type { DescriptorSummary } from '@/application/usecases/ai-template/descriptor-summary';
import type { TemplatePlan } from '@/application/usecases/ai-template/plan';

export type RunStatus =
  | { kind: 'idle' }
  | { kind: 'cancelled' }
  | { kind: 'planning'; receivedChars: number }
  // The plan waits for review: editable, then "Write template" continues the run.
  | { kind: 'plan-ready'; plan: TemplatePlan }
  | { kind: 'thinking'; receivedChars: number }
  | { kind: 'validating'; round: number }
  | { kind: 'repairing'; round: number; issueCount: number; receivedChars: number }
  | { kind: 'polishing'; advisoryCount: number; receivedChars: number }
  | { kind: 'ready'; result: GenerationResult; summary: DescriptorSummary }
  | { kind: 'error'; error: FailureCopy };

export type RunAction =
  | { type: 'start'; planning?: boolean }
  | { type: 'phase'; phase: GenerationPhase }
  | { type: 'plan-ready'; plan: TemplatePlan }
  | { type: 'edit-plan'; plan: TemplatePlan }
  | { type: 'done'; result: GenerationResult; summary: DescriptorSummary }
  | { type: 'fail'; error: unknown }
  | { type: 'reset' };

export interface FailureCopy {
  // An `ai:errors.*` key.
  key: ErrorKey;
  detail?: string;
  rounds?: number;
}

export type ErrorKey =
  | 'auth'
  | 'rate-limit'
  | 'overloaded'
  | 'network'
  | 'network-jev'
  | 'refused'
  | 'truncated'
  | 'bad-request'
  | 'bad-response'
  | 'http'
  | 'invalid'
  | 'unknown';

const PROVIDER_KEYS = new Set<string>([
  'auth',
  'rate-limit',
  'overloaded',
  'network',
  'refused',
  'truncated',
  'bad-request',
  'bad-response',
  'http',
]);

// Turn any failure into the dialog's copy. `jev` picks Jev's network copy (its browser access is
// not confirmed, so a blocked call is most likely CORS).
export function describeFailure(error: unknown, source: 'model' | 'jev' = 'model'): FailureCopy {
  if (error instanceof GenerationFailedError) {
    return {
      key: 'invalid',
      rounds: error.rounds,
      detail: error.issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n'),
    };
  }

  if (error instanceof ProviderError && PROVIDER_KEYS.has(error.kind)) {
    const key = error.kind === 'network' && source === 'jev' ? 'network-jev' : (error.kind as ErrorKey);

    return { key, detail: error.detail };
  }

  return { key: 'unknown', detail: error instanceof Error ? error.message : undefined };
}

export const IDLE: RunStatus = { kind: 'idle' };

const RUNNING = new Set<RunStatus['kind']>(['planning', 'thinking', 'validating', 'repairing', 'polishing']);

export function isRunning(status: RunStatus): boolean {
  return RUNNING.has(status.kind);
}

// The plan step: a plan only lands on a live run, and is only edited while under review.
function planReducer(status: RunStatus, action: Extract<RunAction, { type: 'plan-ready' | 'edit-plan' }>): RunStatus {
  const live = action.type === 'plan-ready' ? isRunning(status) : status.kind === 'plan-ready';

  return live ? { kind: 'plan-ready', plan: action.plan } : status;
}

export function runReducer(status: RunStatus, action: RunAction): RunStatus {
  switch (action.type) {
    case 'start':
      return { kind: action.planning ? 'planning' : 'thinking', receivedChars: 0 };
    case 'phase':
      // A late progress event after cancel/finish must not resurrect a run.
      return isRunning(status) ? action.phase : status;
    case 'plan-ready':
    case 'edit-plan':
      return planReducer(status, action);
    case 'done':
      return { kind: 'ready', result: action.result, summary: action.summary };
    case 'fail':
      return isAbortError(action.error)
        ? { kind: 'cancelled' }
        : { kind: 'error', error: describeFailure(action.error) };
    case 'reset':
      return IDLE;
    default:
      return status;
  }
}

// The short live-region line for a running status (an `ai:status.*` key + its values).
export function statusLine(status: RunStatus): { key: string; values?: Record<string, number> } | null {
  if (status.kind === 'planning') return { key: 'status.planning' };

  if (status.kind === 'plan-ready') return { key: 'status.planReady' };

  if (status.kind === 'polishing') return { key: 'status.polishing', values: { count: status.advisoryCount } };

  if (status.kind === 'thinking') {
    return status.receivedChars > 0
      ? { key: 'status.writing', values: { count: status.receivedChars } }
      : { key: 'status.thinking' };
  }

  if (status.kind === 'validating') return { key: 'status.validating' };

  if (status.kind === 'repairing') {
    return { key: 'status.repairing', values: { round: status.round, count: status.issueCount } };
  }

  if (status.kind === 'cancelled') return { key: 'status.cancelled' };

  return null;
}

// Minimal brief length before Generate is enabled.
export const MIN_BRIEF_LENGTH = 12;

export function canGenerate(brief: string, apiKey: string, status: RunStatus): boolean {
  return brief.trim().length >= MIN_BRIEF_LENGTH && apiKey.trim() !== '' && !isRunning(status);
}
