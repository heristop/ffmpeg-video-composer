import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { sectionAt, videoTimeline } from '@/core/timing/video-timeline';

const here = path.dirname(fileURLToPath(import.meta.url));
const kinetic = JSON.parse(
  fs.readFileSync(path.resolve(here, '../../../examples/motion-design/kinetic-type.json'), 'utf8')
) as unknown;

const crossfaded = {
  global: {
    orientation: 'portrait',
    fps: 25,
    beats: { bpm: 120, beatsPerBar: 4 },
    transition: { type: 'fade', duration: 0.5 },
  },
  sections: [
    { name: 'intro', type: 'color_background', options: { duration: 2 }, cues: { drop: 1.5 } },
    {
      name: 'body',
      type: 'color_background',
      options: { duration: 3 },
      kinetic: [{ id: 'title', text: { en: 'Hello world' }, preset: 'fade', delay: 0.4 }],
    },
  ],
};

describe('videoTimeline', () => {
  it('places sections on absolute seconds, a transition overlapping the clips it joins', () => {
    const timeline = videoTimeline(crossfaded);

    expect(timeline).toMatchObject({ width: 720, height: 1280, fps: 25, duration: 4.5, approx: false });
    expect(timeline.sections.map(({ name, start, end }) => ({ name, start, end }))).toEqual([
      { name: 'intro', start: 0, end: 2 },
      { name: 'body', start: 1.5, end: 4.5 },
    ]);
  });

  it('moves motion events, cues and beats onto video seconds', () => {
    const timeline = videoTimeline(crossfaded);
    const title = timeline.events.find((event) => event.id === 'title');

    expect(title).toMatchObject({ section: 'body', kind: 'kinetic', start: 1.9 });
    expect(timeline.cues).toEqual([{ section: 'intro', name: 'drop', time: 1.5 }]);
    expect(timeline.beats.slice(0, 5)).toEqual([
      { beat: 1, time: 0, downbeat: true },
      { beat: 2, time: 0.5, downbeat: false },
      { beat: 3, time: 1, downbeat: false },
      { beat: 4, time: 1.5, downbeat: false },
      { beat: 5, time: 2, downbeat: true },
    ]);
    expect(timeline.beats.at(-1)?.time).toBe(4.5);
    expect(timeline.events.map((event) => event.start)).toEqual(
      timeline.events.map((event) => event.start).toSorted((a, b) => a - b)
    );
  });

  it('lays out a whole example with cuts end to end', () => {
    const timeline = videoTimeline(kinetic);

    expect(timeline.sections.map((section) => section.name)).toEqual(['hook', 'keynote', 'stat', 'energy', 'outro']);
    expect(timeline.sections[1].start).toBe(3);
    expect(sectionAt(timeline, 3)?.name).toBe('keynote');
    expect(sectionAt(timeline, 2.99)?.name).toBe('hook');
    expect(timeline.beats).toEqual([]);
  });

  it('flags an assumed clip length', () => {
    const timeline = videoTimeline({ sections: [{ name: 'clip', type: 'project_video' }] });

    expect(timeline).toMatchObject({ approx: true, duration: 3 });
  });
});
