// The browser-agent tool layer's contracts. The tools know nothing about React or WebMCP: they read and
// change the builder only through a BuilderPort (implemented by the shell's useBuilderAgent hook, and by
// a fake over createHistory in tests), and the registry turns each ToolDefinition into a ToolSpec the
// WebMCP adapter registers.
import type { z } from 'zod';
import type { EditorState } from '@leclap/creative-kit/editor';
import type { StoredPartial } from '@/stores/userPartialStore';
import type { BuilderToolName } from './tool-names';

export interface TextContent {
  type: 'text';
  text: string;
}

/** A base64 image (render_frames); agents that cannot read images use the text part next to it. */
export interface ImageContent {
  type: 'image';
  data: string;
  mimeType: string;
}

/** The MCP CallToolResult shape agents already understand; always JSON-serializable. */
export interface ToolResult {
  content: Array<TextContent | ImageContent>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export type ToolErrorCode =
  | 'invalid_input'
  | 'too_large'
  | 'revision_conflict'
  | 'invalid_template'
  | 'builder_unsupported_section'
  | 'no_effect'
  | 'not_found'
  | 'user_declined'
  | 'needs_user_attention'
  | 'rate_limited'
  | 'busy'
  | 'disabled'
  | 'aborted'
  | 'render_failed'
  | 'save_blocked'
  | 'unavailable';

/**
 * read: no state change. edit: one undoable history step. consequential: replaces the draft, renders or
 * saves — confirmed in the page first (render_frames rides on its preview's consent).
 */
export type ToolKind = 'read' | 'edit' | 'consequential';

/**
 * Optional builder features a tool can depend on; the hook re-registers when the set changes: the WASM
 * preview render (render_preview, render_frames), saving to the library, and replacing the whole draft.
 */
export type BuilderCapability = 'preview-render' | 'save' | 'replace';

/** never: run directly. ask-before-edit: confirm when the user turned that setting on. always: confirm. */
export type ConfirmPolicy = 'never' | 'ask-before-edit' | 'always';

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
  consequentialHint?: boolean;
}

/** What the page asks the user before an agent action runs. The UI words it from `tool`. */
export interface ConfirmRequest {
  tool: BuilderToolName;
  kind: ToolKind;
  /** The agent's own one-line reason, sanitized; shown as plain text. */
  note?: string;
  /** Tool-specific facts the dialog may show (a render's estimated seconds, the sample's title…). */
  detail?: Record<string, string | number>;
  /** The dialog may offer "allow for this session" (later requests of this tool then skip the dialog). */
  sessionAllowable?: boolean;
}

/** One finished call, for the activity log and the live region. */
export interface ActivityInput {
  tool: BuilderToolName;
  kind: ToolKind;
  status: 'ok' | 'error' | 'declined';
  code?: ToolErrorCode;
  /** Editor positions the call changed (highlighted in the timeline). */
  changed: number[];
  /** The state an edit produced: its log entry can undo it while this is still the present state. */
  produced?: EditorState;
  note?: string;
}

/** What a commit changed: the positions to highlight and select. */
export interface CommitMeta {
  tool: BuilderToolName;
  changed: number[];
}

export interface EditorSnapshot {
  selectedIndex: number;
  canUndo: boolean;
  canRedo: boolean;
}

/** How a preview render the agent asked for ended; `seconds` is wall-clock render time. */
export type AgentRenderOutcome =
  | { status: 'done'; seconds: number }
  | { status: 'failed'; seconds: number; failure: string }
  | { status: 'busy' };

/** A save the agent asked for. */
export type AgentSaveOutcome = { saved: true; id: string } | { saved: false; blocker: string };

/** One JPEG grabbed from the agent's own preview output. */
export interface CapturedFrame {
  at: number;
  /** Base64, no data: prefix. */
  data: string;
  bytes: number;
  width: number;
  height: number;
}

/** Frames from the preview the agent rendered, or why there are none. */
export type AgentFramesOutcome =
  | { status: 'done'; durationSeconds: number; frames: CapturedFrame[] }
  | { status: 'no_preview' }
  | { status: 'failed'; failure: string };

/** Fetches a bundled font's bytes (for the geometry advisories); null when it is not available. */
export type FontBytesLoader = (fontFile: string) => Promise<Uint8Array | null>;

/** The only surface the tools touch. Every method reads live state; none throws by contract. */
export interface BuilderPort {
  getState: () => EditorState;
  getEditor: () => EditorSnapshot;
  /** One `history.set(next)`: a single undo step. */
  commit: (next: EditorState, meta: CommitMeta) => void;
  /** `history.reset(next)` for replacing the whole draft (phase 2's replace_template / load_sample). */
  replace: (next: EditorState, meta: CommitMeta) => void;
  /** Undoes once if `state` is still the present state; false otherwise. */
  undoIfPresent: (state: EditorState) => boolean;
  selectScene: (position: number) => void;
  /** Asks in the page; resolves false on Cancel, dismissal, timeout or `signal` abort. */
  confirm: (request: ConfirmRequest, signal: AbortSignal) => Promise<boolean>;
  /** The user's own partials, for partial refs and validation. */
  localPartials: () => StoredPartial[];
  report: (activity: ActivityInput) => void;
  isDocumentVisible: () => boolean;
  /** The "Ask before every edit" setting. */
  askBeforeEdit: () => boolean;
  /** Capability 'preview-render': renders the current draft in the user's own preview dialog. */
  previewRender?: (signal: AbortSignal) => Promise<AgentRenderOutcome>;
  /** Capability 'preview-render': JPEG frames (seconds `at`) of the preview the agent last rendered. */
  captureFrames?: (at: number[], signal: AbortSignal) => Promise<AgentFramesOutcome>;
  /** Capability 'save': saves the draft to the library without leaving the builder. */
  save?: () => AgentSaveOutcome;
  /** Bundled fonts for render-free geometry advisories; without it they are measured approximately. */
  loadFont?: FontBytesLoader;
}

/** What a tool's run gets besides its parsed input. */
export interface ToolContext {
  port: BuilderPort;
  signal: AbortSignal;
  /** The page origin, for the media URL policy. */
  origin: string;
  /** Commit through the call so the registry can log and undo it; use instead of port.commit. */
  commit: (next: EditorState, changed: number[]) => void;
  /** Install a whole new draft (port.replace) through the call: logged and undoable like a commit. */
  replace: (next: EditorState, changed: number[]) => void;
  /** Undoes the newest agent step still present; false when the user has edited since. */
  undoAgentStep: () => boolean;
}

/** A tool as authored: a zod input and a run function. */
export interface ToolDefinition<Input extends z.ZodType = z.ZodType> {
  name: BuilderToolName;
  title: string;
  description: string;
  kind: ToolKind;
  input: Input;
  /** Extra hints beyond the ones `kind` implies (e.g. untrustedContentHint for user content). */
  annotations?: ToolAnnotations;
  /** Defaults: read → never, edit → ask-before-edit, consequential → always. */
  confirm?: ConfirmPolicy;
  /** Registered only when the builder has this capability. */
  requires?: BuilderCapability;
  /** Refuses early, before the user is asked: never confirm something that would fail anyway. */
  check?(args: z.infer<Input>, context: ToolContext): ToolResult | null | Promise<ToolResult | null>;
  /** Facts for the confirmation dialog, from the parsed input and the live builder. */
  confirmDetail?(args: z.infer<Input>, port: BuilderPort): ConfirmRequest['detail'] | Promise<ConfirmRequest['detail']>;
  /** The dialog offers "allow for this session" for this tool. */
  sessionAllowable?: boolean;
  /** Least time between two runs of this tool (counted from when a run starts). */
  cooldownMs?: number;
  // Method syntax on purpose: definitions with different inputs share one array (bivariant args).
  run(args: z.infer<Input>, context: ToolContext): ToolResult | Promise<ToolResult>;
}

/** A tool as registered: JSON Schema input and a guarded execute. */
export interface ToolSpec {
  name: BuilderToolName;
  title: string;
  description: string;
  kind: ToolKind;
  confirm: ConfirmPolicy;
  inputSchema: Record<string, unknown>;
  annotations: ToolAnnotations;
  execute: (input: unknown, options?: { signal?: AbortSignal }) => Promise<ToolResult>;
}

export interface BuilderToolOptions {
  capabilities: ReadonlySet<BuilderCapability>;
  origin: string;
  /** Clock for the rate limiter (tests). */
  now?: () => number;
}

/** Keeps a definition's input type for its run function while authoring. */
export function defineTool<Input extends z.ZodType>(definition: ToolDefinition<Input>): ToolDefinition<Input> {
  return definition;
}
