// One place that turns AI SDK failures (HTTP errors, in-stream provider errors, network/CORS
// failures, aborts) into ProviderErrors the UI can explain. Nothing here logs, and error details
// only ever carry the provider's own response text — the key lives in request headers.
import { APICallError, RetryError, StreamProviderError } from 'ai';
import { ProviderError } from '@/application/usecases/ai-template/model-provider';

const DETAIL_LIMIT = 400;

// Pull a human message out of the usual `{ error: { message } }` / `{ message }` error bodies.
export function errorDetail(body: string | undefined): string | undefined {
  if (!body || body.trim() === '') return undefined;

  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } | string; message?: unknown };
    const nested = typeof parsed.error === 'object' ? parsed.error.message : parsed.error;
    const message = nested ?? parsed.message;

    return typeof message === 'string' ? message.slice(0, DETAIL_LIMIT) : undefined;
  } catch {
    return body.trim().slice(0, DETAIL_LIMIT);
  }
}

export function errorForStatus(status: number, detail: string | undefined): ProviderError {
  if (status === 401 || status === 403) return new ProviderError('auth', { status, detail });

  if (status === 429) return new ProviderError('rate-limit', { status, detail });

  if (status === 529 || status === 503) return new ProviderError('overloaded', { status, detail });

  if (status === 400 || status === 404 || status === 413 || status === 422) {
    return new ProviderError('bad-request', { status, detail });
  }

  return new ProviderError('http', { status, detail });
}

function isAbort(error: unknown, signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true || (error instanceof Error && error.name === 'AbortError');
}

function fromApiCall(error: APICallError): ProviderError {
  const message = error.message.slice(0, DETAIL_LIMIT);

  // No status: the request never got an answer — offline, DNS, or the API refusing this origin via
  // CORS (browsers don't tell them apart).
  if (error.statusCode === undefined) return new ProviderError('network', { detail: message });

  // A 2xx the SDK could not parse (malformed JSON, unexpected shape).
  if (error.statusCode < 300) return new ProviderError('bad-response', { detail: message });

  return errorForStatus(error.statusCode, errorDetail(error.responseBody) ?? message);
}

function fromStream(error: StreamProviderError): ProviderError {
  const detail = error.message.slice(0, DETAIL_LIMIT);

  return error.statusCode === undefined
    ? new ProviderError('http', { detail })
    : errorForStatus(error.statusCode, detail);
}

function unwrap(error: unknown): unknown {
  return RetryError.isInstance(error) ? error.lastError : error;
}

// Map anything an SDK call can throw to a ProviderError.
export function toProviderError(raw: unknown, signal?: AbortSignal): ProviderError {
  const error = unwrap(raw);

  if (error instanceof ProviderError) return error;

  if (isAbort(error, signal)) return new ProviderError('aborted');

  if (APICallError.isInstance(error)) return fromApiCall(error);

  if (StreamProviderError.isInstance(error)) return fromStream(error);

  if (error instanceof TypeError) return new ProviderError('network', { detail: error.message });

  return new ProviderError('bad-response', { detail: error instanceof Error ? error.message : undefined });
}
