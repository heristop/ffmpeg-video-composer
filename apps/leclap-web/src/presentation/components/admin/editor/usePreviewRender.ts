// The builder's "Preview render" state machine, shared by the titlebar button and any other caller that
// should open the same preview dialog (the browser-agent render tool): compile the CURRENT descriptor
// through the real WASM pipeline with PLACEHOLDER media (bundled clips for project_video sections, form
// fields filled with their own labels) at native resolution with the ultrafast preset. One render at a
// time: a second start while one runs reports `busy` instead of queueing.
import { useState } from 'react';
import { coreCompilationService, type CompilationProgress } from '@/application/usecases/coreCompilationService';
import { CompileError, classifyCompileFailure, type CompileFailure } from '@/application/usecases/compile-failure';
import { logger } from '@/lib/logger';
import type { EditorState } from '../templateEditorModel';
import { buildPreviewPlan } from './previewRender';
import { generatePlaceholderClips } from './placeholderClips';

export interface PreviewRenderResult {
  url: string;
}

/** What the preview dialog shows. */
export interface PreviewRenderView {
  open: boolean;
  rendering: boolean;
  progress: CompilationProgress;
  result: PreviewRenderResult | null;
  failure: CompileFailure | null;
}

/** How a started render ended; `busy` when another preview render was already running. */
export type PreviewRenderOutcome =
  | { status: 'done'; url: string; elapsedMs: number }
  | { status: 'failed'; failure: CompileFailure; elapsedMs: number }
  | { status: 'busy' };

export interface PreviewRenderController {
  /** Open the dialog and render `state`; `signal` stops the render (best effort, see compileVideo). */
  start: (state: EditorState, signal?: AbortSignal) => Promise<PreviewRenderOutcome>;
  /** The dialog's onOpenChange: it stays open while a render runs, and closing it frees the output. */
  onOpenChange: (next: boolean) => void;
}

export type PreviewRender = PreviewRenderView & PreviewRenderController;

/** Renders the preview and resolves with the output's object URL. */
export type PreviewRenderer = (
  state: EditorState,
  onProgress: (progress: CompilationProgress) => void,
  signal?: AbortSignal
) => Promise<string>;

export const idlePreviewProgress: CompilationProgress = {
  stage: '',
  percentage: 0,
  currentStep: '',
  totalSteps: 7,
  currentStepIndex: 0,
};

export const idlePreviewView: PreviewRenderView = {
  open: false,
  rendering: false,
  progress: idlePreviewProgress,
  result: null,
  failure: null,
};

/** The default renderer: placeholder clips for the plan, then the shared WASM compile. */
export async function renderPreview(
  state: EditorState,
  onProgress: (progress: CompilationProgress) => void,
  signal?: AbortSignal
): Promise<string> {
  // Nothing to undo yet: skip fetching placeholder clips for a render that is already stopped.
  if (signal?.aborted) throw new CompileError({ kind: 'stopped', detail: '' }, { cause: signal.reason });
  const plan = buildPreviewPlan(state);
  const files = await generatePlaceholderClips(state, plan.clipCount);
  const compiled = await coreCompilationService.compileVideo(
    {
      template: plan.template,
      formData: plan.formData,
      files,
      videoConfig: plan.videoConfig,
      // The draft renders at native resolution (so absolute-pixel overlays line up), so push the
      // encoder to its fastest preset to keep it quick.
      preset: 'ultrafast',
    },
    onProgress,
    signal
  );

  return compiled.url;
}

/**
 * The framework-free half of usePreviewRender: `patch` merges into the view state. Guards against
 * concurrent renders (even if a button somehow fires twice) and owns the output's object URL.
 */
export function createPreviewRenderController(
  patch: (update: Partial<PreviewRenderView>) => void,
  render: PreviewRenderer = renderPreview,
  now: () => number = () => performance.now()
): PreviewRenderController {
  let inFlight = false;
  let lastUrl: string | null = null;

  const cleanupUrl = (): void => {
    if (lastUrl) URL.revokeObjectURL(lastUrl);
    lastUrl = null;
  };

  const start = async (state: EditorState, signal?: AbortSignal): Promise<PreviewRenderOutcome> => {
    if (inFlight) return { status: 'busy' };
    inFlight = true;
    cleanupUrl();
    patch({ open: true, rendering: true, failure: null, result: null, progress: idlePreviewProgress });
    const started = now();

    try {
      const onProgress = (progress: CompilationProgress): void => {
        patch({ progress });
      };
      const url = await render(state, onProgress, signal);
      lastUrl = url;
      patch({ result: { url } });

      return { status: 'done', url, elapsedMs: now() - started };
    } catch (error) {
      logger.error('Preview render failed:', error);
      const failure = classifyCompileFailure(error);
      patch({ failure });

      return { status: 'failed', failure, elapsedMs: now() - started };
    } finally {
      inFlight = false;
      patch({ rendering: false });
    }
  };

  const onOpenChange = (next: boolean): void => {
    // Keep the dialog open while a render is in flight so progress isn't lost.
    if (inFlight) return;
    patch({ open: next });

    if (!next) {
      cleanupUrl();
      patch({ result: null, failure: null });
    }
  };

  return { start, onOpenChange };
}

/** Preview-render state plus its controller; lift it to share one dialog between several triggers. */
export function usePreviewRender(): PreviewRender {
  const [view, setView] = useState<PreviewRenderView>(idlePreviewView);
  const [controller] = useState(() =>
    createPreviewRenderController((update) => {
      setView((previous) => ({ ...previous, ...update }));
    })
  );

  return { ...view, ...controller };
}
