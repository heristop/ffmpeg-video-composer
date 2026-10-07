// A BuilderPort over the real pure editor model (createHistory + toEditorState), for the tool-layer
// tests: commits are history steps, undo is the history's own, and confirmations answer from a script.
import { createHistory, toEditorState, type EditorState } from '@leclap/creative-kit/editor';
import type { StoredPartial } from '@/stores/userPartialStore';
import { buildBuilderTools } from './registry';
import type {
  ActivityInput,
  AgentFramesOutcome,
  AgentRenderOutcome,
  BuilderCapability,
  BuilderPort,
  CommitMeta,
  ConfirmRequest,
  ToolResult,
} from './types';

export interface FakePort extends BuilderPort {
  activity: ActivityInput[];
  commits: CommitMeta[];
  confirms: ConfirmRequest[];
  selected: number;
  /** What the next confirmations answer (default true). */
  answers: boolean[];
  visible: boolean;
  ask: boolean;
  partials: StoredPartial[];
  replaces: CommitMeta[];
  /** What previewRender / captureFrames answer, and how often they ran. */
  renderOutcome: AgentRenderOutcome;
  renders: number;
  framesOutcome: AgentFramesOutcome;
  saved: string[];
  /** A user edit, outside the agent. */
  userSet: (next: EditorState) => void;
  undo: () => void;
}

export const TEST_ORIGIN = 'https://leclap.test';

/** Calls a tool by name through the registry (rate limits, parsing and reporting included). */
export const ALL_CAPABILITIES: ReadonlySet<BuilderCapability> = new Set(['preview-render', 'save', 'replace']);

export function toolCaller(
  port: BuilderPort,
  now: () => number = () => 0,
  capabilities: ReadonlySet<BuilderCapability> = ALL_CAPABILITIES
) {
  const tools = buildBuilderTools(port, { capabilities, origin: TEST_ORIGIN, now });

  return async (name: string, args: unknown = {}): Promise<ToolResult & { data: Record<string, unknown> }> => {
    const tool = tools.find((candidate) => candidate.name === name);

    if (!tool) throw new Error(`no tool ${name}`);

    const result = await tool.execute(args);

    return { ...result, data: result.structuredContent ?? {} };
  };
}

export function createFakePort(initial: EditorState = toEditorState(null)): FakePort {
  const history = createHistory(initial);
  const port: FakePort = {
    activity: [],
    commits: [],
    confirms: [],
    selected: 0,
    answers: [],
    visible: true,
    ask: false,
    partials: [],
    replaces: [],
    renderOutcome: { status: 'done', seconds: 12 },
    renders: 0,
    framesOutcome: { status: 'no_preview' },
    saved: [],
    getState: () => history.state,
    getEditor: () => ({ selectedIndex: port.selected, canUndo: history.canUndo, canRedo: history.canRedo }),
    commit: (next, meta) => {
      history.set(next);
      port.commits.push(meta);
    },
    replace: (next, meta) => {
      history.set(next);
      port.replaces.push(meta);
    },
    previewRender: () => {
      port.renders += 1;

      return Promise.resolve(port.renderOutcome);
    },
    captureFrames: () => Promise.resolve(port.framesOutcome),
    save: () => {
      port.saved.push(history.state.id);

      return { saved: true, id: history.state.id };
    },
    undoIfPresent: (state) => {
      if (history.state !== state) return false;

      history.undo();

      return true;
    },
    selectScene: (position) => {
      port.selected = position;
    },
    confirm: (request) => {
      port.confirms.push(request);

      return Promise.resolve(port.answers.shift() ?? true);
    },
    localPartials: () => port.partials,
    report: (activity) => {
      port.activity.push(activity);
    },
    isDocumentVisible: () => port.visible,
    askBeforeEdit: () => port.ask,
    userSet: (next) => {
      history.set(next);
    },
    undo: () => {
      history.undo();
    },
  };

  return port;
}
