import { describe, expect, it } from 'vitest';
import { affordableSamples, layerSpans, mergeSpans, unitSpans } from '@/editor/presets/motion-spans';

describe('layerSpans', () => {
  it('covers a moving x window, one frame early and one frame late', () => {
    expect(
      layerSpans(
        {
          x: [
            { t: 0.5, v: '+0' },
            { t: 1, v: '+300' },
          ],
        },
        30
      )
    ).toEqual([{ first: 14, last: 31 }]);
  });

  it('ignores tracks that hold a value and the opacity track', () => {
    const animate = {
      y: [
        { t: 0, v: 10 },
        { t: 1, v: 10 },
      ],
      opacity: [
        { t: 0, v: 0 },
        { t: 1, v: 1 },
      ],
    };

    expect(layerSpans(animate, 30)).toEqual([]);
    expect(layerSpans(undefined, 30)).toEqual([]);
  });

  it('joins overlapping windows of different tracks and keeps distant ones apart', () => {
    const animate = {
      x: [
        { t: 0.2, v: 0 },
        { t: 0.4, v: 100 },
        { t: 2, v: 100 },
        { t: 2.5, v: 300 },
      ],
      scale: [
        { t: 0.3, v: 1 },
        { t: 0.6, v: 1.2 },
      ],
    };

    expect(layerSpans(animate, 30)).toEqual([
      { first: 5, last: 19 },
      { first: 59, last: 76 },
    ]);
  });

  it('yields no span for a non-finite or non-positive fps or non-finite key times', () => {
    const keys = [
      { t: 0, v: 0 },
      { t: 1, v: 100 },
    ];

    for (const fps of [Number.NaN, Infinity, 0, -30]) expect(layerSpans({ x: keys }, fps)).toEqual([]);

    const bad = [
      { t: 0, v: 0 },
      { t: Infinity, v: 100 },
    ];

    expect(layerSpans({ x: bad }, 30)).toEqual([]);
    expect(
      layerSpans(
        {
          x: [
            { t: 'abc', v: 0 },
            { t: 1, v: 5 },
          ],
        },
        30
      )
    ).toEqual([]);
  });
});

describe('mergeSpans', () => {
  it('joins the nearest spans until at most four are left', () => {
    const spans = [0, 20, 30, 60, 100].map((first) => ({ first, last: first + 2 }));

    expect(mergeSpans(spans)).toEqual([
      { first: 0, last: 2 },
      { first: 20, last: 32 },
      { first: 60, last: 62 },
      { first: 100, last: 102 },
    ]);
  });

  it('handles tens of thousands of disjoint spans', () => {
    const spans = Array.from({ length: 50_000 }, (_, i) => ({ first: i * 10, last: i * 10 + 2 }));
    const merged = mergeSpans(spans);

    expect(merged).toHaveLength(4);
    expect(merged[0].first).toBe(0);
    expect(merged[3].last).toBe(499_992);
  });

  it('drops non-finite spans and terminates', () => {
    const spans = [
      { first: Number.NaN, last: 3 },
      { first: 0, last: Infinity },
      { first: 1, last: 2 },
    ];

    expect(mergeSpans(spans)).toEqual([{ first: 1, last: 2 }]);
    expect(
      mergeSpans(
        [
          { first: 0, last: 1 },
          { first: 5, last: 6 },
        ],
        Number.NaN
      ).length
    ).toBeLessThanOrEqual(2);
  });
});

describe('unitSpans', () => {
  const units = [
    { start: 0.2, arrive: 0.6, leave: null },
    { start: 0.3, arrive: 0.7, leave: { at: 1.5, duration: 0.3 } },
  ];

  it('joins staggered entrances and adds each exit', () => {
    expect(unitSpans(units, 30, null)).toEqual([
      { first: 5, last: 22 },
      { first: 44, last: 55 },
    ]);
  });

  it('runs to `until` for a unit that keeps moving after it lands (wave)', () => {
    expect(unitSpans([units[0]], 30, 2)).toEqual([{ first: 5, last: 61 }]);
  });

  it('survives non-finite fps, timings and until', () => {
    expect(unitSpans(units, Number.NaN, null)).toEqual([]);
    expect(unitSpans([{ start: Number.NaN, arrive: 1, leave: null }], 30, null)).toEqual([]);
    expect(unitSpans([units[0]], 30, Infinity)).toEqual([{ first: 5, last: 19 }]);
  });
});

describe('affordableSamples', () => {
  it('keeps the requested samples within the budget', () => {
    expect(affordableSamples([{ first: 14, last: 31 }], 8)).toEqual({ samples: 8, capped: false });
  });

  it('lowers the samples for long motion, and drops the blur when fewer than two fit', () => {
    expect(affordableSamples([{ first: 0, last: 399 }], 16)).toEqual({ samples: 3, capped: true });
    expect(affordableSamples([{ first: 0, last: 1799 }], 16)).toEqual({ samples: 0, capped: true });
  });

  it('asks nothing of an element that never moves', () => {
    expect(affordableSamples([], 8)).toEqual({ samples: 0, capped: false });
  });

  it('drops the blur for non-finite requests or spans', () => {
    expect(affordableSamples([{ first: 0, last: 10 }], Number.NaN)).toEqual({ samples: 0, capped: true });
    expect(affordableSamples([{ first: 0, last: Infinity }], 8)).toEqual({ samples: 0, capped: true });
  });
});
