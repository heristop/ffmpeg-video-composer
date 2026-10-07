import { useEffect, useRef, useState, type RefObject } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Seo } from '@/presentation/components/Seo';
import { EditorShell, CompileMonitor, StepResult, type SaveStatus } from '@/presentation/components/builder';
import { EditorLoadingShell } from '@/presentation/components/builder/editor-loading-shell';
import { renderPhase, type RenderPhase } from '@/presentation/components/builder/render-phase';
import { orientationOf } from '@/presentation/components/builder/editorPanels';
import { useVideoProcessing, type ProcessedVideo, type MediaChoices } from '@/hooks/useVideoProcessing';
import { templateService, type Template, type InputSection, type QualityTier } from '@/services/templateService';
import { bindFieldContracts, fieldSatisfied } from '@/presentation/components/template-form-fields.logic';
import { findMusicByUrl } from '@/data/mediaCatalog';
import { type VideoEdit } from '@/domain/valueObjects/videoEdits';
import type { MediaChoice } from '@/presentation/components/admin/templateEditorModel';
import { type WizardModel, EMPTY_MODEL } from '@/lib/wizardModel';
import { addRush, selectRush, removeRush } from '@/lib/rushActions';
import { loadProject, loadOutput, saveDraft, saveCompleted } from '@/services/projectService';
import { Loader2 } from '@/presentation/components/icons';

// The template's default soundtrack as a library MediaChoice, so the Music step opens pre-selected on
// the track the template was authored with. Only when music is enabled and the default is one of the
// offered tracks; otherwise null (leave the step empty).
const defaultMusicChoice = (template: Template): MediaChoice | null => {
  const global = template.descriptor.global;
  const name = global?.music?.name;

  if (!global?.musicEnabled || !name) return null;

  const track = findMusicByUrl(`/musics/${name}`);

  if (!track) return null;

  const allowed = global.allowedMusic;

  if (allowed && allowed.length > 0 && !allowed.includes(track.id)) return null;

  return { source: 'library', id: track.id };
};

// ── Dynamic, section-driven step model ─────────────────────────────────────────────────────────
// The wizard walks the template's sections IN ORDER: a step per `form` section and a step per
// `project_video` clip, then (if the template offers media) a Music/Background step, then Create
// and Result. Each input step is gated — you can't advance until it's complete.
type WizardStep =
  | { kind: 'template' }
  | { kind: 'form'; sectionName: string; section: InputSection }
  | { kind: 'clip'; sectionName: string; clipIndex: number; section: InputSection }
  | { kind: 'media' }
  | { kind: 'process' }
  | { kind: 'result' };

const templateNeedsMediaStep = (template: Template): boolean => {
  const g = template.descriptor.global ?? {};

  return (
    (g.allowedMusic?.length ?? 0) > 0 ||
    Boolean(g.allowUploadMusic) ||
    (g.allowedBackgrounds?.length ?? 0) > 0 ||
    Boolean(g.allowUploadBackground)
  );
};

const totalClips = (template: Template): number =>
  templateService.orderedInputSections(template.descriptor).filter((s) => s.kind === 'clip').length;

// Build the ordered step list for a chosen template.
const buildSteps = (template: Template): WizardStep[] => {
  const steps: WizardStep[] = [{ kind: 'template' }];

  for (const section of templateService.orderedInputSections(template.descriptor)) {
    if (section.kind === 'form') {
      steps.push({ kind: 'form', sectionName: section.name, section });
      continue;
    }

    steps.push({ kind: 'clip', sectionName: section.name, clipIndex: section.clipIndex, section });
  }

  if (templateNeedsMediaStep(template)) {
    steps.push({ kind: 'media' });
  }

  steps.push({ kind: 'process' }, { kind: 'result' });

  return steps;
};

interface BuilderState {
  selectedTemplate: Template | null;
  clipsBySection: Record<string, File>;
  rushesBySection: Record<string, File[]>;
  formData: Record<string, string>;
  musicChoice: MediaChoice | null;
  backgroundChoice: MediaChoice | null;
}

// Whether a single step's required input is satisfied.
const isStepComplete = (step: WizardStep, s: BuilderState): boolean => {
  if (step.kind === 'form') {
    const descriptor = s.selectedTemplate?.descriptor;
    const fields = descriptor
      ? bindFieldContracts(templateService.extractFormFieldsForSection(descriptor, step.sectionName), descriptor)
      : [];

    // A field bound to a declared global.fields entry with a default (or an optional text) may stay empty.
    return fields.every((f) => fieldSatisfied(f, s.formData[f.name] ?? ''));
  }

  if (step.kind === 'clip') {
    return Boolean(s.clipsBySection[step.sectionName]);
  }

  return true; // template/media/process/result never block forward movement
};

// Every input step (form + clip) complete → the template is ready to compile.
const allInputsComplete = (steps: WizardStep[], s: BuilderState): boolean =>
  steps.filter((st) => st.kind === 'form' || st.kind === 'clip').every((st) => isStepComplete(st, s));

type ProcessProgress = ReturnType<typeof useVideoProcessing>['progress'];

// Callbacks the flow needs — bundled so the flow component takes one prop instead of a dozen.
interface WizardHandlers {
  onFormDataChange: (d: Record<string, string>) => void;
  onClipChange: (sectionName: string, file: File | undefined) => void;
  onAddRush: (sectionName: string, file: File) => void;
  onSelectRush: (sectionName: string, file: File) => void;
  onRemoveRush: (sectionName: string, file: File) => void;
  onEditChange: (sectionName: string, edit: VideoEdit | undefined) => void;
  onMusicChange: (c: MediaChoice | null) => void;
  onBackgroundChange: (c: MediaChoice | null) => void;
  onStartProcessing: () => void;
  onCancelProcessing: () => void;
  onRetryProcessing: () => void;
  onBackToEdit: () => void;
  onResultBack: () => void;
  onReset: () => void;
}

interface FlowProps {
  selectedTemplate: Template | null;
  model: WizardModel;
  steps: WizardStep[];
  stepIndex: number;
  clipCount: number;
  builderState: BuilderState;
  allComplete: boolean;
  processedVideo: ProcessedVideo | null;
  processing: {
    isFFmpegReady: boolean;
    isProcessing: boolean;
    canProcess: boolean;
    progress: ProcessProgress;
    error: ReturnType<typeof useVideoProcessing>['error'];
  };
  // The user stopped the current render; see renderPhase.
  stopped: boolean;
  qualityTier: QualityTier;
  onQualityTierChange: (tier: QualityTier) => void;
  handlers: WizardHandlers;
  goTo: (i: number) => void;
  nextStep: () => void;
  prevStep: () => void;
  saveStatus: SaveStatus;
  lastSavedAt: number | null;
}

// Index of the process step, and of the last input step before it — where a stopped or failed render,
// and "Keep editing" from the result, hand the viewer back to.
const processIndex = (steps: WizardStep[]): number => steps.findIndex((s) => s.kind === 'process');
const editIndex = (steps: WizardStep[]): number => Math.max(0, processIndex(steps) - 1);

interface PhaseContentProps {
  phase: RenderPhase;
  template: Template;
  model: WizardModel;
  processedVideo: ProcessedVideo | null;
  processing: FlowProps['processing'];
  qualityTier: QualityTier;
  handlers: WizardHandlers;
}

// The shell body for the two phases beyond editing: the render monitor (running or failed), then the
// finished video.
const PhaseContent = ({
  phase,
  template,
  model,
  processedVideo,
  processing,
  qualityTier,
  handlers,
}: PhaseContentProps) => {
  if (phase === 'result' && processedVideo) {
    return (
      <StepResult
        processedVideo={processedVideo}
        title={template.name}
        orientation={orientationOf(template)}
        onBack={handlers.onResultBack}
        onReset={handlers.onReset}
      />
    );
  }

  if (phase !== 'processing') return null;

  return (
    <CompileMonitor
      template={template}
      clipFiles={Object.values(model.clipsBySection)}
      formData={model.formData}
      isProcessing={processing.isProcessing}
      progress={processing.progress}
      error={processing.error}
      qualityTier={qualityTier}
      onCancel={handlers.onCancelProcessing}
      onRetry={handlers.onRetryProcessing}
      onBackToEdit={handlers.onBackToEdit}
    />
  );
};

// The editor flow: one fullscreen EditorShell hosts every phase — editing scenes, the render and its
// result. The template chooser lives on the studio home: with nothing selected, the editor has
// nothing to edit, so bounce there.
const HubFlow = (p: FlowProps) => {
  const { selectedTemplate, model, handlers } = p;

  if (!selectedTemplate) {
    return <Navigate to="/studio" replace />;
  }

  const phase = renderPhase({
    hasResult: Boolean(p.processedVideo),
    isProcessing: p.processing.isProcessing,
    failed: p.processing.error !== null,
    stopped: p.stopped,
  });

  const phaseContent = (
    <PhaseContent
      phase={phase}
      template={selectedTemplate}
      model={model}
      processedVideo={p.processedVideo}
      processing={p.processing}
      qualityTier={p.qualityTier}
      handlers={handlers}
    />
  );

  return (
    <EditorShell
      template={selectedTemplate}
      model={model}
      clipCount={p.clipCount}
      showMedia={templateNeedsMediaStep(selectedTemplate)}
      allComplete={p.allComplete}
      phase={phase}
      phaseContent={phaseContent}
      saveStatus={p.saveStatus}
      lastSavedAt={p.lastSavedAt}
      qualityTier={p.qualityTier}
      onQualityTierChange={p.onQualityTierChange}
      onFormDataChange={handlers.onFormDataChange}
      onClipChange={handlers.onClipChange}
      onAddRush={handlers.onAddRush}
      onSelectRush={handlers.onSelectRush}
      onRemoveRush={handlers.onRemoveRush}
      onEditChange={handlers.onEditChange}
      onMusicChange={handlers.onMusicChange}
      onBackgroundChange={handlers.onBackgroundChange}
      onCreate={handlers.onStartProcessing}
      onCancel={handlers.onCancelProcessing}
      onExit={handlers.onReset}
    />
  );
};

// Inputs needed to assemble the shared handler bundle. Kept as a single arg object so the helper
// stays under the max-params limit.
interface ActionDeps {
  model: WizardModel;
  selectedTemplate: Template | null;
  steps: WizardStep[];
  stepIndex: number;
  allComplete: boolean;
  qualityTier: QualityTier;
  setSelectedTemplate: (t: Template | null) => void;
  setModel: (value: WizardModel | ((m: WizardModel) => WizardModel)) => void;
  setStopped: (stopped: boolean) => void;
  processVideo: ReturnType<typeof useVideoProcessing>['processVideo'];
  cancelProcessing: ReturnType<typeof useVideoProcessing>['cancelProcessing'];
  clearResults: ReturnType<typeof useVideoProcessing>['clearResults'];
}

// Builds every callback the flows need. Pure factory (no hooks) so it doesn't bloat the component.
const makeWizardActions = (deps: ActionDeps) => {
  const { model, selectedTemplate, steps, stepIndex, allComplete, qualityTier, setSelectedTemplate, setModel } = deps;
  const { setStopped } = deps;
  const update = (patch: Partial<WizardModel>) => {
    setModel((m) => ({ ...m, ...patch }));
  };
  const goTo = (i: number) => {
    update({ stepIndex: Math.min(Math.max(i, 0), steps.length - 1) });
  };
  // A clip arriving from the recorder/upload is a new take: append it as a rush (auto-selecting the
  // first). Clearing the clip removes the currently-selected take from the section.
  const setClip = (sectionName: string, file: File | undefined) => {
    setModel((m) => {
      if (file) return { ...m, ...addRush(m, sectionName, file) };

      if (!Object.hasOwn(m.clipsBySection, sectionName)) return m;

      return { ...m, ...removeRush(m, sectionName, m.clipsBySection[sectionName]) };
    });
  };
  // The render's outcome is not written back into the step index: processVideo settles the same way
  // whether it succeeded, failed or was stopped, and reading the step from it once parked failures and
  // stops on an empty result screen. The shell reads the outcome from the render state instead
  // (renderPhase).
  const startProcessing = () => {
    if (!selectedTemplate || !allComplete) return;
    const mediaChoices: MediaChoices = { music: model.musicChoice, background: model.backgroundChoice };
    setStopped(false);
    goTo(processIndex(steps));
    deps
      .processVideo(
        model.clipsBySection,
        { ...selectedTemplate, formData: model.formData },
        model.editsBySection,
        mediaChoices,
        qualityTier
      )
      .catch((error_: unknown) => {
        console.error('Processing error', error_);
      });
  };
  const handlers: WizardHandlers = {
    onFormDataChange: (d) => {
      update({ formData: d });
    },
    onClipChange: setClip,
    onAddRush: (sectionName, file) => {
      setModel((m) => ({ ...m, ...addRush(m, sectionName, file) }));
    },
    onSelectRush: (sectionName, file) => {
      setModel((m) => ({ ...m, ...selectRush(m, sectionName, file) }));
    },
    onRemoveRush: (sectionName, file) => {
      setModel((m) => ({ ...m, ...removeRush(m, sectionName, file) }));
    },
    onEditChange: (name, edit) => {
      update({ editsBySection: { ...model.editsBySection, [name]: edit } });
    },
    onMusicChange: (c) => {
      update({ musicChoice: c });
    },
    onBackgroundChange: (c) => {
      update({ backgroundChoice: c });
    },
    onStartProcessing: startProcessing,
    // Stopping hands the viewer straight back to the scene they were on: once the render is gone the
    // monitor has nothing left to show.
    onCancelProcessing: () => {
      deps.cancelProcessing();
      setStopped(true);
      goTo(editIndex(steps));
    },
    onRetryProcessing: startProcessing,
    onBackToEdit: () => {
      deps.clearResults();
      goTo(editIndex(steps));
    },
    onResultBack: () => {
      update({ stepIndex: 1 });
    },
    onReset: () => {
      setSelectedTemplate(null);
      setModel(EMPTY_MODEL);
    },
  };

  return {
    handlers,
    goTo,
    nextStep: () => {
      goTo(stepIndex + 1);
    },
    prevStep: () => {
      goTo(stepIndex - 1);
    },
  };
};

interface PersistenceArgs {
  selectedTemplate: Template | null;
  model: WizardModel;
  currentStepKind: WizardStep['kind'] | undefined;
  isProcessing: boolean;
  processedVideo: ProcessedVideo | null;
  setSelectedTemplate: (template: Template | null) => void;
  setModel: (model: WizardModel) => void;
}

// For a completed project decide where to open it: `edit` drops into the first input step (no result
// loaded); otherwise jump to the result step and materialize the rendered video for re-viewing.
const resolveCompletedOpen = async (
  result: Extract<Awaited<ReturnType<typeof loadProject>>, { ok: true }>,
  edit: boolean
): Promise<{ stepIndex: number; hydrated: ProcessedVideo | null }> => {
  const steps = buildSteps(result.template);

  if (edit) {
    const inputIndex = steps.findIndex((step) => step.kind === 'form' || step.kind === 'clip');

    return { stepIndex: inputIndex >= 0 ? inputIndex : result.model.stepIndex, hydrated: null };
  }

  const resultIndex = steps.findIndex((step) => step.kind === 'result');
  const output = await loadOutput(result.project);
  const hydrated = output
    ? { blob: output.blob, url: URL.createObjectURL(output.blob), size: output.size, duration: output.duration }
    : null;

  return { stepIndex: resultIndex >= 0 ? resultIndex : result.model.stepIndex, hydrated };
};

// Functional URL updater that swaps the volatile `?template=` for the durable `?projectId=` once a
// draft exists. Returned as an updater so the save effect avoids closing over a stale `projectIdParam`.
const reflectProjectId =
  (projectId: string) =>
  (prev: URLSearchParams): URLSearchParams => {
    if (prev.get('projectId') === projectId) return prev;
    const next = new URLSearchParams(prev);
    next.delete('template');
    next.set('projectId', projectId);

    return next;
  };

// Prompt before unload while `dirty` (an edit awaiting its debounced/in-flight save). A clean
// session attaches nothing, so it never prompts. Both calls are needed for cross-browser support.
const useUnsavedChangesWarning = (dirty: boolean) => {
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      // preventDefault is the spec path; the legacy returnValue assignment keeps Chrome/Safari prompting.
      e.preventDefault();
      (e as { returnValue: string }).returnValue = '';
    };

    if (dirty) window.addEventListener('beforeunload', handler);

    return () => {
      window.removeEventListener('beforeunload', handler);
    };
  }, [dirty]);
};

interface AutoSaveArgs {
  selectedTemplate: Template | null;
  model: WizardModel;
  currentStepKind: WizardStep['kind'] | undefined;
  isProcessingRef: RefObject<boolean>;
  hydratingRef: RefObject<boolean>;
  skipNextSaveRef: RefObject<boolean>;
  currentProjectIdRef: RefObject<string | null>;
  setSearchParams: ReturnType<typeof useSearchParams>[1];
}

// A draft is worth persisting only once it carries real user input — a recorded/uploaded clip, an
// entered form field, or a video edit. A freshly-opened template (which already carries its default
// soundtrack) is otherwise empty and must NOT spawn a stored project, or the library fills with blank
// "0 clips" drafts the user never actually started.
const modelHasContent = (model: WizardModel): boolean =>
  Object.keys(model.clipsBySection).length > 0 ||
  Object.values(model.rushesBySection).some((takes) => takes.length > 0) ||
  Object.values(model.formData).some((value) => value.trim() !== '') ||
  Object.values(model.editsBySection).some(Boolean);

// Debounced draft auto-save (only while editing an input step) plus the unsaved-changes prompt.
// Extracted from useProjectPersistence to keep that hook within its statement budget.
const useDraftAutoSave = (args: AutoSaveArgs) => {
  const { selectedTemplate, model, currentStepKind, isProcessingRef, hydratingRef } = args;
  const { skipNextSaveRef, currentProjectIdRef, setSearchParams } = args;
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  // Dirty since the last edit but the debounced save hasn't landed — guards the close/refresh window.
  const [pendingSave, setPendingSave] = useState(false);

  useEffect(() => {
    const onResultOrProcess = currentStepKind === 'process' || currentStepKind === 'result';
    // Don't auto-save an empty draft — only persist once the project has real content (see above).
    const blocked =
      !selectedTemplate ||
      onResultOrProcess ||
      isProcessingRef.current ||
      hydratingRef.current ||
      !modelHasContent(model);
    let handle: ReturnType<typeof setTimeout> | undefined;

    if (!blocked) {
      const consume = skipNextSaveRef.current;
      skipNextSaveRef.current = false;

      if (!consume) {
        const template = selectedTemplate;
        setPendingSave(true);
        handle = setTimeout(() => {
          setSaveStatus('saving');
          saveDraft(model, template, currentProjectIdRef.current ?? undefined)
            .then((saved) => {
              currentProjectIdRef.current = saved.id;
              // Reflect the auto-created id into the URL so a refresh resumes THIS draft (not a blank build).
              setSearchParams(reflectProjectId(saved.id), { replace: true });
              setSaveStatus('saved');
              setLastSavedAt(Date.now());
              setPendingSave(false);
            })
            .catch(() => {
              // Keep pendingSave true — the change is still unsaved.
              setSaveStatus('error');
            });
        }, 600);
      }
    }

    return () => {
      if (handle) clearTimeout(handle);
    };
  }, [
    model,
    selectedTemplate,
    currentStepKind,
    setSearchParams,
    isProcessingRef,
    hydratingRef,
    skipNextSaveRef,
    currentProjectIdRef,
  ]);

  useUnsavedChangesWarning(pendingSave || saveStatus === 'saving');

  return { saveStatus, lastSavedAt };
};

// Owns project persistence for the builder: hydrating from `?projectId`, debounced draft auto-save,
// and recording the finished render. Split out so useBuilderController stays small.
const useProjectPersistence = (args: PersistenceArgs) => {
  const { selectedTemplate, model, currentStepKind, isProcessing, processedVideo, setSelectedTemplate, setModel } =
    args;
  const [searchParams, setSearchParams] = useSearchParams();
  const projectIdParam = searchParams.get('projectId');

  // The project this session writes to (assigned on the first auto-save, or on hydration).
  const currentProjectIdRef = useRef<string | null>(null);
  // Suppresses the no-op auto-save that the state update right after hydration would otherwise trigger.
  const skipNextSaveRef = useRef(false);
  // The output blob already persisted, so re-renders don't re-save the same finished video.
  const savedOutputRef = useRef<Blob | null>(null);
  const isProcessingRef = useRef(isProcessing);
  isProcessingRef.current = isProcessing;
  const [hydrating, setHydrating] = useState(Boolean(projectIdParam));
  const hydratingRef = useRef(hydrating);
  hydratingRef.current = hydrating;
  // A completed project's output, materialized from IndexedDB so the result re-opens without a recompile.
  const [hydratedResult, setHydratedResult] = useState<ProcessedVideo | null>(null);

  useEffect(() => {
    // Read the cancel flag through a function so the linter can't narrow it to a literal (which a
    // closed-over boolean it sees only assigned `false`/`true` otherwise becomes).
    const run = { cancelled: false };
    const cancelled = () => run.cancelled;
    // `?edit=1` re-opens a completed project at its inputs (to change & re-render) rather than its result.
    const editParam = searchParams.get('edit') === '1';

    // The URL change we make after our own first save lands back here — don't reload from disk
    // (it would clobber in-memory state and flash `hydrating`); the live session already owns this id.
    if (projectIdParam && projectIdParam === currentProjectIdRef.current) {
      return () => {
        run.cancelled = true;
      };
    }

    if (projectIdParam) {
      setHydrating(true);
      loadProject(projectIdParam)
        .then(async (result) => {
          if (cancelled()) return;

          if (!result.ok) {
            setHydrating(false);

            return;
          }

          skipNextSaveRef.current = true;
          currentProjectIdRef.current = result.project.id;
          setSelectedTemplate(result.template);

          let nextModel = result.model;

          if (result.project.status === 'completed') {
            const opened = await resolveCompletedOpen(result, editParam);
            nextModel = { ...result.model, stepIndex: opened.stepIndex };

            if (!cancelled() && opened.hydrated) {
              savedOutputRef.current = opened.hydrated.blob;
              setHydratedResult(opened.hydrated);
            }
          }

          if (cancelled()) return;

          setModel(nextModel);
          setHydrating(false);
        })
        .catch(() => {
          if (!cancelled()) setHydrating(false);
        });
    }

    return () => {
      run.cancelled = true;
    };
  }, [projectIdParam, searchParams, setSelectedTemplate, setModel]);

  useEffect(
    () => () => {
      if (hydratedResult) URL.revokeObjectURL(hydratedResult.url);
    },
    [hydratedResult]
  );

  // Debounced draft auto-save (only while editing an input step) plus the unsaved-changes prompt.
  const { saveStatus, lastSavedAt } = useDraftAutoSave({
    selectedTemplate,
    model,
    currentStepKind,
    isProcessingRef,
    hydratingRef,
    skipNextSaveRef,
    currentProjectIdRef,
    setSearchParams,
  });

  // Record a finished render against the current project.
  useEffect(() => {
    const projectId = currentProjectIdRef.current;
    const output = processedVideo;

    if (output && projectId && savedOutputRef.current !== output.blob) {
      savedOutputRef.current = output.blob;
      saveCompleted(projectId, { blob: output.blob, size: output.size, duration: output.duration }).catch(
        (saveError: unknown) => {
          console.error('Saving finished video failed', saveError);
        }
      );
    }
  }, [processedVideo]);

  const resetProject = () => {
    currentProjectIdRef.current = null;
    skipNextSaveRef.current = true;
    savedOutputRef.current = null;
    setHydratedResult(null);

    if (projectIdParam) setSearchParams({}, { replace: true });
  };

  // Clear only the hydrated (saved-project) result without tearing down the project id / URL, so
  // "Back" from the result screen returns to editing the SAME draft.
  const clearHydratedResult = () => {
    savedOutputRef.current = null;
    setHydratedResult(null);
  };

  return { hydrating, hydratedResult, resetProject, clearHydratedResult, saveStatus, lastSavedAt };
};

interface PreselectArgs {
  setSelectedTemplate: (template: Template | null) => void;
  setModel: (model: WizardModel) => void;
  // The template handed in via nav state (gallery click). When present we already have it synchronously,
  // so the editor renders its titlebar in the first frame — letting the card-title View Transition land —
  // and the async fetch below is skipped.
  presetId: string | null;
}

// `/studio/new?template=<id>` (no project) opens the editor straight on a template: fetch it and seed
// the empty model with its default soundtrack — the same effect as picking it in the gallery. The
// `appliedRef` guards against re-running the apply for an id we've already handled, so the effect
// can't loop on its own setState (which leaves the param untouched).
const useTemplatePreselect = ({ setSelectedTemplate, setModel, presetId }: PreselectArgs) => {
  const [searchParams] = useSearchParams();
  const templateParam = searchParams.get('template');
  const projectIdParam = searchParams.get('projectId');
  // A nav-state template for the current param is already applied, so seed appliedRef and never resolve.
  const appliedRef = useRef<string | null>(presetId && presetId === templateParam ? templateParam : null);
  const [resolving, setResolving] = useState(
    Boolean(templateParam) && !projectIdParam && appliedRef.current !== templateParam
  );

  useEffect(() => {
    const pending = { cancelled: false };
    const skip = Boolean(projectIdParam) || !templateParam || appliedRef.current === templateParam;

    if (skip) {
      setResolving(false);
    }

    if (!skip && templateParam) {
      setResolving(true);
      templateService
        .getTemplate(templateParam)
        .then((template) => {
          if (pending.cancelled) return;
          appliedRef.current = templateParam;

          if (template) {
            setSelectedTemplate(template);
            setModel({ ...EMPTY_MODEL, musicChoice: defaultMusicChoice(template) });
          }

          setResolving(false);
        })
        .catch(() => {
          if (!pending.cancelled) setResolving(false);
        });
    }

    return () => {
      pending.cancelled = true;
    };
  }, [templateParam, projectIdParam, setSelectedTemplate, setModel]);

  return { templateParam, projectIdParam, resolving };
};

// The template a gallery click hands over through router nav state (so the editor renders synchronously
// and the card-title View Transition has a target). Null for direct loads / refreshes, which re-fetch.
const navStateTemplate = (state: unknown): Template | null =>
  (state as { template?: Template } | null)?.template ?? null;

// A project open (/projects) can't hand over a full template synchronously — it hydrates async from
// `?projectId`. So it passes only the project NAME through nav state, letting the loading branch render
// a `studio-title` target that the project-card title morphs into. Kept distinct from the `template`
// key above so it never seeds builder state.
const navStateProjectTitle = (state: unknown): string | null =>
  (state as { projectTitle?: string } | null)?.projectTitle ?? null;

// Seed the wizard model on a preselected template with its default soundtrack, matching gallery pick.
const initialModelFor = (template: Template | null): WizardModel =>
  template ? { ...EMPTY_MODEL, musicChoice: defaultMusicChoice(template) } : EMPTY_MODEL;

const templateId = (template: Template | null): string | null => template?.id ?? null;

// Derived, render-only values shared by the flow — split out so useBuilderController's own statement
// count stays under budget as it grows (e.g. adding the quality-tier choice).
const deriveFlowBasics = (selectedTemplate: Template | null, model: WizardModel, steps: WizardStep[]) => {
  const stepIndex = Math.min(model.stepIndex, steps.length - 1);
  const currentStepKind = steps[stepIndex]?.kind;
  const clipCount = selectedTemplate ? totalClips(selectedTemplate) : 0;
  const builderState: BuilderState = { ...model, selectedTemplate };
  const allComplete = allInputsComplete(steps, builderState);

  return { stepIndex, currentStepKind, clipCount, builderState, allComplete };
};

// A Stop pressed while the engine is still loading can't reach it (coreCompilationService.cancel drops
// it), so that render runs on and its video still lands. The viewer asked for it to stop: hide what it
// produces and let the late video go, rather than pulling them out of the editor into a result they
// cancelled.
const useStoppedRender = (processedVideo: ProcessedVideo | null, clearResults: () => void) => {
  const [stopped, setStopped] = useState(false);

  useEffect(() => {
    if (stopped && processedVideo) clearResults();
  }, [stopped, processedVideo, clearResults]);

  return { stopped, setStopped, liveResult: stopped ? null : processedVideo };
};

// Owns all wizard state + derived values + actions, so the Builder component is render-only.
const useBuilderController = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const presetTemplate = navStateTemplate(location.state);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(presetTemplate);
  const [model, setModel] = useState<WizardModel>(() => initialModelFor(presetTemplate));
  // Render-quality choice for this session — not part of the persisted draft (WizardModel), so it
  // resets to the standard default on every fresh visit rather than round-tripping through storage.
  const [qualityTier, setQualityTier] = useState<QualityTier>('standard');
  const { isProcessing, progress, processedVideo, error, processVideo, cancelProcessing, clearResults, isFFmpegReady } =
    useVideoProcessing();
  const { stopped, setStopped, liveResult } = useStoppedRender(processedVideo, clearResults);
  const { templateParam, projectIdParam, resolving } = useTemplatePreselect({
    setSelectedTemplate,
    setModel,
    presetId: templateId(presetTemplate),
  });
  const steps: WizardStep[] = selectedTemplate ? buildSteps(selectedTemplate) : [{ kind: 'template' }];
  const { stepIndex, currentStepKind, clipCount, builderState, allComplete } = deriveFlowBasics(
    selectedTemplate,
    model,
    steps
  );

  const { hydrating, hydratedResult, resetProject, clearHydratedResult, saveStatus, lastSavedAt } =
    useProjectPersistence({
      selectedTemplate,
      model,
      currentStepKind,
      isProcessing,
      processedVideo: liveResult,
      setSelectedTemplate,
      setModel,
    });

  const actions = makeWizardActions({
    model,
    selectedTemplate,
    steps,
    stepIndex,
    allComplete,
    qualityTier,
    setSelectedTemplate,
    setModel,
    setStopped,
    processVideo,
    cancelProcessing,
    clearResults,
  });

  const handlers: WizardHandlers = {
    ...actions.handlers,
    // "Back" from the result screen: the result view is rendered whenever a processed video exists
    // (regardless of stepIndex), so clear BOTH the fresh-process result and any hydrated one — else the
    // guard keeps re-showing the result and Back appears to do nothing — then return to the last input
    // step to keep editing the same draft.
    onResultBack: () => {
      clearResults();
      clearHydratedResult();
      const backTo = editIndex(steps);
      setModel((m) => ({ ...m, stepIndex: backTo }));
    },
    // "Change template" / back: leave the editor and return to the gallery to pick another. The
    // unmount tears down the session; resetProject still runs so any in-flight project ref is cleared.
    onReset: () => {
      resetProject();
      Promise.resolve(navigate('/studio')).catch(() => {});
    },
  };

  const flowProps: FlowProps = {
    selectedTemplate,
    model,
    steps,
    stepIndex,
    clipCount,
    builderState,
    allComplete,
    processedVideo: liveResult ?? hydratedResult,
    processing: {
      isFFmpegReady,
      isProcessing,
      canProcess: Boolean(selectedTemplate) && isFFmpegReady && allComplete,
      progress,
      error,
    },
    stopped,
    qualityTier,
    onQualityTierChange: setQualityTier,
    handlers,
    goTo: actions.goTo,
    nextStep: actions.nextStep,
    prevStep: actions.prevStep,
    saveStatus,
    lastSavedAt,
  };

  // Nothing to edit (no template/project param and nothing selected) → the chooser lives on /studio.
  const needsTemplate = !templateParam && !projectIdParam && !selectedTemplate && !resolving && !hydrating;

  // Title hint a project open passes through nav state — the morph target while the project hydrates.
  const projectTitle = navStateProjectTitle(location.state);

  return { hydrating, resolving, flowProps, needsTemplate, projectTitle };
};

export const Builder = () => {
  const { t } = useTranslation('builder');
  const { hydrating, resolving, flowProps, needsTemplate, projectTitle } = useBuilderController();

  // No template/project to edit → send the user to the gallery to pick one.
  if (needsTemplate) {
    return <Navigate to="/studio" replace />;
  }

  return (
    <div className="dark min-h-[calc(100vh-4rem)] bg-background text-foreground relative overflow-hidden">
      <h1 className="sr-only">{t('srHeading')}</h1>
      <Seo
        title={t('studio.title', { ns: 'seo' })}
        description={t('studio.description', { ns: 'seo' })}
        path="/studio/new"
        noindex
      />
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-brand-500/15 rounded-full blur-[120px] animate-float" />
        <div
          className="absolute bottom-0 right-1/4 w-96 h-96 bg-secondary-400/10 rounded-full blur-[120px] animate-float"
          style={{ animationDelay: '-3s' }}
        />
      </div>
      <div className="mx-auto w-full max-w-6xl px-4 pt-24 pb-24 relative z-10">
        {hydrating || resolving ? (
          <>
            {/* A project open carries its title via nav state: render the editor-shaped loading shell so
                the `studio-title` morph from the card lands in the title's FINAL position (the real
                EditorShell then mounts in the identical spot — no jump). */}
            {projectTitle && <EditorLoadingShell title={projectTitle} />}
            {!projectTitle && (
              <div className="fade-in flex min-h-[40vh] flex-col items-center justify-center gap-3 text-gray-400">
                <Loader2 className="h-7 w-7 animate-spin text-brand-500 motion-reduce:animate-none" />
                <p className="text-sm font-medium">{t('project.loading')}</p>
              </div>
            )}
          </>
        ) : (
          <HubFlow {...flowProps} />
        )}
      </div>
    </div>
  );
};
