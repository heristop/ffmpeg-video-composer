import { describe, expect, it } from 'vitest';
import { createRevealStagger, readingOrder, staggerDelay } from './reveal-stagger';

const card = (left: number, top: number) => ({ getBoundingClientRect: () => ({ left, top }) }) as unknown as Element;

const manualFrames = () => {
  const pending: Array<() => void> = [];

  return {
    schedule: (flush: () => void) => {
      pending.push(flush);
    },
    tick: () => {
      for (const flush of pending.splice(0)) flush();
    },
  };
};

describe('staggerDelay', () => {
  it('steps each slot and stops at the cap', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 20].map((slot) => staggerDelay(slot, { step: 50, cap: 250 }))).toEqual([
      0, 50, 100, 150, 200, 250, 250, 250,
    ]);
  });
});

describe('readingOrder', () => {
  it('sorts row by row, then left to right', () => {
    const boxes = [
      { top: 400, left: 0 },
      { top: 0, left: 800 },
      { top: 0, left: 0 },
      { top: 400.4, left: -10 },
      { top: 0.3, left: 400 },
    ];

    expect(readingOrder(boxes)).toEqual([
      { top: 0, left: 0 },
      { top: 0.3, left: 400 },
      { top: 0, left: 800 },
      { top: 400.4, left: -10 },
      { top: 400, left: 0 },
    ]);
  });
});

describe('createRevealStagger', () => {
  it('staggers the cards entering in one frame in reading order, whatever order they arrive in', () => {
    const frames = manualFrames();
    const stagger = createRevealStagger({ step: 50, cap: 250, schedule: frames.schedule });
    const delays: Record<string, number> = {};

    stagger.enter(card(800, 0), (delay) => (delays.right = delay));
    stagger.enter(card(0, 0), (delay) => (delays.left = delay));
    stagger.enter(card(400, 0), (delay) => (delays.middle = delay));

    expect(delays).toEqual({});
    frames.tick();
    expect(delays).toEqual({ left: 0, middle: 50, right: 100 });
  });

  it('caps a long batch so the last card never waits', () => {
    const frames = manualFrames();
    const stagger = createRevealStagger({ step: 50, cap: 250, schedule: frames.schedule });
    const delays: number[] = [];

    for (let index = 0; index < 18; index += 1) {
      stagger.enter(card((index % 3) * 400, Math.floor(index / 3) * 400), (delay) => delays.push(delay));
    }
    frames.tick();

    expect(Math.max(...delays)).toBe(250);
    expect(delays.slice(0, 6)).toEqual([0, 50, 100, 150, 200, 250]);
  });

  it('starts each frame as a fresh batch', () => {
    const frames = manualFrames();
    const stagger = createRevealStagger({ schedule: frames.schedule });
    const delays: number[] = [];

    stagger.enter(card(0, 0), (delay) => delays.push(delay));
    stagger.enter(card(400, 0), (delay) => delays.push(delay));
    frames.tick();
    stagger.enter(card(0, 400), (delay) => delays.push(delay));
    frames.tick();

    expect(delays).toEqual([0, 50, 0]);
  });
});
