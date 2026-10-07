// "Generate with AI": a focused sheet over the builder. Describe the video, optionally let Jev read
// the brief, then generate with your own provider key. The result opens as a new draft through the
// editor history (one Undo brings the previous draft back); replacing a draft with edits asks first.
// Lazy-loaded by the shell, so the prompt material (schema, samples, catalog) loads only on open.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { findProvider } from '@/infrastructure/ai/registry';
import { JEV_KEY_ID } from '@/infrastructure/ai/typesafe-jev';
import type { EditorState } from '../templateEditorModel';
import { canGenerate, isRunning } from './ai-generation.logic';
import { AiDialogFrame } from './AiDialogFrame';
import { BriefFields } from './BriefFields';
import { DialogFooterActions } from './DialogFooterActions';
import { GenerationStatus } from './GenerationStatus';
import { JevPanel } from './JevPanel';
import { PlanOptions } from './PlanOptions';
import { PlanReview } from './PlanReview';
import { planIsComplete } from './plan-review.logic';
import { ProviderSettings } from './ProviderSettings';
import { ReferenceStyleSection } from './ReferenceStyleSection';
import { ResultCard } from './ResultCard';
import { generatedToEditorState, needsReplaceConfirmation } from './load-generated';
import {
  effectiveHints,
  preferredSamples,
  routeChips,
  withoutThemeHint,
  type Orientation,
  type RouteChip,
  type RouteOverrides,
} from './route-decisions';
import { useAiGeneration } from './use-ai-generation';
import { useApiKey } from './use-api-key';

export interface GenerateWithAiDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // The current draft has edits (Undo is available): replacing it asks first.
  hasUnsavedWork: boolean;
  onLoad: (state: EditorState) => void;
}

const KEY_INPUT_ID = 'ai-generate-provider-key';

// Brings the provider key field into view and focuses it, once the disclosure holding it has opened.
function focusKeyField(): void {
  requestAnimationFrame(() => {
    const input = document.getElementById(KEY_INPUT_ID);
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    input?.focus({ preventScroll: true });
    input?.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
  });
}

function useBriefState() {
  const [brief, setBrief] = useState('');
  const [orientation, setOrientation] = useState<Orientation | 'auto'>('auto');
  const [duration, setDuration] = useState('auto');
  const [providerId, setProviderId] = useState('anthropic');
  const [models, setModels] = useState<Record<string, string>>({});
  const [overrides, setOverrides] = useState<RouteOverrides>({});
  const [planFirst, setPlanFirst] = useState(true);
  const [reviewPlan, setReviewPlan] = useState(true);
  const provider = findProvider(providerId);

  return {
    brief,
    setBrief,
    orientation,
    setOrientation,
    duration,
    setDuration,
    provider,
    setProviderId,
    model: models[provider.id] ?? provider.defaultModel,
    setModel: (model: string) => {
      setModels((current) => ({ ...current, [provider.id]: model }));
    },
    overrides,
    toggle: (chip: RouteChip) => {
      setOverrides((current) => ({ ...current, [chip.field]: !chip.on }));
    },
    resetOverrides: () => {
      setOverrides({});
    },
    planFirst,
    setPlanFirst,
    reviewPlan,
    setReviewPlan,
  };
}

// Why Generate is disabled, and — when the key is what's missing — the one-tap way to add it.
type AiT = ReturnType<typeof useTranslation<'ai'>>['t'];

function blockedCopy(t: AiT, hasKey: boolean, provider: string, onAddKey: () => void) {
  if (hasKey) return { blockedReason: t('footer.needBrief') };

  return {
    blockedReason: t('footer.needKey', { provider }),
    blockedAction: { label: t('footer.addKey'), onClick: onAddKey },
  };
}

const GenerateWithAiDialog = ({ open, onOpenChange, hasUnsavedWork, onLoad }: GenerateWithAiDialogProps) => {
  const { t } = useTranslation('ai');
  const form = useBriefState();
  const run = useAiGeneration();
  const { key } = useApiKey(form.provider.id);
  const jev = useApiKey(JEV_KEY_ID);
  const [pending, setPending] = useState<EditorState | null>(null);
  // Binding style rules from "Match a reference", or null when no reference is attached.
  const [referenceStyle, setReferenceStyle] = useState<string | null>(null);
  // The provider group starts open while the chosen provider has no key; "Add key" reopens it.
  const [providerOpen, setProviderOpen] = useState(key === '');
  const chips = run.route.kind === 'ready' ? routeChips(run.route.route, form.overrides) : [];
  const running = isRunning(run.status) || run.route.kind === 'routing';
  // A plan under review belongs to the current brief: the form waits until it is written or dropped.
  const locked = running || run.status.kind === 'plan-ready';
  const ready = canGenerate(form.brief, key, run.status) && run.route.kind !== 'routing';
  const userHints = {
    orientation: form.orientation,
    durationSeconds: form.duration === 'auto' ? null : Number(form.duration),
  };

  const close = (): void => {
    run.cancel();
    setPending(null);
    onOpenChange(false);
  };

  const load = (state: EditorState): void => {
    if (needsReplaceConfirmation(hasUnsavedWork) && pending === null) {
      setPending(state);

      return;
    }
    onLoad(state);
    run.reset();
    close();
  };

  const generate = async (): Promise<void> => {
    const route = run.route.kind === 'none' && jev.key ? await run.analyse(form.brief, jev.key) : null;
    const routed = route ? routeChips(route, {}) : chips;
    await run.generate({
      provider: form.provider,
      model: form.model.trim() || form.provider.defaultModel,
      apiKey: key,
      brief: form.brief,
      hints: withoutThemeHint(effectiveHints(routed, userHints), referenceStyle),
      preferSampleIds: preferredSamples(routed),
      planFirst: form.planFirst,
      reviewPlan: form.reviewPlan,
      ...(referenceStyle ? { referenceStyle } : {}),
    });
  };

  return (
    <AiDialogFrame
      open={open}
      onClose={close}
      title={t('title')}
      subtitle={t('subtitle')}
      onSubmit={
        ready && pending === null
          ? () => {
              generate().catch(() => {});
            }
          : undefined
      }
      footer={
        <DialogFooterActions
          status={run.status}
          confirming={pending !== null}
          canGenerate={ready}
          statusSlot={
            <GenerationStatus status={run.status} providerLabel={form.provider.label} planned={form.planFirst} />
          }
          {...blockedCopy(t, key !== '', form.provider.label, () => {
            setProviderOpen(true);
            focusKeyField();
          })}
          onGenerate={() => {
            generate().catch(() => {});
          }}
          onCancel={run.cancel}
          onOpen={() => {
            if (run.status.kind === 'ready') load(generatedToEditorState(run.status.result.descriptor, t('title')));
          }}
          onConfirmReplace={() => {
            if (pending) {
              onLoad(pending);
              run.reset();
              close();
            }
          }}
          onKeepEditing={() => {
            setPending(null);
          }}
          canWritePlan={run.status.kind === 'plan-ready' && planIsComplete(run.status.plan)}
          onWritePlan={() => {
            if (run.status.kind === 'plan-ready') run.writeFromPlan(run.status.plan).catch(() => {});
          }}
          onRegenerate={() => {
            setPending(null);
            run.reset();
          }}
        />
      }
    >
      <div className="grid grid-cols-[minmax(0,1fr)] gap-7">
        <BriefFields
          brief={form.brief}
          onBriefChange={(value) => {
            form.setBrief(value);
            form.resetOverrides();
            run.clearRoute();
          }}
          orientation={form.orientation}
          onOrientationChange={form.setOrientation}
          duration={form.duration}
          onDurationChange={form.setDuration}
          disabled={locked}
        />
        <JevPanel
          hasKey={jev.key !== ''}
          brief={form.brief}
          route={run.route}
          chips={chips}
          onToggle={form.toggle}
          onAnalyse={() => {
            run.analyse(form.brief, jev.key).catch(() => {});
          }}
          onStartFromMatch={load}
          disabled={locked}
        />
        <PlanOptions
          planFirst={form.planFirst}
          onPlanFirstChange={form.setPlanFirst}
          reviewPlan={form.reviewPlan}
          onReviewPlanChange={form.setReviewPlan}
          disabled={locked}
        />
        <div className="grid gap-3">
          <ReferenceStyleSection
            attached={referenceStyle !== null}
            onAttach={(style) => {
              setReferenceStyle(style.promptRules);
            }}
            onDetach={() => {
              setReferenceStyle(null);
            }}
            disabled={running}
          />
          <ProviderSettings
            open={providerOpen}
            onOpenChange={setProviderOpen}
            keyInputId={KEY_INPUT_ID}
            provider={form.provider}
            model={form.model}
            onProviderChange={form.setProviderId}
            onModelChange={form.setModel}
          />
        </div>
        {run.status.kind === 'plan-ready' && <PlanReview plan={run.status.plan} onChange={run.editPlan} />}
        {run.status.kind === 'ready' && (
          <ResultCard
            summary={run.status.summary}
            warnings={run.status.result.warnings}
            advisories={run.status.result.advisories}
          />
        )}
      </div>
    </AiDialogFrame>
  );
};

export default GenerateWithAiDialog;
