// Plan-first generation and the advisory polish round, against a fake provider.
import { describe, expect, it } from 'vitest';
import type { GenerateRequest, TemplateModelProvider } from './model-provider';
import { advisoryMessage, generateTemplate, type GenerationPhase } from './generate-template';
import { validatePlan, type TemplatePlan } from './plan';
import { planTemplate, PLAN_REQUEST } from './plan-template';

function fakeProvider(replies: string[]): TemplateModelProvider & { calls: GenerateRequest[] } {
  const calls: GenerateRequest[] = [];

  return {
    id: 'fake',
    label: 'Fake',
    defaultModel: 'fake-1',
    models: ['fake-1'],
    looksLikeKey: () => true,
    keyPlaceholder: '',
    keyUrl: '',
    calls,
    generate: (request) => {
      calls.push(structuredClone({ ...request, signal: undefined, onProgress: undefined }));

      return Promise.resolve(replies[calls.length - 1] ?? '');
    },
  };
}

const RAW_PLAN = {
  strategy: 'tells runners that the trail starts at the door',
  concepts: [
    { concept: 'Gear flat-lay tour', typicality: 0.9 },
    { concept: 'A doorstep that turns into a summit', typicality: 0.3 },
    { concept: 'Footsteps as a countdown', typicality: 0.2 },
  ],
  chosen: 1,
  beats: [
    { section: 'doorstep', role: 'hook', verb: 'SLAMS', onScreen: 'Step outside.', why: 'outcome', seconds: 1.5 },
    { section: 'summit', role: 'outro', verb: 'PULLS BACK', onScreen: 'Find the summit', why: 'payoff', seconds: 2 },
  ],
  theme: 'bold',
  transitions: { primary: 'cut', accents: ['iris'] },
};

function plan(): TemplatePlan {
  const parsed = validatePlan(RAW_PLAN);

  if (!parsed.ok) throw new Error(parsed.errors.join('\n'));

  return parsed.plan;
}

function card(name: string, duration: number, color: string, text: string) {
  return {
    name,
    type: 'color_background',
    options: { backgroundColor: color, duration },
    filters: [
      {
        type: 'drawtext',
        values: { text: { en: text }, fontfile: '$font.display', fontsize: 64, fontcolor: '$color.fg', x: 60, y: 500 },
      },
    ],
  };
}

// Follows the plan: one section per beat, the plan's names, durations and theme tokens.
const ON_PLAN = {
  meta: { name: 'Trail', description: 'Doorstep to summit.' },
  global: { orientation: 'portrait', theme: 'bold' },
  sections: [
    card('doorstep', 1.5, '$color.bg', 'Step outside.'),
    card('summit', 2, '$color.surface', 'Find the summit'),
  ],
};

// Same template with literal colours off the bold palette: valid, but palette_drift advisories.
const DRIFTING = {
  ...ON_PLAN,
  sections: [card('doorstep', 1.5, '#000000', 'Step outside.'), card('summit', 2, '#7b2ff7', 'Find the summit')],
};

const base = { model: 'fake-1', apiKey: 'k', system: 'SYSTEM', prompt: 'trail running brand film', hints: {} };

describe('planTemplate', () => {
  it('asks for the plan and returns it parsed', async () => {
    const provider = fakeProvider([JSON.stringify(RAW_PLAN)]);
    const result = await planTemplate({ ...base, system: 'PLAN', provider });

    expect(result?.beats.map((beat) => beat.section)).toEqual(['doorstep', 'summit']);
    expect(provider.calls[0].system).toBe('PLAN');
    expect(provider.calls[0].messages[0].content).toContain(PLAN_REQUEST);
  });

  it('repairs a broken plan once, then gives up with null', async () => {
    const repaired = fakeProvider(['{"strategy":""}', JSON.stringify(RAW_PLAN)]);
    const hopeless = fakeProvider(['nope', 'still nope', JSON.stringify(RAW_PLAN)]);

    expect(await planTemplate({ ...base, provider: repaired })).not.toBeNull();
    expect(repaired.calls[1].messages.at(-1)?.content).toContain('strategy');
    expect(await planTemplate({ ...base, provider: hopeless })).toBeNull();
    expect(hopeless.calls).toHaveLength(2);
  });
});

describe('generateTemplate with a plan', () => {
  it('sends the approved plan with the brief and returns it with the result', async () => {
    const provider = fakeProvider([JSON.stringify(ON_PLAN)]);
    const result = await generateTemplate({ ...base, provider, plan: plan() });
    const brief = provider.calls[0].messages[0].content;

    expect(brief).toContain('Brief: trail running brand film');
    expect(brief).toContain('Follow this approved plan exactly');
    expect(brief).toContain('section "doorstep" [hook] SLAMS — 1.5 s — on screen: "Step outside."');
    expect(brief).toContain('Concept: A doorstep that turns into a summit');
    expect(brief.trim().endsWith('Return the template JSON object now.')).toBe(true);
    expect(result.descriptor.sections?.map((section) => section.name)).toEqual(['doorstep', 'summit']);
    expect(result.plan?.strategy).toBe(RAW_PLAN.strategy);
    expect(result.rounds).toBe(1);
    expect(result.advisories.filter((advisory) => advisory.severity === 'warn')).toEqual([]);
  });

  it('keeps the repair loop working under a plan', async () => {
    const provider = fakeProvider(['not json', JSON.stringify(ON_PLAN)]);
    const result = await generateTemplate({ ...base, provider, plan: plan() });

    expect(result.repairs).toBe(1);
    expect(provider.calls[1].messages[0].content).toContain('Follow this approved plan exactly');
  });
});

describe('advisory polish round', () => {
  it('feeds the advisories back once as "improve if cheap" and keeps the improved template', async () => {
    const provider = fakeProvider([JSON.stringify(DRIFTING), JSON.stringify(ON_PLAN)]);
    const phases: GenerationPhase['kind'][] = [];
    const result = await generateTemplate({ ...base, provider, onPhase: (phase) => phases.push(phase.kind) });
    const polish = provider.calls[1].messages.at(-1)?.content ?? '';

    expect(provider.calls).toHaveLength(2);
    expect(polish).toContain('cheap to fix');
    expect(polish).toContain('[palette_drift]');
    expect(polish).toContain('$color.*');
    expect(phases).toContain('polishing');
    expect(result).toMatchObject({ rounds: 2, repairs: 0, polished: 1 });
    expect(result.advisories.some((advisory) => advisory.code === 'palette_drift')).toBe(false);
  });

  it('runs at most one advisory round, even when advisories remain', async () => {
    const provider = fakeProvider([JSON.stringify(DRIFTING), JSON.stringify(DRIFTING), JSON.stringify(ON_PLAN)]);
    const result = await generateTemplate({ ...base, provider });

    expect(provider.calls).toHaveLength(2);
    expect(result.advisories.filter((advisory) => advisory.code === 'palette_drift').length).toBeGreaterThan(0);
  });

  it('keeps the last valid template when the polish reply does not validate', async () => {
    const provider = fakeProvider([JSON.stringify(DRIFTING), '{"sections":[]}']);
    const result = await generateTemplate({ ...base, provider });

    expect(provider.calls).toHaveLength(2);
    expect(result.descriptor.sections?.[0].options).toMatchObject({ backgroundColor: '#000000' });
    expect(result.warnings.join(' ')).toMatch(/polish pass did not validate/);
  });

  it('can be switched off', async () => {
    const provider = fakeProvider([JSON.stringify(DRIFTING)]);

    await generateTemplate({ ...base, provider, maxAdvisoryRounds: 0 });
    expect(provider.calls).toHaveLength(1);
  });

  it('formats advisories with their hints', () => {
    expect(
      advisoryMessage([
        { path: 'sections[0]', code: 'ease_monotony', message: 'Same ease', hint: 'Vary it', severity: 'warn' },
      ])
    ).toContain('sections[0] [ease_monotony]: Same ease (hint: Vary it)');
  });
});
