import { describe, expect, it } from 'vitest';
import { resolveSnapshotTime, snapTime, snapshotMoments, SnapshotTimeError } from '@/core/timing/snapshot-times';
import { videoTimeline } from '@/core/timing/video-timeline';

const descriptor = {
  global: { fps: 30, beats: { bpm: 120 }, transition: { type: 'cut' } },
  sections: [
    {
      name: 'intro',
      type: 'color_background',
      options: { duration: 2 },
      cues: { drop: 1.2 },
      kinetic: [{ id: 'hero', text: { en: 'Big idea' }, preset: 'fade', delay: 0.3, duration: 0.5 }],
    },
    {
      name: 'outro',
      type: 'color_background',
      options: { duration: 3 },
      graphics: [{ id: 'line', type: 'underline', at: 0.5, duration: 0.4 }],
    },
  ],
};

function at(input: number | string): number {
  return resolveSnapshotTime(input, descriptor);
}

describe('resolveSnapshotTime', () => {
  it('reads seconds as given', () => {
    expect(at(1.5)).toBe(1.5);
    expect(at('2.25')).toBe(2.25);
    expect(at('2.25s')).toBe(2.25);
  });

  it('reads section edges with offsets', () => {
    expect(at('intro.end')).toBe(2);
    expect(at('outro.start')).toBe(2);
    expect(at('outro.end - 0.5')).toBe(4.5);
    expect(at('intro.start + 0.25')).toBe(0.25);
  });

  it('reads element ids on the whole video', () => {
    expect(at('hero.start')).toBeCloseTo(0.3, 6);
    expect(at('line.start')).toBeCloseTo(2.5, 6);
    expect(at('line.end + 0.1')).toBeCloseTo(3, 6);
  });

  it('reads percentages, end, beats, bars and cues on the whole video', () => {
    expect(at('50%')).toBe(2.5);
    expect(at('end')).toBe(5);
    expect(at('beat:3')).toBe(1);
    expect(at('bar:2')).toBe(2);
    expect(at('cue:drop + 0.1')).toBeCloseTo(1.3, 6);
  });

  it('names what it cannot place', () => {
    expect(() => at('herro.end')).toThrow(/did you mean "hero"/);
    expect(() => at('cue:nope')).toThrow(SnapshotTimeError);
    expect(() => at('whenever')).toThrow(/is not a time/);
    expect(() => resolveSnapshotTime('beat:2', { sections: descriptor.sections })).toThrow(/needs global.beats/);
  });
});

describe('snapTime', () => {
  it('lands on a frame inside the video', () => {
    const timeline = { duration: 5, fps: 30 };

    expect(snapTime(-1, timeline)).toBe(0);
    expect(snapTime(9, timeline)).toBeCloseTo(4.966667, 5);
    expect(snapTime(1.01, timeline)).toBe(1);
  });
});

describe('snapshotMoments', () => {
  const timeline = videoTimeline(descriptor);

  it('plans each boundary 0.1 s before and 0.2 s after the cut', () => {
    const moments = snapshotMoments(descriptor, { atTransitions: true }, timeline);

    expect(moments.map(({ section, source }) => ({ section, source }))).toEqual([
      { section: 'intro', source: 'transition' },
      { section: 'outro', source: 'transition' },
    ]);
    expect(moments[0].time).toBeCloseTo(1.9, 5);
    expect(moments[1].time).toBeCloseTo(2.2, 5);
  });

  it('plans each section once its entrances have landed', () => {
    const moments = snapshotMoments(descriptor, { perSection: true }, timeline);

    expect(moments.map((moment) => moment.label)).toEqual(['intro settled', 'outro settled']);
    expect(moments[0].time).toBeGreaterThan(0.8);
    expect(moments[1].time).toBeCloseTo(3.1, 1);
  });

  it('defaults to perSection, sorts and grabs a repeated frame once', () => {
    expect(snapshotMoments(descriptor, {}, timeline).every((moment) => moment.source === 'section')).toBe(true);

    const moments = snapshotMoments(descriptor, { at: ['outro.start', 2, 0.5] }, timeline);

    expect(moments.map((moment) => [moment.time, moment.label])).toEqual([
      [0.5, '0.5s'],
      [2, 'outro.start'],
    ]);
  });
});
