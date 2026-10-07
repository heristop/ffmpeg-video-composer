// @vitest-environment node
// Static-markup tests for the Generate-with-AI dialog parts (the web app has no jsdom/RTL): the brief
// form is labelled, the status announces progress politely, errors are alerts with actionable copy,
// the ready card summarises the template, and the footer keeps exactly one primary action.
import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';
import ai from '@/i18n/locales/en/ai.json';
import { BriefFields } from './BriefFields';
import { DialogFooterActions } from './DialogFooterActions';
import { GenerationStatus } from './GenerationStatus';
import { ResultCard } from './ResultCard';
import { PlanOptions } from './PlanOptions';
import { PlanReview } from './PlanReview';
import type { RunStatus } from './ai-generation.logic';
import type { TemplatePlan } from '@/application/usecases/ai-template/plan';

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
  transitions: { primary: 'cut', accents: ['zoom-through'] },
};

beforeAll(async () => {
  await i18n.init({ lng: 'en', fallbackLng: 'en', ns: ['ai'], defaultNS: 'ai', resources: { en: { ai } } });
});

const noop = () => {};

function render(node: React.ReactNode): string {
  return renderToStaticMarkup(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>);
}

function footer(status: RunStatus, confirming = false): string {
  return render(
    <DialogFooterActions
      status={status}
      confirming={confirming}
      canGenerate
      onGenerate={noop}
      onCancel={noop}
      onOpen={noop}
      onConfirmReplace={noop}
      onKeepEditing={noop}
      onRegenerate={noop}
    />
  );
}

describe('BriefFields', () => {
  it('labels the brief and offers example prompts', () => {
    const html = render(
      <BriefFields
        brief=""
        onBriefChange={noop}
        orientation="auto"
        onOrientationChange={noop}
        duration="auto"
        onDurationChange={noop}
        disabled={false}
      />
    );

    expect(html).toMatch(/<label for="[^"]+"[^>]*>What should the video be\?<\/label>/);
    expect(html).toContain(ai.examples.launch);
    expect(html).toContain(ai.examples.tutorial);
    // The guidance under the brief is its description.
    expect(html).toMatch(/<textarea id="([^"]+)"[^>]*aria-describedby="\1-help"/);
    expect(html).toContain(ai.brief.hint.replace("'", '&#x27;'));
  });
});

describe('GenerationStatus', () => {
  it('announces the repair round in a polite live region', () => {
    const html = render(
      <GenerationStatus
        status={{ kind: 'repairing', round: 2, issueCount: 3, receivedChars: 0 }}
        providerLabel="Anthropic"
      />
    );

    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Repairing (round 2): fixing 3 issue(s)…');
    expect(html).toContain('aria-current="step"');
  });

  it('shows a rejected key as an alert naming the provider', () => {
    const html = render(
      <GenerationStatus
        status={{ kind: 'error', error: { key: 'auth', detail: 'invalid x-api-key' } }}
        providerLabel="OpenAI"
      />
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain('OpenAI rejected the key');
    expect(html).toContain('invalid x-api-key');
  });
});

describe('ResultCard', () => {
  it('summarises scenes, clips, duration and effects', () => {
    const html = render(
      <ResultCard
        summary={{
          name: 'Notes launch',
          description: 'A punchy launch.',
          orientation: 'portrait',
          scenes: 4,
          footageScenes: 1,
          durationSeconds: 12.5,
          durationIsEstimate: false,
          effects: ['look: vivid', 'reveal: rise'],
        }}
        warnings={['Fixed validation issues automatically (1 repair round(s)).']}
      />
    );

    expect(html).toContain('Notes launch');
    expect(html).toContain('4 scenes');
    expect(html).toContain('1 clip to film');
    expect(html).toContain('12.5 s');
    expect(html).toContain('look: vivid · reveal: rise');
    expect(html).toContain('repair round');
  });
});

describe('DialogFooterActions', () => {
  it('offers one primary action per state', () => {
    expect(footer({ kind: 'idle' })).toContain('Generate');
    expect(footer({ kind: 'thinking', receivedChars: 0 })).toContain('Cancel');
    expect(footer({ kind: 'error', error: { key: 'network' } })).toContain('Try again');
    expect(footer({ kind: 'ready', result: {} as never, summary: {} as never })).toContain('Open in builder');
  });

  it('explains a disabled Generate and offers the fix inline', () => {
    const html = render(
      <DialogFooterActions
        status={{ kind: 'idle' }}
        confirming={false}
        canGenerate={false}
        blockedReason="Generating needs your Anthropic API key."
        blockedAction={{ label: ai.footer.addKey, onClick: noop }}
        onGenerate={noop}
        onCancel={noop}
        onOpen={noop}
        onConfirmReplace={noop}
        onKeepEditing={noop}
        onRegenerate={noop}
      />
    );
    const reasonId = /<p id="([^"]+)"[^>]*>/.exec(html)?.[1];

    expect(html).toContain('Generating needs your Anthropic API key.');
    expect(html).toMatch(new RegExp(`<button type="button"[^>]*>${ai.footer.addKey}</button>`));
    expect(html).toContain(`aria-describedby="${reasonId}"`);
    expect(html).toContain('aria-keyshortcuts="Meta+Enter Control+Enter"');
  });

  it('spells out what replacing the draft does before confirming', () => {
    const html = footer({ kind: 'idle' }, true);

    expect(html).toContain('Undo brings the draft back');
    expect(html).toContain('Replace draft');
    expect(html).toContain('Keep editing');
  });
});

describe('plan step', () => {
  it('offers Plan first and Review plan as labelled checkboxes; review needs planning', () => {
    const on = render(
      <PlanOptions planFirst reviewPlan onPlanFirstChange={noop} onReviewPlanChange={noop} disabled={false} />
    );
    const off = render(
      <PlanOptions planFirst={false} reviewPlan onPlanFirstChange={noop} onReviewPlanChange={noop} disabled={false} />
    );

    expect(on).toContain(ai.plan.planFirst);
    expect(on).toContain(ai.plan.review);
    expect(on.match(/role="checkbox"/g)).toHaveLength(2);
    expect(on.match(/aria-checked="true"/g)).toHaveLength(2);
    expect(on).toMatch(/<label for="[^"]+-plan"/);
    expect(on).not.toContain('data-disabled');
    // Planning off: nothing to review, so the review box reads unchecked and is disabled.
    expect(off).not.toContain('aria-checked="true"');
    expect(off.match(/data-disabled=""/g)).toHaveLength(1);
  });

  it('shows the plan as a compact, editable beat table', () => {
    const html = render(<PlanReview plan={PLAN} onChange={noop} />);

    expect(html).toContain('<table');
    expect(html).toContain('<caption');
    expect(html).toContain(ai.plan.beats);
    expect(html.match(/<th scope="col"/g)).toHaveLength(4);
    expect(html.match(/<th scope="row"/g)).toHaveLength(2);
    expect(html).toContain('value="Worth the wait."');
    expect(html).toContain('value="SLAMS"');
    expect(html).toContain('aria-label="Beat 1 on-screen copy"');
    expect(html).toContain('aria-label="Beat 2 verb"');
    expect(html).toContain('aria-label="Beat 1 length in seconds"');
    expect(html).toContain(`placeholder="${ai.plan.footage}"`);
    expect(html).toContain('outcome first');
  });

  it('shows the strategy and the three concepts, the chosen one checked, with how typical each is', () => {
    const html = render(<PlanReview plan={PLAN} onChange={noop} />);

    expect(html).toMatch(/<label for="[^"]+-strategy"[^>]*>Strategy<\/label>/);
    expect(html).toContain(`value="${PLAN.strategy}"`);
    expect(html).toContain('<legend');
    expect(html.match(/type="radio"/g)).toHaveLength(3);
    expect(html).toMatch(/type="radio"[^>]*checked=""[^>]*\/><span[^>]*>One cup, one sip, one word/);
    expect(html).toContain(ai.plan.typicality.expected);
    expect(html).toContain(ai.plan.typicality.unusual);
    expect(html).toContain('5.2 s');
    expect(html).toContain('Transitions: cut + zoom-through');
    expect(html).toContain('Theme: neon');
  });

  it('keeps one primary action on the plan: Write template, with Start over beside it', () => {
    const html = footer({ kind: 'plan-ready', plan: PLAN });

    expect(html).toContain(ai.actions.writeTemplate);
    expect(html).toContain(ai.actions.startOver);
    expect(html).not.toContain('>Generate<');
  });

  it('puts Planning on the step track only when the run plans', () => {
    const planning = render(
      <GenerationStatus status={{ kind: 'planning', receivedChars: 0 }} providerLabel="Anthropic" planned />
    );
    const thinking = render(<GenerationStatus status={{ kind: 'thinking', receivedChars: 0 }} providerLabel="A" />);

    expect(planning).toContain(ai.steps.planning);
    expect(planning).toContain(ai.status.planning);
    expect(planning).toContain('aria-current="step"');
    expect(thinking).not.toContain(ai.steps.planning);
    expect(thinking).not.toContain(ai.steps.polishing);
  });
});

describe('ResultCard advisories', () => {
  const summary = {
    name: 'Coffee',
    description: '',
    orientation: 'portrait',
    scenes: 2,
    footageScenes: 1,
    durationSeconds: 5.2,
    durationIsEstimate: false,
    effects: [],
  };

  it('counts the engine advisories and lists them, with hints, behind a disclosure', () => {
    const html = render(
      <ResultCard
        summary={summary}
        warnings={[]}
        advisories={[
          {
            path: 'sections[0]',
            code: 'palette_drift',
            message: 'sections[0]: #000000 is not in the theme palette',
            hint: 'use $color.* / $font.* tokens',
            severity: 'warn',
          },
          { path: 'sections[1]', code: 'dead_air', message: 'Nothing moves for 4s', severity: 'warn' },
        ]}
      />
    );

    expect(html).toContain('<details');
    expect(html).toContain('2 art-direction notes');
    expect(html).toContain('palette_drift');
    expect(html).toContain('use $color.* / $font.* tokens');
    expect(html).toContain('Nothing moves for 4s');
  });

  it('says so when the lint is clean', () => {
    expect(render(<ResultCard summary={summary} warnings={[]} advisories={[]} />)).toContain(ai.result.noAdvisories);
  });
});
