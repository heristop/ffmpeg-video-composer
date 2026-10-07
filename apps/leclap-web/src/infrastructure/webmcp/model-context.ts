// The one adapter between the builder and the browser's WebMCP API. Detection prefers the draft spec's
// `document.modelContext` and falls back to the deprecated `navigator.modelContext`; both exist only in
// a secure context. Registration is per tool: one rejected tool (a duplicate name, a policy refusal) is
// reported and never stops the others, and nothing here throws into React. Aborting the signal
// unregisters every tool — natively, or through the legacy `{ unregister }` handle.
import type { LegacyRegistration, ModelContextLike, ModelContextTool } from './types';

/** Where detection looks; the browser globals by default, a fake in tests. */
export interface WebMcpEnvironment {
  isSecureContext: boolean;
  document?: { modelContext?: unknown };
  navigator?: { modelContext?: unknown };
}

export interface RegistrationReport {
  name: string;
  ok: boolean;
  error?: string;
}

function hasRegisterTool(value: unknown): value is ModelContextLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { registerTool?: unknown }).registerTool === 'function'
  );
}

function browserEnvironment(): WebMcpEnvironment | null {
  if (typeof window === 'undefined') return null;

  return {
    isSecureContext: window.isSecureContext,
    document: document as { modelContext?: unknown },
    navigator: navigator as { modelContext?: unknown },
  };
}

/** The page's ModelContext, or null when the browser (or this context) has none. */
export function detectModelContext(env: WebMcpEnvironment | null = browserEnvironment()): ModelContextLike | null {
  if (!env?.isSecureContext) return null;

  const fromDocument = env.document?.modelContext;

  if (hasRegisterTool(fromDocument)) return fromDocument;

  const fromNavigator = env.navigator?.modelContext;

  return hasRegisterTool(fromNavigator) ? fromNavigator : null;
}

function isLegacyRegistration(value: unknown): value is LegacyRegistration {
  return (
    typeof value === 'object' && value !== null && typeof (value as { unregister?: unknown }).unregister === 'function'
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

async function registerOne(
  context: ModelContextLike,
  tool: ModelContextTool,
  signal: AbortSignal
): Promise<RegistrationReport> {
  try {
    const handle: unknown = await context.registerTool(tool, { signal });

    if (isLegacyRegistration(handle)) {
      if (signal.aborted) handle.unregister();
      signal.addEventListener('abort', () => {
        handle.unregister();
      });
    }

    return { name: tool.name, ok: true };
  } catch (error) {
    return { name: tool.name, ok: false, error: messageOf(error) };
  }
}

/**
 * Registers every tool against `signal` and resolves with one report per tool (never rejects). Abort the
 * signal to unregister them all; the agent sees a `toolchange` event.
 */
export async function registerTools(
  context: ModelContextLike,
  tools: readonly ModelContextTool[],
  signal: AbortSignal
): Promise<RegistrationReport[]> {
  if (signal.aborted) return tools.map((tool) => ({ name: tool.name, ok: false, error: 'aborted' }));

  return Promise.all(tools.map((tool) => registerOne(context, tool, signal)));
}
