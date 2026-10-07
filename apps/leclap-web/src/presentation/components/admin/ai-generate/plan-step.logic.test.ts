import { describe, expect, it } from 'vitest';
import type { TemplatePlan } from '@/application/usecases/ai-template/plan';
import { IDLE, isRunning, runReducer, statusLine, type RunStatus } from './ai-generation.logic';
import { chooseConcept, editBeat, editStrategy, planIsComplete, typicalityKey } from './plan-review.logic';
import { hintsWithPlan } from './run-generation';

const PLAN: TemplatePlan = {
  strategy: 'tells coffee lovers that the morning queue is worth it',
  concepts: [
    { concept: 'Menu board tour', typicality: 0.9 },
    { concept: 'The queue as a countdown', typicality: 0.4 },
    { concept: 'One cup, one sip, one word', typicality: 0.15 },
  ],
  chosen: 2,
  beats: [
    { section: 'sip', role: 'hook', verb: 'SLAMS', onScreen: 'Worth the wait.', why: 'outcome first', seconds: 1.2 },
    { section: 'pour', role: 'footage', verb: 'LEANS IN', onScreen: '', why: 'proof', seconds: 4 },
  ],
  theme: 'neon',
  platform: 'tiktok',
  transitions: { primary: 'cut', accents: ['zoom-through'] },
};

describe('run reducer: the plan step', () => {
  it('walks Planning → plan ready (paused, editable) → Thinking', () => {
    let status: RunStatus = runReducer(IDLE, { type: 'start', planning: true });

    expect(status).toEqual({ kind: 'planning', receivedChars: 0 });
    expect(isRunning(status)).toBe(true);
    expect(statusLine(status)).toEqual({ key: 'status.planning' });

    status = runReducer(status, { type: 'plan-ready', plan: PLAN });
    expect(status.kind).toBe('plan-ready');
    expect(isRunning(status)).toBe(false);
    expect(statusLine(status)).toEqual({ key: 'status.planReady' });

    const edited = editStrategy(PLAN, 'tells night owls that mornings can be good');
    status = runReducer(status, { type: 'edit-plan', plan: edited });
    expect(status).toEqual({ kind: 'plan-ready', plan: edited });

    status = runReducer(status, { type: 'start' });
    expect(status.kind).toBe('thinking');
  });

  it('ignores a plan that arrives after cancel, and edits outside review', () => {
    const cancelled: RunStatus = { kind: 'cancelled' };

    expect(runReducer(cancelled, { type: 'plan-ready', plan: PLAN })).toBe(cancelled);
    expect(runReducer(IDLE, { type: 'edit-plan', plan: PLAN })).toBe(IDLE);
  });

  it('announces the polish round with its advisory count', () => {
    const status = runReducer(
      { kind: 'thinking', receivedChars: 0 },
      {
        type: 'phase',
        phase: { kind: 'polishing', advisoryCount: 3, receivedChars: 0 },
      }
    );

    expect(statusLine(status)).toEqual({ key: 'status.polishing', values: { count: 3 } });
  });
});

describe('plan review edits', () => {
  it('edits one beat, clamping its length', () => {
    const plan = editBeat(PLAN, 0, { onScreen: 'Worth it.', seconds: 1.234 });

    expect(plan.beats[0]).toMatchObject({ onScreen: 'Worth it.', seconds: 1.2, verb: 'SLAMS' });
    expect(plan.beats[1]).toBe(PLAN.beats[1]);
    expect(editBeat(PLAN, 0, { seconds: Number.NaN }).beats[0].seconds).toBe(1.2);
    expect(editBeat(PLAN, 0, { seconds: 500 }).beats[0].seconds).toBe(60);
  });

  it('picks a concept within range only', () => {
    expect(chooseConcept(PLAN, 0).chosen).toBe(0);
    expect(chooseConcept(PLAN, 7)).toBe(PLAN);
  });

  it('labels typicality and requires a strategy and verbs to continue', () => {
    expect(PLAN.concepts.map((concept) => typicalityKey(concept.typicality))).toEqual(['expected', 'fresh', 'unusual']);
    expect(planIsComplete(PLAN)).toBe(true);
    expect(planIsComplete(editStrategy(PLAN, ' '))).toBe(false);
    expect(planIsComplete(editBeat(PLAN, 1, { verb: '' }))).toBe(false);
  });

  it("feeds the plan's theme and platform into the generation hints", () => {
    expect(hintsWithPlan({ orientation: 'portrait' }, PLAN)).toEqual({
      orientation: 'portrait',
      theme: 'neon',
      platform: 'tiktok',
    });
    expect(hintsWithPlan({ theme: 'bold' }, null)).toEqual({ theme: 'bold' });
  });
});
