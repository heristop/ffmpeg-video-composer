import { describe, expect, it } from 'vitest';
import { GenerationFailedError } from '@/application/usecases/ai-template/generate-template';
import { ProviderError } from '@/application/usecases/ai-template/model-provider';
import type { BriefRoute } from '@/application/usecases/ai-template/brief-router';
import { canGenerate, describeFailure, IDLE, runReducer, statusLine, type RunStatus } from './ai-generation.logic';
import { chosenTheme, effectiveHints, percent, preferredSamples, routeChips } from './route-decisions';
import { generatedToEditorState, needsReplaceConfirmation, sampleToEditorState } from './load-generated';
import { generationContext } from '@/application/usecases/ai-template/generation-context';

const result = { descriptor: { sections: [] }, rounds: 1, warnings: [] };
const summary = {
  name: '',
  description: '',
  orientation: 'landscape',
  scenes: 0,
  footageScenes: 0,
  durationSeconds: 0,
  durationIsEstimate: false,
  effects: [],
};

describe('runReducer', () => {
  it('walks Thinking → Repairing → Validating → Ready', () => {
    let status: RunStatus = runReducer(IDLE, { type: 'start' });
    expect(status).toEqual({ kind: 'thinking', receivedChars: 0 });

    status = runReducer(status, { type: 'phase', phase: { kind: 'thinking', receivedChars: 120 } });
    expect(statusLine(status)).toEqual({ key: 'status.writing', values: { count: 120 } });

    status = runReducer(status, {
      type: 'phase',
      phase: { kind: 'repairing', round: 1, issueCount: 3, receivedChars: 0 },
    });
    expect(statusLine(status)).toEqual({ key: 'status.repairing', values: { round: 1, count: 3 } });

    status = runReducer(status, { type: 'phase', phase: { kind: 'validating', round: 2 } });
    expect(statusLine(status)).toEqual({ key: 'status.validating' });

    status = runReducer(status, { type: 'done', result: result as never, summary });
    expect(status.kind).toBe('ready');
  });

  it('ignores late progress after a run ended, and maps aborts to cancelled', () => {
    const cancelled = runReducer(IDLE, { type: 'fail', error: new ProviderError('aborted') });

    expect(cancelled).toEqual({ kind: 'cancelled' });
    expect(runReducer(cancelled, { type: 'phase', phase: { kind: 'validating', round: 1 } })).toBe(cancelled);
    expect(statusLine(cancelled)).toEqual({ key: 'status.cancelled' });
  });
});

describe('describeFailure', () => {
  it('maps provider errors to actionable copy keys', () => {
    expect(describeFailure(new ProviderError('auth', { status: 401, detail: 'invalid x-api-key' }))).toEqual({
      key: 'auth',
      detail: 'invalid x-api-key',
    });
    expect(describeFailure(new ProviderError('rate-limit')).key).toBe('rate-limit');
    expect(describeFailure(new ProviderError('network')).key).toBe('network');
    expect(describeFailure(new ProviderError('network'), 'jev').key).toBe('network-jev');
  });

  it('reports a failed repair loop with its rounds and issues', () => {
    const failure = describeFailure(new GenerationFailedError([{ path: 'sections', code: 'x', message: 'bad' }], 4));

    expect(failure).toEqual({ key: 'invalid', rounds: 4, detail: 'sections: bad' });
    expect(describeFailure(new Error('boom'))).toEqual({ key: 'unknown', detail: 'boom' });
  });
});

describe('canGenerate', () => {
  it('needs a real brief and a key, and no run in flight', () => {
    expect(canGenerate('a launch video for my app', 'sk-ant-x', IDLE)).toBe(true);
    expect(canGenerate('short', 'sk-ant-x', IDLE)).toBe(false);
    expect(canGenerate('a launch video for my app', ' ', IDLE)).toBe(false);
    expect(canGenerate('a launch video for my app', 'k', { kind: 'thinking', receivedChars: 0 })).toBe(false);
  });
});

describe('route decisions', () => {
  const route: BriefRoute = {
    genre: { value: 'product-launch', confidence: 0.92, applied: true },
    platform: { value: 'tiktok', confidence: 0.4, applied: false },
    orientation: { value: 'portrait', confidence: 0.81, applied: true },
    energy: { value: 3.2, confidence: 0.7, applied: true },
    seed: { value: 'product-launch', confidence: 0.66, applied: true },
  };

  it('starts confident chips on and suggestions off; overrides flip them', () => {
    const chips = routeChips(route, { platform: true, genre: false });

    expect(chips.map((chip) => [chip.field, chip.on])).toEqual([
      ['genre', false],
      ['platform', true],
      ['orientation', true],
      ['energy', true],
      ['seed', true],
    ]);
    expect(percent(0.916)).toBe('92%');
  });

  it("feeds only chips that are on, and the user's own format wins", () => {
    const chips = routeChips(route, {});

    expect(effectiveHints(chips, { orientation: 'auto', durationSeconds: 30 })).toEqual({
      orientation: 'portrait',
      durationSeconds: 30,
      energy: 3.2,
      genre: 'product-launch',
    });
    expect(effectiveHints(chips, { orientation: 'square', durationSeconds: null }).orientation).toBe('square');
    expect(preferredSamples(chips)).toEqual(['product-launch']);
  });

  it('carries a confident theme into the hints and the best-match start', () => {
    const chips = routeChips({ theme: { value: 'midnight', confidence: 0.8, applied: true } }, {});
    const sample = generationContext().samples[0];
    const state = sampleToEditorState(sample, chosenTheme(chips));

    expect(effectiveHints(chips, { orientation: 'auto', durationSeconds: null })).toEqual({ theme: 'midnight' });
    expect(state.motion?.theme).toBe('midnight');
    expect(sampleToEditorState(sample).motion?.theme).toBe(sample.template.global?.theme);
  });

  it('hides "none" and "other" answers', () => {
    const chips = routeChips(
      {
        genre: { value: 'other', confidence: 0.9, applied: true },
        platform: { value: 'none', confidence: 0.9, applied: true },
      },
      {}
    );

    expect(chips).toEqual([]);
  });
});

describe('loading into the builder', () => {
  it('opens a generated descriptor as a new draft with its meta identity', () => {
    const descriptor = {
      meta: { name: 'Launch', description: 'Short' },
      global: { orientation: 'portrait' },
      sections: [{ name: 'intro', type: 'color_background', options: { backgroundColor: '#000000', duration: 2 } }],
    };
    const first = generatedToEditorState(descriptor as never, 'Fallback');
    const second = generatedToEditorState(descriptor as never, 'Fallback');

    expect(first).toMatchObject({ name: 'Launch', description: 'Short', orientation: 'portrait' });
    expect(first.id).not.toBe(second.id);
    expect(first.sections.length).toBeGreaterThan(0);
  });

  it('asks before replacing a draft with edits', () => {
    expect(needsReplaceConfirmation(true)).toBe(true);
    expect(needsReplaceConfirmation(false)).toBe(false);
  });
});
