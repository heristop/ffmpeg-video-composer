import { describe, expect, it, vi } from 'vitest';
import type { JevQuestion } from '@/application/usecases/ai-template/brief-router';
import { askJev, JEV_URL, jevAsker, withConfidence } from './typesafe-jev';

const KEY = 'jev-secret-key-42';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function fetchReturning(response: Response | Error) {
  return vi.fn((_url: string | URL | Request, _init?: RequestInit) =>
    response instanceof Error ? Promise.reject(response) : Promise.resolve(response)
  );
}

const questions: Record<string, JevQuestion> = {
  genre: { type: 'choice', instructions: 'Which kind?', criteria: { explainer: 'Explains', other: null } },
  energy: { type: 'score', instructions: 'How energetic?', criteria: ['Calm', 'Balanced', 'Explosive'] },
  music: { type: 'boolean', instructions: 'Does it need music?' },
};

describe('askJev', () => {
  it('posts to System One with the key only in the Authorization header', async () => {
    const fetch = fetchReturning(
      jsonResponse({
        model: 'jev-latest',
        answers: {
          genre: {
            type: 'choice',
            choice: 'explainer',
            confidence: 0.8,
            probabilities: { explainer: 0.8, other: 0.2 },
          },
          energy: { type: 'score', score: 1, confidence: 0.6, probabilities: { 0: 0.2, 1: 0.6, 2: 0.2 } },
          music: { type: 'noul', noul: 0.9 },
        },
        usage: { input_tokens: 1, output_tokens: 1 },
      })
    );

    const result = await askJev({ apiKey: KEY, state: 'a calm explainer', questions, fetch });
    const [url, init] = fetch.mock.calls[0];
    const headers = new Headers(init?.headers);
    const body = JSON.parse(init?.body as string) as {
      model: string;
      state: string;
      questions: Record<string, unknown>;
    };

    expect(result).toEqual({
      genre: { type: 'choice', choice: 'explainer', confidence: 0.8, probabilities: { explainer: 0.8, other: 0.2 } },
      energy: { type: 'score', score: 1, confidence: 0.6, probabilities: { 0: 0.2, 1: 0.6, 2: 0.2 } },
      music: { type: 'boolean', probability: 0.9 },
    });
    expect(url).toBe(JEV_URL);
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer' });
    expect(headers.get('authorization')).toBe(`Bearer ${KEY}`);
    expect(headers.get('user-agent')).toBeNull();
    expect(body).toMatchObject({ model: 'jev-latest', state: 'a calm explainer' });
    // The SDK's boolean question travels as Jev's native "noul".
    expect(body.questions).toEqual({ ...questions, music: { ...questions.music, type: 'noul' } });
    expect(init?.body as string).not.toContain(KEY);
  });

  it('turns a CORS/network failure into a network error', async () => {
    const fetch = fetchReturning(new TypeError('Failed to fetch'));

    await expect(jevAsker(KEY, undefined, fetch)('x', questions)).rejects.toMatchObject({ kind: 'network' });
  });

  it('maps a rejected key, an abort and a malformed body', async () => {
    const unauthorized = fetchReturning(jsonResponse({ message: 'bad key' }, 401));
    await expect(askJev({ apiKey: KEY, state: 'x', questions, fetch: unauthorized })).rejects.toMatchObject({
      kind: 'auth',
      detail: 'bad key',
    });

    const controller = new AbortController();
    controller.abort();
    const aborted = fetchReturning(new DOMException('aborted', 'AbortError'));
    await expect(
      askJev({ apiKey: KEY, state: 'x', questions, signal: controller.signal, fetch: aborted })
    ).rejects.toMatchObject({ kind: 'aborted' });

    const malformed = fetchReturning(jsonResponse({ model: 'jev-latest' }));
    await expect(askJev({ apiKey: KEY, state: 'x', questions, fetch: malformed })).rejects.toMatchObject({
      kind: 'bad-response',
    });
  });
});

describe('withConfidence', () => {
  it('defaults a missing confidence to zero', () => {
    expect(withConfidence({ genre: { type: 'choice', choice: 'other' } }, undefined)).toEqual({
      genre: { type: 'choice', choice: 'other', confidence: 0 },
    });
  });
});
