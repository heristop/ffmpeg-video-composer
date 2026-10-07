import { describe, expect, it, vi } from 'vitest';
import type { GenerateRequest } from '@/application/usecases/ai-template/model-provider';
import { anthropicProvider } from './anthropic-provider';
import { generateWithOpenAi, OPENAI_URL, openAiProvider } from './openai-provider';
import { findProvider, TEMPLATE_MODEL_PROVIDERS } from './registry';

const KEY = 'sk-proj-openai-secret-0123456789';

function request(overrides: Partial<GenerateRequest> = {}): GenerateRequest {
  return {
    system: 'SYSTEM PROMPT',
    messages: [{ role: 'user', content: 'Brief: a launch' }],
    model: 'some-future-model',
    apiKey: KEY,
    ...overrides,
  };
}

function chunk(delta: Record<string, unknown>, finishReason: string | null = null) {
  return {
    id: 'chatcmpl-1',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'some-future-model',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

// A Chat Completions SSE body as the API streams it, ending with the usage chunk and [DONE].
function completionStream(texts: string[], finishReason: string): Response {
  const events = [
    chunk({ role: 'assistant', content: '' }),
    ...texts.map((content) => chunk({ content })),
    chunk({}, finishReason),
    { ...chunk({}), choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
  ];
  const text = `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`;

  return new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function fetchReturning(response: Response | Error) {
  return vi.fn((_url: string | URL | Request, _init?: RequestInit) =>
    response instanceof Error ? Promise.reject(response) : Promise.resolve(response)
  );
}

describe('openAiProvider', () => {
  it('streams a JSON-mode chat completion with the Bearer key only in the header', async () => {
    const fetch = fetchReturning(completionStream(['{"a":', '1}'], 'stop'));
    const progress: number[] = [];
    const text = await generateWithOpenAi(request({ onProgress: (chars) => progress.push(chars) }), fetch);
    const [url, init] = fetch.mock.calls[0];
    const headers = new Headers(init?.headers);
    const body = JSON.parse(init?.body as string) as Record<string, unknown>;

    expect(text).toBe('{"a":1}');
    expect(progress).toEqual([5, 7]);
    expect(url).toBe(OPENAI_URL);
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer' });
    expect(body).toMatchObject({
      model: 'some-future-model',
      stream: true,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'SYSTEM PROMPT' },
        { role: 'user', content: 'Brief: a launch' },
      ],
    });
    expect(headers.get('authorization')).toBe(`Bearer ${KEY}`);
    expect(headers.get('user-agent')).toBeNull();
    expect(init?.body as string).not.toContain(KEY);
  });

  it('maps truncation, content filtering and HTTP errors', async () => {
    await expect(
      generateWithOpenAi(request(), fetchReturning(completionStream(['{'], 'length')))
    ).rejects.toMatchObject({
      kind: 'truncated',
    });
    await expect(
      generateWithOpenAi(request(), fetchReturning(completionStream([], 'content_filter')))
    ).rejects.toMatchObject({ kind: 'refused' });

    const unauthorized = new Response(JSON.stringify({ error: { message: 'Incorrect API key provided' } }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
    await expect(generateWithOpenAi(request(), fetchReturning(unauthorized))).rejects.toMatchObject({
      kind: 'auth',
      detail: 'Incorrect API key provided',
    });
    await expect(
      generateWithOpenAi(request(), fetchReturning(new Response('{}', { status: 503 })))
    ).rejects.toMatchObject({ kind: 'overloaded', status: 503 });
  });

  it('accepts free-text models and checks the key format', () => {
    expect(openAiProvider.freeformModel).toBe(true);
    expect(openAiProvider.looksLikeKey(KEY)).toBe(true);
    expect(openAiProvider.looksLikeKey('sk-ant-secret-key-0123456789')).toBe(false);
  });
});

describe('registry', () => {
  it('lists every provider once and falls back to Anthropic', () => {
    expect(TEMPLATE_MODEL_PROVIDERS.map((provider) => provider.id)).toEqual(['anthropic', 'openai']);
    expect(findProvider('openai')).toBe(openAiProvider);
    expect(findProvider('unknown')).toBe(anthropicProvider);
  });
});
