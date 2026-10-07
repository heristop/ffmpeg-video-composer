import { describe, expect, it } from 'vitest';
import { motionTimeline } from '@/core/motion/timeline';
import { longestStill, type MotionEvent } from '@/core/motion/timeline-model';

function template(sections: unknown[], global: Record<string, unknown> = {}): unknown {
  return { meta: { name: 't' }, global: { orientation: 'landscape', fps: 30, ...global }, sections };
}

function color(name: string, duration: number | undefined, motion: Record<string, unknown> = {}): unknown {
  return { name, type: 'color_background', options: duration === undefined ? {} : { duration }, ...motion };
}

function events(descriptor: unknown, section = 0): MotionEvent[] {
  return motionTimeline(descriptor).sections[section].events;
}

function find(list: MotionEvent[], element: string, kind?: string): MotionEvent {
  const event = list.find((e) => e.element === element && (kind === undefined || e.kind === kind));

  if (!event) throw new Error(`no ${element} ${kind ?? ''}`);

  return event;
}

describe('motionTimeline', () => {
  it('times a kinetic block from its preset: delay, stagger spread, spring settle, layout box', () => {
    const list = events(
      template([color('a', 3, { kinetic: [{ text: { en: 'Make every word land' }, preset: 'cascade' }] })])
    );
    const kinetic = find(list, 'kinetic[0]');

    expect(kinetic).toMatchObject({ kind: 'kinetic', start: 0.2, spread: 0.21, words: 4, text: true, entrance: true });
    expect(kinetic.ease).toBe('spring(420,30,1,0)');
    expect(kinetic.end).toBeGreaterThan(0.41);
    expect(kinetic.visibleUntil).toBe(3);
    expect(kinetic.bbox?.width).toBeGreaterThan(100);
    expect(kinetic.bbox?.x).toBeGreaterThan(0);
  });

  it('resolves motion tokens before timing, so $snappy and the preset spring compare equal', () => {
    const list = events(
      template([
        color('a', 3, {
          kinetic: [
            { text: { en: 'One' }, preset: 'rise', ease: '$snappy' },
            { text: { en: 'Two' }, preset: 'cascade', delay: 0.5 },
          ],
        }),
      ])
    );

    expect(find(list, 'kinetic[0]').ease).toBe(find(list, 'kinetic[1]').ease);
  });

  it('adds a kinetic exit that ends with the section and bounds visibility', () => {
    const list = events(
      template([color('a', 3, { kinetic: [{ text: { en: 'Bye now' }, preset: 'fade', exit: 'fade' }] })])
    );
    const exit = find(list, 'kinetic[0]', 'exit');

    expect(exit.path).toBe('sections[0].kinetic[0].exit');
    expect(exit.end).toBeLessThanOrEqual(3);
    expect(exit.end).toBeGreaterThan(2.6);
    expect(find(list, 'kinetic[0]', 'kinetic').visibleUntil).toBe(exit.end);
  });

  it('times graphics with their per-type defaults and footprint', () => {
    const list = events(
      template([
        color('a', 3, {
          graphics: [
            { type: 'underline', at: 0.5, x: 100, y: 400, width: 300 },
            { type: 'flash', at: 1 },
          ],
        }),
      ])
    );

    expect(find(list, 'graphics[0]')).toMatchObject({ start: 0.5, end: 1, entrance: true, visibleUntil: 3 });
    expect(find(list, 'graphics[0]').bbox).toEqual({ x: 100, y: 400, width: 300, height: 6 });
    expect(find(list, 'graphics[1]')).toMatchObject({ start: 1, end: 1.3, entrance: false, visibleUntil: 1.3 });
  });

  it('lists camera moves, hits and shake', () => {
    const list = events(
      template([
        color('a', 4, { camera: { preset: 'push-in', delay: 0.5, hits: [1, { at: 2, decay: 20 }], shake: {} } }),
      ])
    );
    const cameras = list.filter((e) => e.kind === 'camera');

    expect(cameras.map((e) => [e.path, e.start, e.end])).toEqual([
      ['sections[0].camera.shake', 0, 4],
      ['sections[0].camera', 0.5, 4],
      ['sections[0].camera.hits[0]', 1, 1.3],
      ['sections[0].camera.hits[1]', 2, 2.15],
    ]);
  });

  it('applies the sugar reveal defaults: titleCard lines rise in, staggered', () => {
    const list = events(
      template([
        color('a', 3, { titleCard: { kicker: { en: 'K' }, headline: { en: 'Head' }, subtitle: { en: 'Sub' } } }),
      ])
    );

    expect(find(list, 'titleCard')).toMatchObject({ kind: 'reveal', start: 0.3, end: 1.2, ease: 'linear' });
  });

  it('reads drawtext reveal, animate and exit, with a measured box', () => {
    const drawtext = {
      type: 'drawtext',
      values: { text: { en: 'HELLO' }, fontfile: 'BebasNeue.ttf', fontsize: 100, x: 80, y: 100 },
      animate: {
        y: [
          { t: 0.2, v: '+100' },
          { t: 0.9, v: '+0', ease: '$expo' },
        ],
      },
      exit: { type: 'fade', after: 2, duration: 0.5 },
    };
    const list = events(template([color('a', 3, { filters: [drawtext] })]));

    expect(find(list, 'filters[0]', 'animate')).toMatchObject({
      start: 0.2,
      end: 0.9,
      ease: 'cubic-bezier(0.16,1,0.3,1)',
    });
    expect(find(list, 'filters[0]', 'animate').bbox).toMatchObject({ x: 80, y: 100, height: 100 });
    expect(find(list, 'filters[0]', 'exit')).toMatchObject({ start: 2, end: 2.5 });
  });

  it('puts each boundary at the end of its section and the head of the next; skips non-rendering sections', () => {
    const timeline = motionTimeline(
      template(
        [
          color('a', 3),
          { name: 'form', type: 'form', options: { fields: [] } },
          color('b', 2, { transition: { type: 'cut' } }),
          color('c', 2),
        ],
        { transition: { type: 'push-left', duration: 0.5 } }
      )
    );

    expect(timeline.sections.map((s) => s.name)).toEqual(['a', 'b', 'c']);
    expect(timeline.sections[0].transition).toMatchObject({ type: 'push-left', duration: 0.5 });
    expect(find(timeline.sections[0].events, 'transition')).toMatchObject({
      start: 2.5,
      end: 3,
      path: 'global.transition',
    });
    expect(find(timeline.sections[1].events, 'transition-in')).toMatchObject({ start: 0, end: 0.5 });
    expect(timeline.sections[1].transition).toBeUndefined();
  });

  it('assumes a duration for sections without one, and says so', () => {
    const [section] = motionTimeline(template([{ name: 'v', type: 'video' }])).sections;

    expect(section).toMatchObject({ duration: 3, durationKnown: false });
  });

  it('carries an authored id and finds the longest still stretch', () => {
    const timeline = motionTimeline(
      template([color('a', 5, { kinetic: [{ id: 'hero', text: { en: 'Hi' }, preset: 'fade', duration: 0.5 }] })])
    );
    const [section] = timeline.sections;

    expect(find(section.events, 'kinetic[0]').id).toBe('hero');
    expect(longestStill(section)).toMatchObject({ to: 5 });
    expect(longestStill(section).length).toBeGreaterThan(4);
  });
});
