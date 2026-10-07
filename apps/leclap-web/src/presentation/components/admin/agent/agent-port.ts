// The builder's BuilderPort: what the browser-agent tools may read and do, over the shell's live history,
// selection, partials, preview dialog and library. Every method reads `live.current` (kept fresh by the
// hook's layout effect), so registering once serves every later state. Consequential actions go through
// the page's own surfaces: renders open the same preview dialog the Preview button does, saves write the
// same projection the Save button writes (without leaving the builder).
import type { EditorHistory } from '@/hooks/useEditorHistory';
import type { StoredPartial } from '@/stores/userPartialStore';
import { userTemplateService } from '@/services/userTemplateService';
import type {
  ActivityInput,
  AgentFramesOutcome,
  AgentRenderOutcome,
  AgentSaveOutcome,
  BuilderPort,
} from '@/application/usecases/webmcp/types';
import type { BuilderToolName } from '@/application/usecases/webmcp/tool-names';
import { captureFrames, MAX_FRAME_BYTES } from '@/infrastructure/webmcp/frame-capture';
import { loadBundledFont } from '@/infrastructure/webmcp/font-loader';
import type { WebMcpSettings } from '@/infrastructure/webmcp/settings-store';
import type { PreviewRender } from '../editor/usePreviewRender';
import type { SelectionAction } from '../editor-shell/useEditorSelection';
import { toUserTemplate } from '../editor-shell/user-template';
import { saveBlockerText } from '../editor-shell/save-blocker.logic';
import type { ConfirmQueue } from './confirm-queue';

/** The overlay host (useShellModals): the agent drawer and its confirmations are the shell's 'agent' overlay. */
export interface AgentModalHost {
  active: string | null;
  open: (kind: 'agent') => void;
  close: (kind: 'agent') => void;
}

/** The shell's current values, read by every port call. */
export interface Live {
  history: EditorHistory;
  selectedIndex: number;
  dispatch: (action: SelectionAction) => void;
  modals: AgentModalHost;
  localPartials: StoredPartial[];
  settings: WebMcpSettings;
  preview: PreviewRender;
}

/** Per-page agent memory: tools the user allowed for this session, and the preview the agent rendered. */
export interface AgentSession {
  allowed: Set<BuilderToolName>;
  previewUrl: string | null;
}

export interface Feedback {
  report: (activity: ActivityInput) => void;
  highlight: (changed: number[]) => void;
}

function seconds(ms: number): number {
  return Math.round(ms / 100) / 10;
}

async function previewRender(live: { current: Live }, session: AgentSession, signal: AbortSignal) {
  const outcome = await live.current.preview.start(live.current.history.read().state, signal);

  if (outcome.status === 'busy') return { status: 'busy' } satisfies AgentRenderOutcome;

  if (outcome.status === 'failed') {
    const { kind, detail } = outcome.failure;

    return {
      status: 'failed',
      seconds: seconds(outcome.elapsedMs),
      failure: detail ? `${kind}: ${detail}` : kind,
    } satisfies AgentRenderOutcome;
  }

  session.previewUrl = outcome.url;

  return { status: 'done', seconds: seconds(outcome.elapsedMs) } satisfies AgentRenderOutcome;
}

async function frames(live: { current: Live }, session: AgentSession, at: number[], signal: AbortSignal) {
  const { preview } = live.current;
  const url = session.previewUrl;

  if (!url || !preview.open || preview.result?.url !== url) return { status: 'no_preview' } as AgentFramesOutcome;

  try {
    return { status: 'done', ...(await captureFrames(url, at, MAX_FRAME_BYTES, signal)) } as AgentFramesOutcome;
  } catch (error) {
    return { status: 'failed', failure: error instanceof Error ? error.message : String(error) } as AgentFramesOutcome;
  }
}

function save(live: { current: Live }): AgentSaveOutcome {
  const state = live.current.history.read().state;
  const blocker = saveBlockerText(state);

  if (blocker) return { saved: false, blocker };

  try {
    return { saved: true, id: userTemplateService.save(toUserTemplate(state)).id };
  } catch (error) {
    return { saved: false, blocker: error instanceof Error ? error.message : 'the write failed' };
  }
}

export function createPort(
  live: { current: Live },
  queue: ConfirmQueue,
  feedback: Feedback,
  session: AgentSession
): BuilderPort {
  const selectAndShow = (changed: number[]): void => {
    const first = changed.at(0);

    if (first !== undefined) live.current.dispatch({ type: 'selectScene', index: first });
    feedback.highlight(changed);
  };

  return {
    // The history closure, not the render mirror: a call right after an edit reads that edit.
    getState: () => live.current.history.read().state,
    getEditor: () => {
      const { canUndo, canRedo } = live.current.history.read();

      return { selectedIndex: live.current.selectedIndex, canUndo, canRedo };
    },
    commit: (next, meta) => {
      live.current.history.set(next);
      selectAndShow(meta.changed);
    },
    replace: (next, meta) => {
      live.current.history.reset(next);
      selectAndShow(meta.changed);
    },
    undoIfPresent: (state) => {
      if (live.current.history.read().state !== state) return false;

      live.current.history.undo();

      return true;
    },
    selectScene: (position) => {
      live.current.dispatch({ type: 'selectScene', index: position });
    },
    confirm: (request, signal) => {
      if (request.sessionAllowable && session.allowed.has(request.tool)) return Promise.resolve(true);

      const answer = queue.request(request, signal);
      live.current.modals.open('agent');

      return answer;
    },
    localPartials: () => live.current.localPartials,
    report: feedback.report,
    isDocumentVisible: () => document.visibilityState === 'visible',
    askBeforeEdit: () => live.current.settings.askBeforeEdit,
    previewRender: (signal) => previewRender(live, session, signal),
    captureFrames: (at, signal) => frames(live, session, at, signal),
    save: () => save(live),
    loadFont: loadBundledFont,
  };
}
