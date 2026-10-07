// Pure edits for the plan review step: each returns a new plan, so the reducer keeps one source of
// truth and the table stays a plain controlled form.
import { PLAN_MAX_BEAT_SECONDS, type PlanBeat, type TemplatePlan } from '@/application/usecases/ai-template/plan';

export type BeatPatch = Partial<Pick<PlanBeat, 'onScreen' | 'verb' | 'seconds'>>;

function clampSeconds(seconds: number, fallback: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return fallback;

  return Math.min(PLAN_MAX_BEAT_SECONDS, Math.round(seconds * 10) / 10);
}

export function editBeat(plan: TemplatePlan, index: number, patch: BeatPatch): TemplatePlan {
  return {
    ...plan,
    beats: plan.beats.map((beat, at) => {
      if (at !== index) return beat;

      const seconds = patch.seconds === undefined ? beat.seconds : clampSeconds(patch.seconds, beat.seconds);

      return { ...beat, ...patch, seconds };
    }),
  };
}

export function chooseConcept(plan: TemplatePlan, chosen: number): TemplatePlan {
  return chosen >= 0 && chosen < plan.concepts.length ? { ...plan, chosen } : plan;
}

export function editStrategy(plan: TemplatePlan, strategy: string): TemplatePlan {
  return { ...plan, strategy };
}

// A typicality score as a short label key: how expected the concept is for this brief.
export function typicalityKey(typicality: number): 'expected' | 'fresh' | 'unusual' {
  if (typicality >= 0.6) return 'expected';

  return typicality >= 0.3 ? 'fresh' : 'unusual';
}

// "Write template" needs a strategy, and a verb and a length for every beat (footage beats have no copy).
export function planIsComplete(plan: TemplatePlan): boolean {
  return plan.strategy.trim() !== '' && plan.beats.every((beat) => beat.verb.trim() !== '' && beat.seconds > 0);
}
