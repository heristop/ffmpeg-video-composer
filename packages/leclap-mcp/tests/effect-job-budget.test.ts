import { afterEach, describe, expect, it, vi } from 'vitest';
import { acquireEffectJobPermit } from '../src/effects/effect-job-budget.js';

afterEach(() => vi.useRealTimers());

describe('effect job budget', () => {
  it('admits one active job and transfers permits in FIFO order', async () => {
    const first = await acquireEffectJobPermit(1000);
    const order: number[] = [];
    const second = acquireEffectJobPermit(1000).then((release) => {
      order.push(2);
      return release;
    });
    const third = acquireEffectJobPermit(1000).then((release) => {
      order.push(3);
      return release;
    });
    await Promise.resolve();
    expect(order).toEqual([]);
    first();
    first();
    const releaseSecond = await second;
    expect(order).toEqual([2]);
    releaseSecond();
    (await third)();
    expect(order).toEqual([2, 3]);
  });

  it('rejects beyond eight pending jobs and recovers capacity', async () => {
    let release = await acquireEffectJobPermit(1000);
    const pending = Array.from({ length: 8 }, () => acquireEffectJobPermit(1000));
    await expect(acquireEffectJobPermit(1000)).rejects.toThrow(/capacity.*8/i);
    for (const next of pending) {
      release();
      release = await next;
    }
    release();
    (await acquireEffectJobPermit(1000))();
  });

  it('removes timed out jobs without affecting the active job or next waiter', async () => {
    vi.useFakeTimers();
    const release = await acquireEffectJobPermit(1000);
    const expired = expect(acquireEffectJobPermit(10)).rejects.toThrow(/queue.*timed out/i);
    const next = acquireEffectJobPermit(1000);
    await vi.advanceTimersByTimeAsync(10);
    await expired;
    release();
    (await next)();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('removes aborted queued jobs and rejects already aborted requests', async () => {
    const release = await acquireEffectJobPermit(1000);
    const controller = new AbortController();
    const aborted = expect(acquireEffectJobPermit(1000, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    controller.abort();
    await aborted;
    await expect(acquireEffectJobPermit(1000, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    release();
    (await acquireEffectJobPermit(1000))();
  });

  it('ignores timeout and abort after grant; release remains idempotent', async () => {
    vi.useFakeTimers();
    const first = await acquireEffectJobPermit(1000);
    const controller = new AbortController();
    const next = acquireEffectJobPermit(10, controller.signal);
    first();
    const release = await next;
    controller.abort();
    await vi.advanceTimersByTimeAsync(20);
    let granted = false;
    const third = acquireEffectJobPermit(1000).then((done) => {
      granted = true;
      return done;
    });
    await Promise.resolve();
    expect(granted).toBe(false);
    release();
    release();
    (await third)();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('allows finally cleanup after an operation fails', async () => {
    await expect(
      (async () => {
        const release = await acquireEffectJobPermit(1000);
        try {
          throw new Error('worker failed');
        } finally {
          release();
        }
      })()
    ).rejects.toThrow('worker failed');
    (await acquireEffectJobPermit(1000))();
  });
});
