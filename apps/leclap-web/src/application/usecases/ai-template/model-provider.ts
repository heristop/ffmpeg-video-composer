// The port the template-generation pipeline talks to. A provider turns a system prompt plus a short
// conversation into raw text; everything model-specific (endpoint, auth header, streaming format)
// lives in its infrastructure adapter, so adding a provider is one file plus one registry line.

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface GenerateRequest {
  system: string;
  messages: ChatMessage[];
  model: string;
  // The caller's own key. Adapters send it only in their provider's auth header — never in a URL,
  // a body, a log line or an error message.
  apiKey: string;
  signal?: AbortSignal;
  // Streaming adapters report the characters received so far, so the UI can show live progress.
  onProgress?: (receivedChars: number) => void;
}

export interface TemplateModelProvider {
  id: string;
  label: string;
  defaultModel: string;
  // Suggested model ids. `freeformModel` providers accept any id typed by the user.
  models: string[];
  freeformModel?: boolean;
  // Light, client-side format check (a prefix, a minimum length). Never authoritative.
  looksLikeKey: (key: string) => boolean;
  keyPlaceholder: string;
  // Where the user creates a key, shown as a link next to the key field.
  keyUrl: string;
  generate: (request: GenerateRequest) => Promise<string>;
}

export type ProviderErrorKind =
  | 'auth'
  | 'rate-limit'
  | 'network'
  | 'overloaded'
  | 'refused'
  | 'truncated'
  | 'bad-request'
  | 'bad-response'
  | 'aborted'
  | 'http';

// A provider failure the UI can explain. `detail` carries the provider's own message (already free of
// the key, since keys only travel in request headers), for a collapsible technical line.
export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly status?: number;
  readonly detail?: string;

  constructor(kind: ProviderErrorKind, options: { status?: number; detail?: string } = {}) {
    super(options.detail ? `${kind}: ${options.detail}` : kind);
    this.name = 'ProviderError';
    this.kind = kind;
    this.status = options.status;
    this.detail = options.detail;
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof ProviderError && error.kind === 'aborted') ||
    (error instanceof DOMException && error.name === 'AbortError')
  );
}
