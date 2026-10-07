import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConfirmQueue } from './confirm-queue';

const request = { tool: 'edit_template' as const, kind: 'edit' as const };

afterEach(() => {
  vi.useRealTimers();
});

describe('confirm queue', () => {
  it('shows requests in order and resolves with the answer', async () => {
    const queue = createConfirmQueue();
    const signal = new AbortController().signal;
    const first = queue.request(request, signal);
    const second = queue.request({ ...request, note: 'two' }, signal);
    const head = queue.head();

    expect(head?.request).toEqual(request);
    expect(queue.head()).toBe(head);
    queue.answer(head?.id ?? -1, true);
    expect(queue.head()?.request.note).toBe('two');
    queue.answer(queue.head()?.id ?? -1, false);

    expect(await first).toBe(true);
    expect(await second).toBe(false);
    expect(queue.head()).toBeNull();
  });

  it('declines on abort, on timeout and on declineAll', async () => {
    vi.useFakeTimers();
    const queue = createConfirmQueue(1000);
    const controller = new AbortController();
    const aborted = queue.request(request, controller.signal);
    const waiting = queue.request(request, new AbortController().signal);
    const swept = queue.request(request, new AbortController().signal);

    controller.abort();
    expect(await aborted).toBe(false);
    queue.declineAll();
    expect(await waiting).toBe(false);
    expect(await swept).toBe(false);

    const late = queue.request(request, new AbortController().signal);
    vi.advanceTimersByTime(1000);
    expect(await late).toBe(false);
  });

  it('answers an already-aborted call at once and notifies subscribers', async () => {
    const queue = createConfirmQueue();
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    queue.subscribe(() => {
      calls += 1;
    });

    expect(await queue.request(request, controller.signal)).toBe(false);
    expect(calls).toBe(0);
    queue.request(request, new AbortController().signal).catch(() => {});
    expect(calls).toBe(1);
  });
});
