import { describe, expect, it } from 'vitest';
import { generationContext } from './generation-context';
import { formatPlan, parsePlan, planSeconds, validatePlan } from './plan';
import { buildPlanPrompt, planVocabulary, verbList } from './plan-prompt';

const PLAN = {
  strategy: 'tells busy founders that notes can write themselves',
  concepts: [
    { concept: 'Feature tour with app screens', typicality: 0.85 },
    { concept: 'A messy desk tidies itself, beat by beat', typicality: 0.35 },
    { concept: 'One sentence typed by the viewer becomes a whole page', typicality: 0.15 },
  ],
  chosen: 2,
  beats: [
    { section: 'hook', role: 'hook', verb: 'TYPES', onScreen: 'Write one line.', why: 'outcome first', seconds: 1.5 },
    { section: 'claim', role: 'problem', verb: 'rises', onScreen: 'Get the whole page', why: 'value', seconds: 2.5 },
    { section: 'demo', role: 'footage', verb: 'LEANS IN', onScreen: '', why: 'proof', seconds: 5 },
  ],
  theme: 'bold',
  platform: 'tiktok',
  transitions: { primary: 'cut', accents: ['zoom-through'] },
};

const vocabulary = planVocabulary(generationContext().catalog);

describe('parsePlan', () => {
  it('parses a fenced plan and normalises verbs and typicality', () => {
    const parsed = parsePlan(`Here you go:\n\`\`\`json\n${JSON.stringify(PLAN)}\n\`\`\``, vocabulary);

    expect(parsed.ok).toBe(true);

    if (!parsed.ok) return;

    expect(parsed.plan.beats[1].verb).toBe('RISES');
    expect(parsed.plan.chosen).toBe(2);
    expect(parsed.plan.theme).toBe('bold');
    expect(planSeconds(parsed.plan)).toBe(9);
  });

  it('accepts typicality as words or a percentage, and drops a "none" theme', () => {
    const concepts = [
      { concept: 'a', typicality: 'high' },
      { concept: 'b', typicality: 40 },
      { concept: 'c', typicality: 0.1 },
    ];
    const parsed = validatePlan({ ...PLAN, concepts, theme: 'none', platform: 'none' }, vocabulary);

    expect(parsed.ok && parsed.plan.concepts.map((concept) => concept.typicality)).toEqual([0.8, 0.4, 0.1]);
    expect(parsed.ok && parsed.plan.theme).toBeUndefined();
  });

  it('lists every problem so one repair turn can fix them all', () => {
    const parsed = validatePlan(
      {
        strategy: '',
        concepts: [{ concept: 'only one', typicality: 2000 }],
        chosen: 4,
        beats: [{ section: 'x', role: '', verb: 'SLAMS', seconds: 0 }],
        theme: 'lagoon',
        transitions: { accents: ['a', 'b', 'c'] },
      },
      vocabulary
    );

    expect(parsed.ok).toBe(false);

    if (parsed.ok) return;

    const text = parsed.errors.join('\n');

    for (const field of [
      'strategy',
      'concepts:',
      'concepts[0].typicality',
      'chosen',
      'beats:',
      'beats[0].role',
      'beats[0].seconds',
      'theme: "lagoon"',
      'transitions.primary',
      'transitions.accents',
    ]) {
      expect(text).toContain(field);
    }
  });

  it('reports non-JSON replies', () => {
    expect(parsePlan('I would rather not.')).toMatchObject({ ok: false });
  });
});

describe('formatPlan', () => {
  it('renders the chosen concept, theme, transitions and every beat in order', () => {
    const parsed = validatePlan(PLAN, vocabulary);
    const text = parsed.ok ? formatPlan(parsed.plan) : '';

    expect(text).toContain('Follow this approved plan exactly');
    expect(text).toContain('Concept: One sentence typed by the viewer becomes a whole page');
    expect(text).toContain('global.theme to "bold"');
    expect(text).toContain('global.platform to "tiktok"');
    expect(text).toContain('primary cut; accents: zoom-through');
    expect(text).toContain('1. section "hook" [hook] TYPES — 1.5 s — on screen: "Write one line."');
    expect(text.indexOf('section "claim"')).toBeLessThan(text.indexOf('section "demo"'));
  });

  it('carries each beat motion intent and the signature moves into the template call', () => {
    const beats = PLAN.beats.map((beat, index) =>
      index === 0 ? { ...beat, motion: 'typewriter on $snappy, a twin fx sheen across the line at 1 s' } : beat
    );
    const parsed = validatePlan({ ...PLAN, beats, signature: ['the typed line turns into a page'] }, vocabulary);
    const text = parsed.ok ? formatPlan(parsed.plan) : '';

    expect(text).toContain('— motion: typewriter on $snappy, a twin fx sheen across the line at 1 s');
    expect(text).toContain('Signature moves (the only beats that get the strongest, most tuned effects)');
    expect(text).toContain('no library animation overlays');
  });

  it('allows at most two signature moves', () => {
    const parsed = validatePlan({ ...PLAN, signature: ['a', 'b', 'c'] }, vocabulary);

    expect(parsed.ok ? [] : parsed.errors).toEqual(['signature: at most 2 signature moves for the whole video']);
  });
});

describe('buildPlanPrompt', () => {
  it('is compact and carries the plan shape, art direction and the catalog verbs', () => {
    const { catalog } = generationContext();
    const prompt = buildPlanPrompt(catalog, { genre: 'product-launch' });

    expect(prompt.length).toBeLessThan(20_000);
    expect(prompt).toContain('"strategy":"tells <audience> that <message>"');
    expect(prompt).toContain('typicality');
    expect(prompt).toContain('Prefer an atypical concept');
    expect(prompt).toContain('Story spine:');
    expect(prompt).toContain('Lazy defaults to avoid');
    expect(prompt).toContain('Genre doctrine (product-launch)');
    expect(prompt).toContain("Compose motion, don't pick it");
    expect(prompt).toContain('"motion":"<motion intent');
    expect(prompt).toContain('"signature":[');
    expect(verbList(catalog)).toContain('SLAMS (impact)');
    expect(prompt).not.toContain('Template JSON Schema');
  });
});
