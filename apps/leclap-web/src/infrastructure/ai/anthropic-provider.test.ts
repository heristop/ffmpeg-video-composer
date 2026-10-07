import { describe, expect, it, vi } from 'vitest';
import type { GenerateRequest } from '@/application/usecases/ai-template/model-provider';
import { ANTHROPIC_URL, anthropicProvider, generateWithAnthropic } from './anthropic-provider';

const KEY = 'sk-ant-secret-key-0123456789';

function request(overrides: Partial<GenerateRequest> = {}): GenerateRequest {
  return {
    system: 'SYSTEM PROMPT',
    messages: [{ role: 'user', content: 'Brief: a launch' }],
    model: 'claude-opus-5-5',
    apiKey: KEY,
    ...overrides,
  };
}

// An SSE body exactly as the Messages API streams it, split mid-event across two chunks.
function sseResponse(events: Array<Record<string, unknown>>): Response {
  const text = events.map((event) => `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`).join('');
  const bytes = new TextEncoder().encode(text);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, 37));
      controller.enqueue(bytes.slice(37));
      controller.close();
    },
  });

  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function delta(text: string) {
  return { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } };
}

function messageStream(texts: string[], stopReason: string): Response {
  return sseResponse([
    {
      type: 'message_start',
      message: {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5-5',
        content: [],
        stop_reason: null,
        usage: { input_tokens: 10, output_tokens: 1 },
      },
    },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    ...texts.map(delta),
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 5 } },
    { type: 'message_stop' },
  ]);
}

function fetchReturning(response: Response | Error) {
  return vi.fn((_url: string | URL | Request, _init?: RequestInit) =>
    response instanceof Error ? Promise.reject(response) : Promise.resolve(response)
  );
}

describe('anthropicProvider', () => {
  it('streams a Messages request with the browser opt-in and the key only in x-api-key', async () => {
    const fetch = fetchReturning(messageStream(['{"sections":', '[]}'], 'end_turn'));
    const progress: number[] = [];
    const text = await generateWithAnthropic(request({ onProgress: (chars) => progress.push(chars) }), fetch);
    const [url, init] = fetch.mock.calls[0];
    const headers = new Headers(init?.headers);
    const body = JSON.parse(init?.body as string) as Record<string, unknown>;

    expect(text).toBe('{"sections":[]}');
    expect(progress).toEqual([12, 15]);
    expect(url).toBe(ANTHROPIC_URL);
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer' });
    expect(headers.get('x-api-key')).toBe(KEY);
    expect(headers.get('anthropic-version')).toBe('2023-06-01');
    expect(headers.get('anthropic-dangerous-direct-browser-access')).toBe('true');
    expect(headers.get('user-agent')).toBeNull();
    expect(body).toMatchObject({
      model: 'claude-opus-5-5',
      stream: true,
      max_tokens: 32_000,
      system: [{ type: 'text', text: 'SYSTEM PROMPT', cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Brief: a launch' }] }],
    });
    expect(init?.body as string).not.toContain(KEY);
    for (const [name, value] of headers.entries()) {
      if (name !== 'x-api-key') expect(value).not.toContain(KEY);
    }
  });

  it('maps a truncation, a refusal and a streamed error', async () => {
    await expect(
      generateWithAnthropic(request(), fetchReturning(messageStream(['{'], 'max_tokens')))
    ).rejects.toMatchObject({ kind: 'truncated' });
    await expect(generateWithAnthropic(request(), fetchReturning(messageStream([], 'refusal')))).rejects.toMatchObject({
      kind: 'refused',
    });

    const overloaded = sseResponse([{ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }]);
    await expect(generateWithAnthropic(request(), fetchReturning(overloaded))).rejects.toMatchObject({
      kind: 'overloaded',
    });
  });

  it('maps HTTP 401 / 429 / 500 and network failures to actionable kinds', async () => {
    const unauthorized = new Response(
      JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }),
      {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }
    );
    await expect(generateWithAnthropic(request(), fetchReturning(unauthorized))).rejects.toMatchObject({
      kind: 'auth',
      status: 401,
      detail: 'invalid x-api-key',
    });

    await expect(
      generateWithAnthropic(request(), fetchReturning(new Response('{}', { status: 429 })))
    ).rejects.toMatchObject({ kind: 'rate-limit', status: 429 });
    await expect(
      generateWithAnthropic(request(), fetchReturning(new Response('{}', { status: 500 })))
    ).rejects.toMatchObject({ kind: 'http', status: 500 });
    await expect(
      generateWithAnthropic(request(), fetchReturning(new TypeError('Failed to fetch')))
    ).rejects.toMatchObject({
      kind: 'network',
    });
  });

  it('reports an aborted request as aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetch = fetchReturning(new DOMException('aborted', 'AbortError'));

    await expect(generateWithAnthropic(request({ signal: controller.signal }), fetch)).rejects.toMatchObject({
      kind: 'aborted',
    });
  });

  it('reports a stream cancelled mid-reply as aborted, not as a partial result', async () => {
    const controller = new AbortController();
    const bytes = new TextEncoder().encode(`event: content_block_delta\ndata: ${JSON.stringify(delta('{"sec'))}\n\n`);
    // Like a real fetch body: delivers one event, then errors when the request's signal aborts.
    const fetch = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(stream) {
          stream.enqueue(bytes);
          init?.signal?.addEventListener('abort', () => stream.error(new DOMException('aborted', 'AbortError')));
        },
      });

      return Promise.resolve(new Response(body, { headers: { 'content-type': 'text/event-stream' } }));
    });
    const generation = generateWithAnthropic(
      request({ signal: controller.signal, onProgress: () => controller.abort() }),
      fetch
    );

    await expect(generation).rejects.toMatchObject({ kind: 'aborted' });
  });

  it('uses the global fetch by default and checks the key format lightly', async () => {
    const fetch = fetchReturning(messageStream(['ok'], 'end_turn'));
    vi.stubGlobal('fetch', fetch);

    await expect(anthropicProvider.generate(request())).resolves.toBe('ok');
    expect(fetch).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();

    expect(anthropicProvider.looksLikeKey(KEY)).toBe(true);
    expect(anthropicProvider.looksLikeKey('sk-proj-abcdefghijklmnopqrstuvwxyz')).toBe(false);
  });
});
