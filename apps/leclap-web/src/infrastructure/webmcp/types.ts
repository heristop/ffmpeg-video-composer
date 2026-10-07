// The slice of the WebMCP `ModelContext` surface the builder uses, declared locally so the app does not
// depend on any vendor type package. The draft spec puts it on `document.modelContext`; early previews
// (and the polyfill's deprecated alias) put it on `navigator.modelContext`. `registerTool` resolves once
// the tool is registered; aborting the `signal` unregisters it. Early previews instead returned a
// `{ unregister() }` handle, which the adapter still honours.

/** Hints for the agent; none of them is enforced by the browser. */
export interface ToolAnnotations {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
  consequentialHint?: boolean;
}

export interface ToolExecuteOptions {
  signal?: AbortSignal;
}

export interface ModelContextTool {
  name: string;
  title?: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  annotations?: ToolAnnotations;
  execute: (input: Record<string, unknown>, options?: ToolExecuteOptions) => Promise<unknown>;
}

export interface RegisterToolOptions {
  signal?: AbortSignal;
}

/** The legacy registration handle (early previews). */
export interface LegacyRegistration {
  unregister: () => void;
}

export interface ModelContextLike {
  registerTool: (tool: ModelContextTool, options?: RegisterToolOptions) => unknown;
}
