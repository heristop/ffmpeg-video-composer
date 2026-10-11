import { describe, expect, it } from 'vitest';
import {
  aspectLabel,
  markerFractions,
  previewSize,
  quantizeTime,
  rateRoll,
  sceneMarkers,
  sceneShares,
  timelineLength,
} from './timeline.logic';

describe('sceneMarkers', () => {
  it('starts each scene where the last one ends, less the transition that overlaps them', () => {
    const sections = [
      { options: { duration: 4 }, transition: { type: 'fade', duration: 0.5 } },
      { options: { duration: 3 } },
      { options: { duration: 2 }, transition: { duration: 1 } },
      { options: { duration: 5 } },
    ];

    expect(sceneMarkers(sections)).toEqual([3.5, 6.5, 7.5]);
  });

  it('has no markers for a single scene', () => {
    expect(sceneMarkers([{ options: { duration: 4 } }])).toEqual([]);
  });

  it('gives up when a scene has no fixed length (its clip decides it)', () => {
    expect(sceneMarkers([{ options: { duration: 4 } }, { options: {} }, { options: { duration: 2 } }])).toEqual([]);
    expect(sceneMarkers([{ options: { duration: 'x' } }, { options: { duration: 2 } }])).toEqual([]);
  });

  it('ignores a malformed transition', () => {
    expect(sceneMarkers([{ options: { duration: 4 }, transition: 'cut' }, { options: { duration: 2 } }])).toEqual([4]);
  });
});

describe('timelineLength', () => {
  it('ends where the last scene ends', () => {
    const sections = [{ options: { duration: 4 }, transition: { duration: 0.5 } }, { options: { duration: 3 } }];

    expect(timelineLength(sections)).toBe(6.5);
    expect(timelineLength([{ options: { duration: 4 } }])).toBe(4);
  });

  it('is zero when a scene has no fixed length', () => {
    expect(timelineLength([{ options: { duration: 4 } }, { options: {} }])).toBe(0);
    expect(timelineLength([])).toBe(0);
  });
});

describe('markerFractions', () => {
  it('places scene starts along the bar, scaled to the video as it actually plays', () => {
    // The template sums to 10 s; the render runs 20 s: every marker lands twice as far.
    expect(markerFractions([2.5, 5], 10, 20)).toEqual([0.25, 0.5]);
  });

  it('drops markers that would sit on either end', () => {
    expect(markerFractions([0.01, 5, 9.99], 10, 10)).toEqual([0.5]);
  });

  it('is empty until both lengths are known', () => {
    expect(markerFractions([5], 0, 10)).toEqual([]);
    expect(markerFractions([5], 10, 0)).toEqual([]);
  });
});

describe('sceneShares', () => {
  it('marks a template’s scenes on the bar, or nothing without a template', () => {
    expect(sceneShares({ markers: [5], length: 10 }, 10)).toEqual([0.5]);
    expect(sceneShares(null, 10)).toEqual([]);
    expect(sceneShares(undefined, 10)).toEqual([]);
  });
});

describe('aspectLabel', () => {
  it('names the common frames', () => {
    expect(aspectLabel(1920, 1080)).toBe('16:9');
    expect(aspectLabel(1080, 1920)).toBe('9:16');
    expect(aspectLabel(1080, 1080)).toBe('1:1');
    expect(aspectLabel(1080, 1350)).toBe('4:5');
    expect(aspectLabel(1440, 1080)).toBe('4:3');
  });

  it('tolerates encoder rounding', () => {
    expect(aspectLabel(854, 480)).toBe('16:9');
  });

  it('prints any other frame as a ratio to one', () => {
    expect(aspectLabel(1998, 1080)).toBe('1.85:1');
  });

  it('is empty while the size is unknown', () => {
    expect(aspectLabel(0, 0)).toBe('');
  });
});

describe('previewSize', () => {
  it('fits the frame preview to its longer edge, in the video’s shape', () => {
    expect(previewSize(1920, 1080, 160)).toEqual({ width: 160, height: 90 });
    expect(previewSize(1080, 1920, 160)).toEqual({ width: 90, height: 160 });
  });

  it('assumes landscape before the size is known', () => {
    expect(previewSize(0, 0, 160)).toEqual({ width: 160, height: 90 });
  });
});

describe('quantizeTime', () => {
  it('snaps a hover time to the preview’s step, so a sweep seeks a handful of frames, not hundreds', () => {
    expect(quantizeTime(12.34, 0.5)).toBe(12);
    expect(quantizeTime(12.76, 0.5)).toBe(12.5);
    expect(quantizeTime(-1, 0.5)).toBe(0);
  });
});

describe('rateRoll', () => {
  it('rolls the speed up when it rises and down when it falls', () => {
    expect(rateRoll(1, 1.25)).toBe('up');
    expect(rateRoll(1.5, 0.5)).toBe('down');
    expect(rateRoll(1, 1)).toBe('none');
  });
});
