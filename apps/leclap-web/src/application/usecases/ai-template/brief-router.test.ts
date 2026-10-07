import { describe, expect, it, vi } from 'vitest';
import type { SampleDetail } from 'ffmpeg-video-composer/src/samples/types.ts';
import {
  bestSeed,
  buildBriefQuestions,
  choiceDecision,
  CONFIDENCE_THRESHOLD,
  routeBrief,
  scoreDecision,
  type JevAnswer,
} from './brief-router';
import { generationContext } from './generation-context';

const samples = generationContext().samples;

function sample(id: string): SampleDetail {
  const found = samples.find((candidate) => candidate.id === id);

  if (!found) throw new Error(`missing sample ${id}`);

  return found;
}

describe('buildBriefQuestions', () => {
  it('asks genre, platform, orientation, energy and seed (no theme without a theme catalog)', () => {
    const questions = buildBriefQuestions(samples);

    expect(Object.keys(questions)).toEqual(['genre', 'platform', 'orientation', 'energy', 'seed']);
    expect(questions.energy).toMatchObject({ type: 'score' });
    expect(questions.energy.criteria).toHaveLength(5);
    expect(questions.genre.criteria).toHaveProperty('product-launch');
    expect(Object.keys(questions.seed.criteria as Record<string, unknown>).length).toBeLessThanOrEqual(20);
    expect(questions.seed.criteria).toHaveProperty('product-launch');
  });

  it('offers the engine themes from the motion catalog', () => {
    const themes = generationContext().catalog.themes ?? [];
    const questions = buildBriefQuestions(samples, themes);

    expect(themes.length).toBeGreaterThan(1);
    expect(Object.keys(questions.theme.criteria as Record<string, unknown>)).toEqual(themes.map((theme) => theme.id));
  });

  it('adds a theme question when themes exist', () => {
    const questions = buildBriefQuestions(samples, [{ id: 'neon', description: 'Neon nights' }]);

    expect(questions.theme).toEqual({
      type: 'choice',
      instructions: expect.any(String),
      criteria: { neon: 'Neon nights' },
    });
  });
});

describe('decisions', () => {
  it('applies confident answers and only suggests the rest', () => {
    const confident: JevAnswer = { type: 'choice', choice: 'portrait', confidence: 0.92 };
    const unsure: JevAnswer = { type: 'choice', choice: 'square', confidence: CONFIDENCE_THRESHOLD - 0.01 };

    expect(choiceDecision(confident, ['portrait', 'square'])).toMatchObject({ value: 'portrait', applied: true });
    expect(choiceDecision(unsure, ['portrait', 'square'])).toMatchObject({ value: 'square', applied: false });
  });

  it('drops labels it did not ask about and wrong answer types', () => {
    expect(choiceDecision({ type: 'choice', choice: 'vertical', confidence: 1 }, ['portrait'])).toBeUndefined();
    expect(choiceDecision({ type: 'boolean', probability: 0.4 }, ['portrait'])).toBeUndefined();
    expect(scoreDecision({ type: 'choice', choice: 'x', confidence: 1 }, 4)).toBeUndefined();
  });

  it('clamps fractional scores and confidences', () => {
    expect(scoreDecision({ type: 'score', score: 3.4, confidence: 0.7 }, 4)).toEqual({
      value: 3.4,
      confidence: 0.7,
      applied: true,
    });
    expect(scoreDecision({ type: 'score', score: 9, confidence: 4 }, 4)).toMatchObject({ value: 4, confidence: 1 });
  });
});

describe('routeBrief', () => {
  it('sends the prompt as state with the questions, and interprets the answers', async () => {
    const ask = vi.fn().mockResolvedValue({
      genre: { type: 'choice', choice: 'product-launch', confidence: 0.92 },
      platform: { type: 'choice', choice: 'tiktok', confidence: 0.4 },
      orientation: { type: 'choice', choice: 'portrait', confidence: 0.8 },
      energy: { type: 'score', score: 3.2, confidence: 0.66, legend: '', probabilities: {} },
      seed: { type: 'choice', choice: 'product-launch', confidence: 0.7, probabilities: { 'product-launch': 0.7 } },
    });

    const route = await routeBrief('  30s launch for a notes app  ', samples, ask);

    expect(ask).toHaveBeenCalledWith(
      '30s launch for a notes app',
      expect.objectContaining({ genre: expect.any(Object) })
    );
    expect(route.genre).toMatchObject({ value: 'product-launch', applied: true });
    expect(route.platform).toMatchObject({ value: 'tiktok', applied: false });
    expect(route.energy).toMatchObject({ value: 3.2, applied: true });
    expect(route.seed?.value).toBe('product-launch');
    expect(route.theme).toBeUndefined();
  });
});

describe('bestSeed', () => {
  it("keeps Jev's pick when the orientation agrees", () => {
    const route = {
      seed: { value: 'product-launch', confidence: 0.9, applied: true },
      orientation: { value: sample('product-launch').orientation, confidence: 0.9, applied: true },
    };

    expect(bestSeed(route, samples)?.id).toBe('product-launch');
  });

  it('falls back to the most probable seed in a confident, different orientation', () => {
    const pick = sample('product-launch');
    const other = samples.find((candidate) => candidate.orientation !== pick.orientation);

    if (!other) throw new Error('fixture needs two orientations');

    const route = {
      seed: { value: pick.id, confidence: 0.6, applied: true, probabilities: { [pick.id]: 0.6, [other.id]: 0.3 } },
      orientation: { value: other.orientation, confidence: 0.9, applied: true },
    };

    expect(bestSeed(route, samples)?.id).toBe(other.id);
  });
});
