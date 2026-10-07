import { describe, expect, it } from 'vitest';
import { expandPartials, expandPartialsSafe } from '@/core/partials';
import { envelopeTimeMap } from '@/core/partial-envelope';
import { TemplateValidator } from '@/services/TemplateValidator';

type Descriptor = Parameters<typeof expandPartials>[0];
type Bag = Record<string, any>;

// A 4 s bumper: the title lands in the first second (IN), holds, and exits in the last 0.8 s (OUT).
function bumper(extra: Bag = {}): Bag {
  return {
    id: 'bumper',
    envelope: { in: 1, out: 0.8 },
    syncPoints: [{ id: 'land', offset: 0.6 }],
    jobs: ['brand'],
    sections: [
      {
        name: 'card',
        type: 'color_background',
        options: { duration: 4, backgroundColor: '#000000' },
        kinetic: [{ id: 'title', text: { en: 'Hi' }, preset: 'pop', delay: 0.2, exit: { preset: 'fade', at: 3.2 } }],
        graphics: [{ type: 'flash', at: 0.6 }],
        cues: { out: 3.2 },
      },
    ],
    ...extra,
  };
}

function expand(partials: Bag[], sections: Bag[], global: Bag = {}): Bag[] {
  return (expandPartials({ global, partials, sections } as unknown as Descriptor).sections ?? []) as Bag[];
}

describe('partial envelope (ref duration)', () => {
  it('leaves a ref without duration/align byte-identical (no sync points)', () => {
    const partial = bumper({ syncPoints: undefined });
    const [section] = expand([partial], [{ type: 'partial', ref: 'bumper' }]);

    expect(section).toBe(partial.sections[0]);
  });

  it('stretches only the hold: IN keeps its times, OUT shifts by the extra', () => {
    const [card] = expand([bumper()], [{ type: 'partial', ref: 'bumper', duration: 6 }]);

    expect(card.options.duration).toBe(6);
    expect(card.kinetic[0].delay).toBe(0.2);
    expect(card.graphics[0].at).toBe(0.6);
    // The exit sat at 3.2 = T - out: it moves with the outro.
    expect(card.kinetic[0].exit.at).toBe(5.2);
    expect(card.cues.out).toBe(5.2);
  });

  it('shrinks the hold linearly when the duration is shorter but still fits IN + OUT', () => {
    const [card] = expand([bumper()], [{ type: 'partial', ref: 'bumper', duration: 2.5 }]);

    expect(card.options.duration).toBe(2.5);
    expect(card.kinetic[0].delay).toBe(0.2);
    expect(card.kinetic[0].exit.at).toBe(1.7);
  });

  it('compresses IN and OUT proportionally below IN + OUT and warns partial_compressed', () => {
    const descriptor = { partials: [bumper()], sections: [{ type: 'partial', ref: 'bumper', duration: 0.9 }] };
    const expansion = expandPartialsSafe(descriptor);

    expect(expansion.ok).toBe(true);

    if (!expansion.ok) return;

    const card = (expansion.data as Bag).sections[0];
    const factor = 0.9 / 1.8;

    expect(card.options.duration).toBe(0.9);
    expect(card.kinetic[0].delay).toBeCloseTo(0.2 * factor, 6);
    expect(card.kinetic[0].exit.at).toBeCloseTo(factor, 6);
    expect(expansion.warnings?.[0]).toMatchObject({ path: 'sections[0].duration', code: 'partial_compressed' });
    expect(new TemplateValidator().getMotionWarnings(descriptor).map((w) => w.code)).toContain('partial_compressed');
  });

  it('stretches the section that contains the hold end in a multi-section partial', () => {
    const partial = {
      id: 'three',
      envelope: { in: 1, out: 1 },
      sections: [
        { name: 'a', type: 'color_background', options: { duration: 1 } },
        { name: 'b', type: 'color_background', options: { duration: 2 }, graphics: [{ type: 'flash', at: 1.5 }] },
        { name: 'c', type: 'color_background', options: { duration: 1 }, graphics: [{ type: 'flash', at: 0.5 }] },
      ],
    };
    const sections = expand([partial], [{ type: 'partial', ref: 'three', duration: 7 }]);

    expect(sections.map((s) => s.options.duration)).toEqual([1, 5, 1]);
    // b ends exactly at H = 3: the boundary belongs to the earlier section, whose content keeps its times.
    expect(sections[1].graphics[0].at).toBe(1.5);
    expect(sections[2].graphics[0].at).toBe(0.5);
  });

  it('treats a partial without an envelope as all IN: the tail holds', () => {
    const [card] = expand([bumper({ envelope: undefined })], [{ type: 'partial', ref: 'bumper', duration: 5 }]);

    expect(card.options.duration).toBe(5);
    expect(card.kinetic[0].exit.at).toBe(3.2);
  });

  it('maps the time map piecewise', () => {
    const grow = envelopeTimeMap({ in: 1, out: 1 }, 4, 6).map;

    expect([0.5, 2.9, 3, 4].map(grow)).toEqual([0.5, 2.9, 5, 6]);

    const squeeze = envelopeTimeMap({ in: 1, out: 1 }, 4, 1);

    expect(squeeze.compressed).toBe(true);
    expect([0, 1, 2, 3, 4].map(squeeze.map)).toEqual([0, 0.5, 0.5, 0.5, 1]);
  });

  it('refuses a duration when a partial section has no fixed length', () => {
    const partial = { id: 'clip', sections: [{ name: 'v', type: 'project_video' }] };
    const result = expandPartialsSafe({
      partials: [partial],
      sections: [{ type: 'partial', ref: 'clip', duration: 3 }],
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'partial_duration_unknown', path: 'sections[0].duration' },
    });
  });

  it('reports a malformed duration as invalid_partial_ref', () => {
    const result = expandPartialsSafe({
      partials: [bumper()],
      sections: [{ type: 'partial', ref: 'bumper', duration: -1 }],
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_partial_ref' } });
  });
});

describe('partial sync points', () => {
  it('exports each sync point as a cue of the section it falls in', () => {
    const [card] = expand([bumper()], [{ type: 'partial', ref: 'bumper' }]);

    expect(card.cues).toEqual({ out: 3.2, land: 0.6 });
  });

  it('lets a time reference in the partial target the exported cue', () => {
    const partial = bumper();
    partial.sections[0].graphics = [{ type: 'flash', at: 'cue:land' }];
    const result = new TemplateValidator().validateTemplate({
      partials: [partial],
      sections: [{ type: 'partial', ref: 'bumper' }],
    });

    expect(result.errors ?? []).toEqual([]);
  });

  it('rejects a sync point after the IN envelope in the partial definition', () => {
    const result = new TemplateValidator().validateTemplate({
      partials: [bumper({ syncPoints: [{ id: 'late', offset: 2 }] })],
      sections: [],
    });

    expect(result.success).toBe(false);
    expect(result.errors?.[0].path).toContain('syncPoints');
  });
});

describe('partial align', () => {
  const lead = { name: 'lead', type: 'color_background', options: { duration: 2 } };
  const beats = { bpm: 120 };

  it('resizes the previous section so the sync point lands on the beat', () => {
    // beat 9 at 120 bpm = 4 s; the sync point sits 0.6 s into the partial → lead must last 3.4 s.
    const sections = expand(
      [bumper()],
      [lead, { type: 'partial', ref: 'bumper', align: { sync: 'land', to: 'beat:9' } }],
      { beats, transition: { type: 'cut' } }
    );

    expect(sections[0].options.duration).toBe(3.4);
  });

  it('accounts for the transition overlap at the boundary', () => {
    const sections = expand(
      [bumper()],
      [lead, { type: 'partial', ref: 'bumper', align: { sync: 'land', to: 'beat:9' } }],
      { beats, transition: { type: 'fade', duration: 0.5 } }
    );

    // start of the partial = lead - 0.5 overlap → lead = 4 - 0.6 + 0.5.
    expect(sections[0].options.duration).toBeCloseTo(3.9, 4);
  });

  it('aligns onto a cue of an earlier section', () => {
    const cued = { ...lead, options: { duration: 3 }, cues: { drop: 2.5 } };
    const sections = expand(
      [bumper()],
      [cued, { type: 'partial', ref: 'bumper', align: { sync: 'land', to: 'cue:drop + 0.5' } }],
      { transition: { type: 'cut' } }
    );

    expect(sections[0].options.duration).toBe(2.4);
  });

  it('fails when the target is already behind the sync point', () => {
    const result = expandPartialsSafe({
      global: { beats, transition: { type: 'cut' } },
      partials: [bumper()],
      sections: [lead, { type: 'partial', ref: 'bumper', align: { sync: 'land', to: 'beat:1' } }],
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'align_unreachable', path: 'sections[1].align' } });
  });

  it('fails on an unknown sync id with a nearest-name hint', () => {
    const result = expandPartialsSafe({
      global: { beats },
      partials: [bumper()],
      sections: [lead, { type: 'partial', ref: 'bumper', align: { sync: 'lnd', to: 'beat:9' } }],
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'align_unknown_sync', hint: 'did you mean "land"?' } });
  });

  it('fails when an earlier length is unknown', () => {
    const result = expandPartialsSafe({
      global: { beats },
      partials: [bumper()],
      sections: [
        { name: 'clip', type: 'project_video' },
        lead,
        { type: 'partial', ref: 'bumper', align: { sync: 'land', to: 'beat:9' } },
      ],
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'align_unresolvable' } });
  });

  it('surfaces align failures through validateTemplate', () => {
    const result = new TemplateValidator().validateTemplate({
      partials: [bumper()],
      sections: [lead, { type: 'partial', ref: 'bumper', align: { sync: 'land', to: 'beat:9' } }],
    });

    expect(result.success).toBe(false);
    expect(result.errors?.[0]).toMatchObject({ code: 'align_unresolvable', hint: 'add global.beats' });
  });
});
