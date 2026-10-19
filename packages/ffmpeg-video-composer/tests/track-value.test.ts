import { describe, expect, it } from 'vitest';
import { trackSpan, trackValueAt } from '@/core/motion/track-value';
import { parseEasing } from '@/core/motion/easing';

const ramp = [
  { t: 1, v: 0 },
  { t: 2, v: 100 },
];

describe('trackValueAt', () => {
  it('holds the first value before the first key and the last after the last', () => {
    expect(trackValueAt(ramp, 0)).toBe(0);
    expect(trackValueAt(ramp, 5)).toBe(100);
    expect(trackValueAt(ramp, Infinity)).toBe(100);
  });

  it('ramps linearly between keys by default', () => {
    expect(trackValueAt(ramp, 1.25)).toBeCloseTo(25, 10);
  });

  it('eases into a key on its curve', () => {
    const keys = [
      { t: 0, v: 0 },
      { t: 1, v: 1, ease: 'ease-out' },
    ];

    expect(trackValueAt(keys, 0.3)).toBeCloseTo(parseEasing('ease-out').fn(0.3), 10);
  });

  it('reads relative values as offsets from rest', () => {
    const keys = [
      { t: 0, v: '+80' },
      { t: 1, v: 0 },
    ];

    expect(trackValueAt(keys, 0)).toBe(80);
    expect(trackValueAt(keys, 0.5)).toBe(40);
  });

  it('chains three keys', () => {
    const keys = [
      { t: 0, v: 0 },
      { t: 1, v: 10 },
      { t: 2, v: 0 },
    ];

    expect(trackValueAt(keys, 1.5)).toBeCloseTo(5, 10);
  });

  it('lands a spring exactly on its target once its key is reached', () => {
    const keys = [
      { t: 0, v: 0 },
      { v: 1, ease: 'spring(170, 26)' },
    ];
    const { end } = trackSpan(keys);

    expect(end).toBeGreaterThan(0);
    expect(trackValueAt(keys, end)).toBe(1);
  });
});

describe('trackSpan', () => {
  it('is the first and last key times, relative keys resolved', () => {
    expect(
      trackSpan([
        { t: 0.5, v: 0 },
        { t: '+0.3', v: 1 },
      ])
    ).toEqual({ start: 0.5, end: 0.8 });
  });
});
