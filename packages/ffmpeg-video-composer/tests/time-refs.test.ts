import { describe, expect, it } from 'vitest';
import { nearestName, parseTimeRef, timeRefError } from '@/core/timing/grammar';
import { barTime, beatTime, sectionStarts } from '@/core/timing/timeline';
import { resolveTimeRefs } from '@/core/timing/resolve';
import { seconds } from '@/core/timing/seconds';
import { resolveKinetic } from '@/core/kinetic/resolve';
import { motionCatalog } from '@/core/motion/catalog';
import { prepareMotion } from '@/director/prepare-build';
import { TimeRefSchema } from '@/schemas/time.schemas';
import { KineticBlockSchema } from '@/schemas/kinetic.schemas';
import { TemplateValidator } from '@/services/TemplateValidator';

type Section = Record<string, unknown>;

function card(fields: Section, duration = 4): Section {
  return { name: 'card', type: 'color_background', options: { backgroundColor: '#101014', duration }, ...fields };
}

function template(sections: Section[], global: Record<string, unknown> = {}) {
  return { global: { orientation: 'landscape', musicEnabled: false, ...global }, sections };
}

function resolved(sections: Section[], global: Record<string, unknown> = {}) {
  const out = resolveTimeRefs(template(sections, global));

  return { sections: out.descriptor.sections as Section[], issues: out.issues };
}

const validator = new TemplateValidator();

function errors(descriptor: unknown): Array<{ code: string; path: string; message: string }> {
  return (validator.validateTemplate(descriptor).errors ?? []) as Array<{
    code: string;
    path: string;
    message: string;
  }>;
}

describe('time reference grammar', () => {
  it('parses every base, with or without spaces around the offset', () => {
    expect(parseTimeRef('title.end + 0.2')).toEqual({ kind: 'element', id: 'title', edge: 'end', offset: 0.2 });
    expect(parseTimeRef('title.start-0.1')).toEqual({ kind: 'element', id: 'title', edge: 'start', offset: -0.1 });
    expect(parseTimeRef('hero-title.end')).toEqual({ kind: 'element', id: 'hero-title', edge: 'end', offset: 0 });
    expect(parseTimeRef('50%')).toEqual({ kind: 'percent', value: 50, offset: 0 });
    expect(parseTimeRef('end - 0.5')).toEqual({ kind: 'end', offset: -0.5 });
    expect(parseTimeRef('beat:12')).toEqual({ kind: 'beat', index: 12, offset: 0 });
    expect(parseTimeRef('bar:3+1')).toEqual({ kind: 'bar', index: 3, offset: 1 });
    expect(parseTimeRef('cue:drop - 0.1')).toEqual({ kind: 'cue', name: 'drop', offset: -0.1 });
  });

  it('reads a hyphen before a digit as the offset, never as part of a name', () => {
    expect(parseTimeRef('cue:drop-2')).toEqual({ kind: 'cue', name: 'drop', offset: -2 });
  });

  it('leaves plain, relative and token times alone', () => {
    for (const text of ['1.2', '+0.3', '$base', '+$short']) expect(parseTimeRef(text)).toBeNull();
  });

  it('explains malformed references', () => {
    expect(timeRefError('title.middle')).toMatch(/not a time reference/);
    expect(timeRefError('beat:0')).toMatch(/not a time reference/);
    expect(timeRefError('150%')).toMatch(/0%\.\.100%/);
    expect(timeRefError('title.end + 0.2')).toBeNull();
  });

  it('fails at the schema with the reason', () => {
    const result = TimeRefSchema.safeParse('title.ending');

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toMatch(/not a time reference/);
    expect(KineticBlockSchema.safeParse({ text: { en: 'a' }, preset: 'fade', delay: 'title.end' }).success).toBe(true);
    expect(KineticBlockSchema.safeParse({ text: { en: 'a' }, preset: 'fade', delay: 'soon' }).success).toBe(false);
  });

  it('suggests the nearest name', () => {
    expect(nearestName('titel', ['title', 'subtitle'])).toBe('title');
    expect(nearestName('zzzzzzz', ['title'])).toBeUndefined();
  });
});

describe('beat grid and section offsets', () => {
  it('counts beats and bars from 1 on a tempo grid or explicit times', () => {
    expect(beatTime({ bpm: 120, offset: 0.1 }, 1)).toBe(0.1);
    expect(beatTime({ bpm: 120, offset: 0.1 }, 5)).toBeCloseTo(2.1, 9);
    expect(barTime({ bpm: 120 }, 3)).toBe(4);
    expect(barTime({ bpm: 90, beatsPerBar: 3 }, 2)).toBe(2);
    expect(beatTime({ times: [0.5, 1.02, 1.49] }, 2)).toBe(1.02);
    expect(beatTime({ times: [0.5] }, 2)).toBeNull();
    expect(barTime({ times: [0, 1, 2, 3, 4, 5, 6, 7, 8] }, 3)).toBe(8);
  });

  it('places sections end to end, pulled back by each transition overlap', () => {
    const sections = [
      { type: 'color_background', options: { duration: 3 }, transition: { type: 'fade', duration: 0.5 } },
      { type: 'form', options: {} },
      { type: 'color_background', options: { duration: 4 } },
      { type: 'image_background', options: { duration: 2 }, transition: { type: 'cut' } },
      { type: 'color_background', options: { duration: 0.6 } },
    ];

    // The global dissolve (2 s) is capped to half the shorter clip: 1 s between the 4 s and 2 s clips.
    expect(sectionStarts(sections, { type: 'dissolve', duration: 2 })).toEqual([0, null, 2.5, 5.5, 7.5]);
  });

  it('stops at a probed clip, whose length is only known once rendered', () => {
    const cut = [
      { type: 'color_background', options: { duration: 1 } },
      { type: 'project_video', options: { duration: 5 } },
      { type: 'color_background', options: { duration: 2 } },
    ];
    const faded = [{ ...cut[0], transition: { type: 'fade', duration: 0.4 } }, ...cut.slice(1)];

    expect(sectionStarts(cut)).toEqual([0, 1, null]);
    expect(sectionStarts(faded)).toEqual([0, null, null]);
  });
});

describe('resolving time references', () => {
  it('resolves element starts and ends, chained across elements', () => {
    const { sections, issues } = resolved([
      card({
        graphics: [
          { id: 'bar', type: 'underline', at: 0.5, duration: 0.4 },
          { type: 'flash', at: 'rule.end', until: 'bar.start + 2' },
        ],
        filters: [
          {
            type: 'drawtext',
            id: 'rule',
            values: { text: { en: 'x' }, x: 10, y: 10 },
            reveal: { type: 'fade', delay: 'bar.end + 0.1', duration: 0.5 },
          },
        ],
      }),
    ]);
    const [underline, flash] = sections[0].graphics as Section[];
    const reveal = (sections[0].filters as Section[])[0].reveal as Section;

    expect(issues).toEqual([]);
    expect(underline.at).toBe(0.5);
    expect(reveal.delay).toBe(1);
    expect(flash.at).toBe(1.5);
    expect(flash.until).toBe(2.5);
  });

  it('measures a kinetic block end from its layout, stagger and spring', () => {
    const block = { id: 'title', text: { en: 'Make every word land' }, preset: 'cascade', delay: 0.3 };
    const { sections, issues } = resolved([
      card({ kinetic: [block], camera: { hits: ['title.end', { at: 'title.start + 0.05' }] } }),
    ]);
    const settings = resolveKinetic(KineticBlockSchema.parse(block), {
      width: 1280,
      height: 720,
      fps: 30,
      duration: 4,
      seed: 0,
      energy: 1,
    });
    const hits = (sections[0].camera as Section).hits as unknown[];

    expect(issues).toEqual([]);
    expect(hits[0]).toBeCloseTo(0.3 + 3 * settings.stagger + settings.duration, 6);
    expect(hits[1]).toEqual({ at: 0.35 });
  });

  it('uses the default start of an element whose start is omitted', () => {
    const { sections } = resolved([
      card({
        kinetic: [{ id: 'a', text: { en: 'Hi' }, preset: 'fade', unit: 'line', duration: 0.5 }],
        graphics: [{ type: 'flash', at: 'a.start' }],
      }),
    ]);

    expect((sections[0].graphics as Section[])[0].at).toBe(0.2);
  });

  it('resolves percentages, the section end and cues', () => {
    const { sections, issues } = resolved([
      card(
        {
          cues: { drop: 2.4 },
          graphics: [
            { type: 'flash', at: '25%' },
            { type: 'flash', at: 'cue:drop - 0.1', until: 'end - 0.5' },
          ],
          kinetic: [{ text: { en: 'Out' }, preset: 'fade', exit: { preset: 'fade', at: 'end - 0.6' } }],
        },
        4
      ),
    ]);
    const graphics = sections[0].graphics as Section[];

    expect(issues).toEqual([]);
    expect(graphics[0].at).toBe(1);
    expect(graphics[1]).toMatchObject({ at: 2.3, until: 3.5 });
    expect(((sections[0].kinetic as Section[])[0].exit as Section).at).toBe(3.4);
  });

  it('converts beats on the whole-video grid to section time across transitions', () => {
    const { sections, issues } = resolved(
      [
        card({ name: 'one', transition: { type: 'fade', duration: 0.5 } }, 3),
        card({ name: 'two', graphics: [{ type: 'flash', at: 'beat:7' }], camera: { hits: ['bar:3 - 0.1'] } }, 4),
      ],
      { beats: { bpm: 120, offset: 0.25 } }
    );

    // Section two starts at 3 - 0.5 = 2.5 s. Beat 7 = 0.25 + 6 × 0.5 = 3.25 s of video.
    expect(issues).toEqual([]);
    expect((sections[1].graphics as Section[])[0].at).toBe(0.75);
    // Bar 3 = beat 9 = 4.25 s of video, led by 0.1 s.
    expect((sections[1].camera as Section).hits).toEqual([1.65]);
  });

  it('takes explicit beat times from an analysis', () => {
    const { sections } = resolved([card({ graphics: [{ type: 'flash', at: 'beat:3' }] })], {
      beats: { times: [0.48, 0.97, 1.51, 2.02] },
    });

    expect((sections[0].graphics as Section[])[0].at).toBe(1.51);
  });

  it('resolves keyframe times and keeps relative ones', () => {
    const { sections } = resolved([
      card({
        cues: { hit: 1.2 },
        filters: [
          {
            type: 'drawtext',
            values: { text: { en: 'x' }, x: 0, y: 0, fontsize: 40 },
            animate: {
              opacity: [
                { t: 'cue:hit', v: 0 },
                { t: '+0.3', v: 1 },
              ],
            },
          },
        ],
      }),
    ]);
    const keys = ((sections[0].filters as Section[])[0].animate as Section).opacity;

    expect(keys).toEqual([
      { t: 1.2, v: 0 },
      { t: '+0.3', v: 1 },
    ]);
  });

  it('leaves sections without references untouched', () => {
    const section = card({ graphics: [{ type: 'flash', at: 1 }] });

    expect(resolved([section]).sections[0]).toBe(section);
  });
});

describe('time reference errors', () => {
  it('reports an unknown id with the nearest id', () => {
    const { issues } = resolved([
      card({
        kinetic: [{ id: 'title', text: { en: 'a' }, preset: 'fade' }],
        graphics: [{ type: 'flash', at: 'titel.end' }],
      }),
    ]);

    expect(issues).toEqual([
      {
        path: 'sections[0].graphics[0].at',
        code: 'unknown_time_ref',
        message: 'no element with id "titel" in this section',
        hint: 'did you mean "title.end"?',
      },
    ]);
  });

  it('reports an unknown cue', () => {
    expect(
      resolved([card({ cues: { drop: 1 }, graphics: [{ type: 'flash', at: 'cue:dorp' }] })]).issues[0]
    ).toMatchObject({ code: 'unknown_time_ref', hint: 'did you mean "cue:drop"?' });
  });

  it('reports cycles, including a self-reference', () => {
    const { issues } = resolved([
      card({
        graphics: [
          { id: 'a', type: 'flash', at: 'b.end' },
          { id: 'b', type: 'flash', at: 'a.end' },
          { id: 'c', type: 'flash', at: 'c.start + 1' },
        ],
      }),
    ]);

    expect(issues.map((issue) => [issue.path, issue.code])).toEqual([
      ['sections[0].graphics[0].at', 'circular_time_ref'],
      ['sections[0].graphics[1].at', 'circular_time_ref'],
      ['sections[0].graphics[2].at', 'circular_time_ref'],
    ]);
    expect(issues[0].message).toBe('circular time reference: a → b → a');
  });

  it('reports what cannot be known before rendering', () => {
    const noBeats = resolved([card({ graphics: [{ type: 'flash', at: 'beat:2' }] })]).issues;
    const pastEnd = resolved([card({ graphics: [{ type: 'flash', at: 'beat:9' }] })], { beats: { times: [1] } }).issues;
    const probed = resolved(
      [
        { name: 'clip', type: 'project_video', graphics: [{ type: 'flash', at: '50%' }] },
        card({ graphics: [{ type: 'flash', at: 'beat:2' }] }),
      ],
      { beats: { bpm: 100 } }
    ).issues;

    expect(noBeats[0]).toMatchObject({ code: 'unresolvable_time_ref', message: '"beat:2" needs global.beats' });
    expect(pastEnd[0]).toMatchObject({ code: 'unresolvable_time_ref', message: 'global.beats has no beat 9' });
    expect(probed.map((issue) => [issue.path, issue.code])).toEqual([
      ['sections[0].graphics[0].at', 'unresolvable_time_ref'],
      ['sections[1].graphics[0].at', 'unresolvable_time_ref'],
    ]);
  });

  it('reports negative times and duplicate ids', () => {
    const { issues } = resolved([
      card({
        graphics: [
          { id: 'a', type: 'flash', at: 0.1 },
          { id: 'a', type: 'flash', at: 'a.start - 0.3' },
        ],
      }),
    ]);

    expect(issues.map((issue) => [issue.path, issue.code])).toEqual([
      ['sections[0].graphics[1].id', 'duplicate_time_id'],
      ['sections[0].graphics[1].at', 'negative_time'],
    ]);
  });

  it('surfaces through the template validator', () => {
    const codes = errors(template([card({ graphics: [{ type: 'flash', at: 'nope.end' }] })])).map((e) => e.code);

    expect(codes).toEqual(['unknown_time_ref']);
    expect(errors(template([card({ graphics: [{ type: 'flash', at: 'nope.ending' }] })])).length).toBeGreaterThan(0);
  });

  it('accepts anchored keyframe tracks in motion validation', () => {
    const descriptor = template([
      card({
        kinetic: [{ id: 'title', text: { en: 'Hello there' }, preset: 'cascade' }],
        filters: [
          {
            type: 'drawtext',
            values: { text: { en: 'x' }, x: 0, y: 0, fontsize: 40 },
            animate: {
              opacity: [
                { t: 'title.end', v: 0 },
                { t: '+$short', v: 1 },
              ],
            },
          },
        ],
      }),
    ]);

    expect(errors(descriptor)).toEqual([]);
  });

  it('fails the build pass with every unresolved field', () => {
    expect(() => prepareMotion(template([card({ graphics: [{ type: 'flash', at: 'x.end' }] })]))).toThrow(
      /sections\[0\]\.graphics\[0\]\.at: no element with id "x"/
    );
  });

  it('guards lowering against an unresolved reference', () => {
    expect(seconds(1.5)).toBe(1.5);
    expect(() => seconds('title.end')).toThrow(/not resolved/);
  });
});

describe('motion catalog timing', () => {
  it('documents the grammar with examples that parse', () => {
    const { timing } = motionCatalog();

    expect(timing.grammar).toContain('beat:<n>');
    for (const example of timing.examples) expect(parseTimeRef(JSON.parse(example) as string)).not.toBeNull();
  });
});
