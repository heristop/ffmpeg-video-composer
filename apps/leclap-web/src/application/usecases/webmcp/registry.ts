// Turns the tool definitions into registrable ToolSpecs: zod inputs become JSON Schema (top-level
// `type: "object"`), annotations follow each tool's kind, and every execute runs behind the same guard —
// abort check, input size, per-kind rate limit, zod parse, one mutating call at a time, the in-page
// confirmation its policy asks for — then reports the call to the activity log. Only this module is
// imported lazily by the builder (on idle, once WebMCP is present and enabled).
//
// A definition with `requires` registers only when the builder reports that capability; `kind:
// 'consequential'` tools get consequentialHint plus an `always` confirmation by default, answer
// needs_user_attention while the tab is hidden (never an unseen dialog), and may set a cooldown
// (render_preview: one run per 30 s; one at a time follows from the single mutating slot).
import { z } from 'zod';
import type { EditorState } from '@leclap/creative-kit/editor';
import { createRateLimiter, inputBytes, MAX_INPUT_BYTES, sanitizeText, type RateLimiter } from './guard';
import { capOutput, errorCode, fail } from './results';
import { READ_TOOLS } from './read-tools';
import { REFERENCE_TOOLS } from './reference-tools';
import { VALIDATE_TOOLS } from './validate-tools';
import { EDIT_TOOLS } from './edit-tools';
import { GLOBAL_TOOLS } from './global-tools';
import { CONSEQUENTIAL_TOOLS } from './consequential-tools';
import type {
  ActivityInput,
  BuilderPort,
  ConfirmRequest,
  BuilderToolOptions,
  ConfirmPolicy,
  ToolAnnotations,
  ToolContext,
  ToolDefinition,
  ToolResult,
  ToolSpec,
} from './types';

export const BUILDER_TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  ...READ_TOOLS,
  ...REFERENCE_TOOLS,
  ...VALIDATE_TOOLS,
  ...EDIT_TOOLS,
  ...GLOBAL_TOOLS,
  ...CONSEQUENTIAL_TOOLS,
];

const DEFAULT_CONFIRM: Record<ToolDefinition['kind'], ConfirmPolicy> = {
  read: 'never',
  edit: 'ask-before-edit',
  consequential: 'always',
};

export function annotationsFor(definition: ToolDefinition): ToolAnnotations {
  return {
    readOnlyHint: definition.kind === 'read',
    ...(definition.kind === 'consequential' ? { consequentialHint: true } : {}),
    ...definition.annotations,
  };
}

export function inputSchemaOf(definition: ToolDefinition): Record<string, unknown> {
  const { $schema: _dialect, ...schema } = z.toJSONSchema(definition.input, { io: 'input' }) as Record<string, unknown>;

  return { ...schema, type: 'object' };
}

/** State shared by one registration's tools. */
interface Session {
  limiter: RateLimiter;
  busy: boolean;
  /** States the agent's edits produced, oldest first. */
  steps: EditorState[];
  /** When each cooldown-bound tool last started a run. */
  lastRun: Map<string, number>;
  now: () => number;
}

function needsConfirm(policy: ConfirmPolicy, port: BuilderPort): boolean {
  return policy === 'always' || (policy === 'ask-before-edit' && port.askBeforeEdit());
}

function noteOf(args: unknown): string | undefined {
  const note = (args as { note?: unknown } | null)?.note;

  return typeof note === 'string' && note.trim() !== '' ? sanitizeText(note).slice(0, 200) : undefined;
}

function cooldownLeft(definition: ToolDefinition, session: Session): number {
  const last = session.lastRun.get(definition.name);

  if (!definition.cooldownMs || last === undefined) return 0;

  return Math.max(0, definition.cooldownMs - (session.now() - last));
}

// Guards that run before parsing: abort, size, attention, cooldown, rate.
function precheck(definition: ToolDefinition, raw: unknown, signal: AbortSignal, deps: ExecuteDeps): ToolResult | null {
  const { session, port } = deps;

  if (signal.aborted) return fail('aborted', 'The call was cancelled.');

  if (inputBytes(raw) > MAX_INPUT_BYTES) return fail('too_large', 'The input is larger than 512 KB.');

  if (definition.kind === 'consequential' && !port.isDocumentVisible()) return needsAttention();

  const wait = cooldownLeft(definition, session);

  if (wait > 0) {
    const every = String((definition.cooldownMs ?? 0) / 1000);

    return fail('rate_limited', `${definition.name} runs at most once every ${every} s.`, { retryAfterMs: wait });
  }

  const rate = session.limiter.take(definition.kind);

  return rate.ok ? null : fail('rate_limited', 'Too many calls; wait and retry.', { retryAfterMs: rate.retryAfterMs });
}

function parse(definition: ToolDefinition, raw: unknown): { args: unknown } | ToolResult {
  const parsed = definition.input.safeParse(raw ?? {});

  if (parsed.success) return { args: parsed.data };

  const issues = parsed.error.issues
    .slice(0, 10)
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);

  return fail('invalid_input', `Invalid input: ${issues.join('; ')}`);
}

function needsAttention(): ToolResult {
  return fail('needs_user_attention', 'The builder tab is in the background; ask the user to switch to it.');
}

interface CallRecord {
  produced?: EditorState;
  changed: number[];
}

function contextFor(
  definition: ToolDefinition,
  port: BuilderPort,
  signal: AbortSignal,
  origin: string,
  session: Session
) {
  const record: CallRecord = { changed: [] };
  const step = (next: EditorState, changed: number[]): void => {
    record.produced = next;
    record.changed = changed;
    session.steps.push(next);
  };
  const context: ToolContext = {
    port,
    signal,
    origin,
    commit: (next, changed) => {
      port.commit(next, { tool: definition.name, changed });
      step(next, changed);
    },
    replace: (next, changed) => {
      port.replace(next, { tool: definition.name, changed });
      step(next, changed);
    },
    undoAgentStep: () => {
      const present = port.getState();
      const index = session.steps.lastIndexOf(present);

      if (index === -1) return false;

      session.steps.length = index;

      return port.undoIfPresent(present);
    },
  };

  return { context, record };
}

async function confirmed(definition: ToolDefinition, args: unknown, port: BuilderPort, signal: AbortSignal) {
  if (!needsConfirm(definition.confirm ?? DEFAULT_CONFIRM[definition.kind], port)) return null;

  if (!port.isDocumentVisible()) return needsAttention();

  const detail = await definition.confirmDetail?.(args, port);
  const request: ConfirmRequest = {
    tool: definition.name,
    kind: definition.kind,
    note: noteOf(args),
    ...(detail ? { detail } : {}),
    ...(definition.sessionAllowable ? { sessionAllowable: true } : {}),
  };
  const accepted = await port.confirm(request, signal);

  return accepted ? null : fail('user_declined', 'The user declined this action in the page.');
}

// Check, confirm, then run: a refusal at any step leaves the builder untouched.
async function checkedRun(definition: ToolDefinition, args: unknown, context: ToolContext, deps: ExecuteDeps) {
  const early = await definition.check?.(args, context);

  if (early) return early;

  const refused = await confirmed(definition, args, deps.port, context.signal);

  if (refused) return refused;

  if (definition.cooldownMs) deps.session.lastRun.set(definition.name, deps.session.now());

  return definition.run(args, context);
}

async function runGuarded(definition: ToolDefinition, args: unknown, signal: AbortSignal, deps: ExecuteDeps) {
  const { context, record } = contextFor(definition, deps.port, signal, deps.origin, deps.session);

  try {
    return { result: await checkedRun(definition, args, context, deps), record };
  } catch (error) {
    return { result: fail('unavailable', error instanceof Error ? error.message : String(error)), record };
  }
}

function statusOf(code: ReturnType<typeof errorCode>): ActivityInput['status'] {
  if (code === 'user_declined') return 'declined';

  return code ? 'error' : 'ok';
}

interface ExecuteDeps {
  port: BuilderPort;
  origin: string;
  session: Session;
}

async function execute(definition: ToolDefinition, raw: unknown, signal: AbortSignal, deps: ExecuteDeps) {
  const early = precheck(definition, raw, signal, deps);

  if (early) return early;

  const parsed = parse(definition, raw);

  if (!('args' in parsed)) return parsed;

  const mutating = definition.kind !== 'read';

  if (mutating && deps.session.busy) {
    return fail('busy', 'Another edit or action is still running; retry when it finishes.');
  }

  deps.session.busy ||= mutating;

  try {
    const { result, record } = await runGuarded(definition, parsed.args, signal, deps);
    const code = errorCode(result);
    deps.port.report({
      tool: definition.name,
      kind: definition.kind,
      status: statusOf(code),
      ...(code ? { code } : {}),
      changed: record.changed,
      ...(record.produced ? { produced: record.produced } : {}),
      note: noteOf(parsed.args),
    });

    return capOutput(result, 'Ask for less (a query, a pointer or a filter).');
  } finally {
    if (mutating) deps.session.busy = false;
  }
}

/** The tools to register for this builder, given its capabilities. */
export function buildBuilderTools(
  port: BuilderPort,
  options: BuilderToolOptions,
  definitions: readonly ToolDefinition[] = BUILDER_TOOL_DEFINITIONS
): ToolSpec[] {
  const now = options.now ?? Date.now;
  const session: Session = { limiter: createRateLimiter(now), busy: false, steps: [], lastRun: new Map(), now };
  const deps: ExecuteDeps = { port, origin: options.origin, session };

  return definitions
    .filter((definition) => !definition.requires || options.capabilities.has(definition.requires))
    .map((definition) => ({
      name: definition.name,
      title: definition.title,
      description: definition.description,
      kind: definition.kind,
      confirm: definition.confirm ?? DEFAULT_CONFIRM[definition.kind],
      inputSchema: inputSchemaOf(definition),
      annotations: annotationsFor(definition),
      execute: (input, executeOptions) =>
        execute(definition, input, executeOptions?.signal ?? new AbortController().signal, deps),
    }));
}
