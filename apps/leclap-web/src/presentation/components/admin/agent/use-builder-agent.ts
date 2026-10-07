// The builder's side of WebMCP: builds the tool layer's BuilderPort (agent-port.ts) over the shell's
// history, selection, partials, preview dialog and library, and registers the tools with the browser's
// ModelContext — once per enabled / capability change, never per render: tools read live state through
// a ref the layout effect keeps current. It also owns the preview render the Preview button shares and the
// agent drawer, which with the confirmations forms the shell's 'agent' overlay. The tool layer itself is a lazy chunk imported on idle, only when the browser has WebMCP
// (natively, or the dev polyfill) and the user left the toggle on. Turning it off, or leaving the
// builder, aborts every registration (the agent sees `toolchange`) and declines pending confirmations.
import { useEffect, useLayoutEffect, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import type { EditorHistory } from '@/hooks/useEditorHistory';
import type { StoredPartial } from '@/stores/userPartialStore';
import type { ActivityInput, BuilderCapability, BuilderPort, ToolSpec } from '@/application/usecases/webmcp/types';
import type { BuilderToolName } from '@/application/usecases/webmcp/tool-names';
import { detectModelContext, registerTools } from '@/infrastructure/webmcp/model-context';
import type { ModelContextLike, ModelContextTool } from '@/infrastructure/webmcp/types';
import { loadWebMcpPolyfill, POLYFILL_BUILD, polyfillRequested } from '@/infrastructure/webmcp/polyfill';
import { webMcpSettings, type WebMcpSettings } from '@/infrastructure/webmcp/settings-store';
import type { SelectionAction } from '../editor-shell/useEditorSelection';
import { usePreviewRender, type PreviewRender } from '../editor/usePreviewRender';
import { createPort, type AgentModalHost, type AgentSession, type Live } from './agent-port';
import {
  activityReducer,
  ANNOUNCE_DELAY_MS,
  canUndoEntry,
  HIGHLIGHT_MS,
  liveSummary,
  pillState,
  type ActivityEntry,
  type LiveSummary,
  type PillState,
} from './agent-activity.logic';
import { createConfirmQueue, type ConfirmQueue, type PendingConfirm } from './confirm-queue';

/** `VITE_WEBMCP=0` removes the browser-agent tools from the build. */
const WEBMCP_BUILD = import.meta.env.VITE_WEBMCP !== '0';

/** What this builder offers the consequential tools: saving and replacing always, renders with WebAssembly. */
export function builderCapabilities(): BuilderCapability[] {
  const capabilities: BuilderCapability[] = ['replace', 'save'];

  if (typeof WebAssembly === 'object') capabilities.push('preview-render');

  return capabilities;
}

/** A stable effect dependency for a capability set. */
function capabilityKey(capabilities: BuilderCapability[]): string {
  return [...capabilities].sort().join(',');
}

export type WebMcpSupport = 'pending' | 'native' | 'polyfill' | 'none';

export type { AgentModalHost } from './agent-port';

export interface BuilderAgentArgs {
  history: EditorHistory;
  selectedIndex: number;
  dispatch: (action: SelectionAction) => void;
  modals: AgentModalHost;
  localPartials: StoredPartial[];
}

export interface BuilderAgent {
  /** The browser can host tools (natively or through the dev polyfill): show the pill. */
  available: boolean;
  support: WebMcpSupport;
  settings: WebMcpSettings;
  setSettings: (patch: Partial<WebMcpSettings>) => void;
  state: PillState;
  entries: ActivityEntry[];
  canUndo: (entry: ActivityEntry) => boolean;
  undo: (entry: ActivityEntry) => void;
  /** Editor positions an agent just changed (the timeline rings them). */
  highlighted: ReadonlySet<number>;
  /** What the live region announces; `id` changes with every announcement. */
  live: (LiveSummary & { id: number }) | null;
  /** The confirmation on screen while the shell shows the 'agent' overlay. */
  confirm: PendingConfirm | null;
  /** The user's answer; `remember` allows that tool for the rest of the session (when it offers that). */
  answer: (id: number, accepted: boolean, remember?: boolean) => void;
  /** The activity drawer (the 'agent' overlay, opened from the pill). */
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  /** The preview dialog the Preview button and render_preview share. */
  preview: PreviewRender;
  /** Tools the browser refused to register, if any. */
  problem: string | null;
}

// Whether this page can host tools: native WebMCP, else the dev polyfill when the page asks for it.
function initialSupport(storedPolyfill: boolean): WebMcpSupport {
  if (!WEBMCP_BUILD) return 'none';

  if (detectModelContext()) return 'native';

  const search = typeof window === 'undefined' ? '' : window.location.search;

  return polyfillRequested({ buildAllows: POLYFILL_BUILD, search, storedFlag: storedPolyfill }) ? 'pending' : 'none';
}

function useWebMcpSupport(storedPolyfill: boolean): WebMcpSupport {
  const [support, setSupport] = useState<WebMcpSupport>(() => initialSupport(storedPolyfill));

  useEffect(() => {
    if (support !== 'pending') return () => {};

    let current = true;
    loadWebMcpPolyfill()
      .then((loaded) => {
        if (current) setSupport(loaded && detectModelContext() ? 'polyfill' : 'none');
      })
      .catch(() => {});

    return () => {
      current = false;
    };
  }, [support]);

  return support;
}

// Brief rings on the scene cards an agent edit changed.
function useHighlight(): [ReadonlySet<number>, (changed: number[]) => void] {
  const [highlighted, setHighlighted] = useState<ReadonlySet<number>>(() => new Set());
  const timer = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const highlight = (changed: number[]): void => {
    if (changed.length === 0) return;

    if (timer.current) clearTimeout(timer.current);
    setHighlighted(new Set(changed));
    timer.current = setTimeout(() => {
      setHighlighted(new Set());
    }, HIGHLIGHT_MS);
  };

  return [highlighted, highlight];
}

// The activity log plus the batched live-region summary.
function useActivityFeed() {
  const [entries, dispatch] = useReducer(activityReducer, []);
  const [live, setLive] = useState<(LiveSummary & { id: number }) | null>(null);
  const batch = useRef<ActivityInput[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout>>(null);
  const sequence = useRef(0);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const report = (activity: ActivityInput): void => {
    sequence.current += 1;
    const id = sequence.current;
    dispatch({ type: 'add', entry: { ...activity, id, at: Date.now() } });
    batch.current.push(activity);

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const summary = liveSummary(batch.current);
      batch.current = [];

      if (summary) setLive({ ...summary, id });
    }, ANNOUNCE_DELAY_MS);
  };

  return { entries, live, report };
}

function withProgress(spec: ToolSpec, track: (delta: number) => void): ModelContextTool {
  return {
    name: spec.name,
    title: spec.title,
    description: spec.description,
    inputSchema: spec.inputSchema,
    annotations: spec.annotations,
    execute: async (input, options) => {
      track(1);

      try {
        return await spec.execute(input, options);
      } finally {
        track(-1);
      }
    },
  };
}

// Runs `task` when the browser is idle (or soon, where requestIdleCallback is missing); returns a cancel.
function whenIdle(task: () => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    const handle = requestIdleCallback(task, { timeout: 2000 });

    return () => {
      cancelIdleCallback(handle);
    };
  }

  const timer = setTimeout(task, 1);

  return () => {
    clearTimeout(timer);
  };
}

interface RegistrationArgs {
  context: ModelContextLike | null;
  port: BuilderPort;
  queue: ConfirmQueue;
  track: (delta: number) => void;
  onProblem: (problem: string | null) => void;
}

// Registers the tools on idle while enabled; the cleanup unregisters them and declines what is waiting.
function useAgentRegistration(enabled: boolean, args: RegistrationArgs): void {
  const { context, port, queue, track, onProblem } = args;
  const capabilities = capabilityKey(builderCapabilities());

  useEffect(() => {
    if (!enabled || !context) return () => {};

    const controller = new AbortController();
    const register = async (): Promise<void> => {
      const { buildBuilderTools } = await import('@/application/usecases/webmcp/registry');

      if (controller.signal.aborted) return;

      const offered = new Set(capabilities.split(',').filter(Boolean) as BuilderCapability[]);
      const specs = buildBuilderTools(port, { capabilities: offered, origin: window.location.origin });
      const reports = await registerTools(
        context,
        specs.map((spec) => withProgress(spec, track)),
        controller.signal
      );
      const failed = reports.filter((report) => !report.ok && !controller.signal.aborted);

      onProblem(failed.length > 0 ? failed.map((report) => `${report.name}: ${report.error ?? ''}`).join('; ') : null);
    };
    const start = (): void => {
      register().catch((error: unknown) => {
        onProblem(error instanceof Error ? error.message : String(error));
      });
    };
    const cancelIdle = whenIdle(start);

    return () => {
      cancelIdle();
      controller.abort();
      queue.declineAll();
    };
  }, [enabled, context, port, queue, track, onProblem, capabilities]);
}

// The activity drawer and the confirmations share the shell's 'agent' overlay: a confirmation stacks over
// an open drawer, and one that arrives with the drawer closed shows alone and closes the overlay once
// answered. Another overlay taking over closes both (and declines what is waiting).
function useAgentOverlay(modals: AgentModalHost, queue: ConfirmQueue, session: AgentSession) {
  const [requested, setRequested] = useState(false);
  const drawerOpen = requested && modals.active === 'agent';

  return {
    drawerOpen,
    setDrawerOpen: (open: boolean): void => {
      setRequested(open);

      if (open) modals.open('agent');

      if (!open && !queue.head()) modals.close('agent');
    },
    answer: (id: number, accepted: boolean, remember = false): void => {
      const tool = queue.head()?.request.tool;

      if (accepted && remember && tool) session.allowed.add(tool);
      queue.answer(id, accepted);

      if (!queue.head() && !drawerOpen) modals.close('agent');
    },
  };
}

export function useBuilderAgent({
  history,
  selectedIndex,
  dispatch,
  modals,
  localPartials,
}: BuilderAgentArgs): BuilderAgent {
  const settings = useSyncExternalStore(webMcpSettings.subscribe, webMcpSettings.get, webMcpSettings.get);
  const support = useWebMcpSupport(settings.polyfill);
  const preview = usePreviewRender();
  const live = useRef<Live>({ history, selectedIndex, dispatch, modals, localPartials, settings, preview });
  const feed = useActivityFeed();
  const [highlighted, highlight] = useHighlight();
  const [inFlight, setInFlight] = useState(0);
  const [track] = useState(() => (delta: number) => {
    setInFlight((count) => count + delta);
  });
  const [problem, setProblem] = useState<string | null>(null);
  const [queue] = useState(createConfirmQueue);
  const [session] = useState<AgentSession>(() => ({ allowed: new Set<BuilderToolName>(), previewUrl: null }));
  const [port] = useState(() => createPort(live, queue, { report: feed.report, highlight }, session));
  const pending = useSyncExternalStore(queue.subscribe, queue.head, queue.head);
  const available = support === 'native' || support === 'polyfill';
  const overlay = useAgentOverlay(modals, queue, session);

  useLayoutEffect(() => {
    live.current = { history, selectedIndex, dispatch, modals, localPartials, settings, preview };
  });

  // One overlay at a time: another overlay replacing the confirmation declines it.
  useEffect(() => {
    if (pending && modals.active !== 'agent') queue.declineAll();
  }, [pending, modals.active, queue]);

  // The same object every time ([SameObject]), so it is a stable effect dependency.
  const context = available ? detectModelContext() : null;
  useAgentRegistration(available && settings.enabled, { context, port, queue, track, onProblem: setProblem });

  return {
    available,
    support,
    settings,
    setSettings: (patch) => {
      webMcpSettings.set(patch);
    },
    state: pillState(available && settings.enabled, inFlight),
    entries: feed.entries,
    canUndo: (entry) => canUndoEntry(entry, history.state),
    undo: (entry) => {
      if (entry.produced) port.undoIfPresent(entry.produced);
    },
    highlighted,
    live: feed.live,
    confirm: modals.active === 'agent' ? pending : null,
    problem,
    preview,
    ...overlay,
  };
}
