import { describe, expect, it } from 'vitest';
import { AUTO_SFX_CAP, expandAutoSfx } from '@/core/audio/auto-sfx';
import { resolveTimeRefs } from '@/core/timing/resolve';
import { prepareMotion } from '@/director/prepare-build';
import { motionCatalog } from '@/core/motion/catalog';
import { SFX_IDS } from '@/core/audio/sfx-library';
import { TemplateValidator } from '@/services/TemplateValidator';
import { qcExpectations } from '@/director/qc-expectations';
import type { ProjectBuildInfos, Section } from '@/core/types';

type Bag = Record<string, unknown>;

function card(name: string, fields: Bag = {}, duration = 4): Bag {
  return { name, type: 'color_background', options: { backgroundColor: '#101014', duration }, ...fields };
}

function auto(sections: Bag[], global: Bag = {}): Bag[] {
  const descriptor = { global: { audio: { sfx: 'auto' }, ...global }, sections };

  return (expandAutoSfx(resolveTimeRefs(descriptor).descriptor).sections as Bag[]).map(
    (section) => (section.sfx ?? []) as Bag
  );
}

const validator = new TemplateValidator();

function errors(descriptor: unknown): Array<{ code: string; path: string; message: string }> {
  return (validator.validateTemplate(descriptor).errors ?? []) as Array<{
    code: string;
    path: string;
    message: string;
  }>;
}

describe('auto sound effects', () => {
  it('adds a whoosh where a designed transition starts, not on a plain fade', () => {
    const sfx = auto([
      card('a', { transition: { type: 'push-left', duration: 0.6 } }),
      card('b', { transition: { type: 'fade', duration: 0.5 } }),
      card('c'),
    ]);

    expect(sfx).toEqual([[], [{ id: 'whoosh', at: 0 }], []]);
  });

  it('adds a hit where an impact block lands and on each camera hit, a riser into the drop cue', () => {
    const [sfx] = auto([
      card('a', {
        cues: { drop: 3 },
        kinetic: [
          { text: { en: 'NOW' }, preset: 'impact', delay: 0.5 },
          { text: { en: 'calm copy' }, preset: 'fade', delay: 1 },
        ],
        camera: { preset: 'push-in', hits: [2, { at: 'cue:drop' }] },
      }),
    ]) as unknown as Bag[][];
    const ids = sfx.map((cue) => `${String(cue.id)}@${String(cue.at)}`);

    expect(ids[0]).toMatch(/^hit@0\.[5-9]/);
    expect(ids.slice(1)).toEqual(['hit@2', 'hit@3', 'riser@3']);
  });

  it('never stacks on an authored sound, and is a no-op unless asked', () => {
    const authored = card('a', { sfx: [{ id: 'boom', at: 2.05 }], camera: { preset: 'push-in', hits: [2] } });

    expect(auto([authored])).toEqual([[{ id: 'boom', at: 2.05 }]]);

    const off = { global: {}, sections: [card('a', { camera: { preset: 'push-in', hits: [2] } })] };

    expect(expandAutoSfx(off)).toBe(off);
  });

  it(`is deterministic and capped at ${AUTO_SFX_CAP}`, () => {
    const hits = Array.from({ length: 10 }, (_, i) => i * 0.3);
    const sections = [
      card('a', { camera: { preset: 'push-in', hits } }),
      card('b', { camera: { preset: 'push-in', hits } }),
    ];
    const first = auto(sections);

    expect(first.flat()).toHaveLength(AUTO_SFX_CAP);
    expect(auto(sections)).toEqual(first);
  });

  it('runs in the build after time references resolve', () => {
    const prepared = prepareMotion({
      global: { audio: { sfx: 'auto' } },
      sections: [card('a', { cues: { drop: 2.5 }, sfx: [{ id: 'pop', at: 'cue:drop - 1' }] })],
    }) as { sections: Bag[] };

    expect(prepared.sections[0].sfx).toEqual([
      { id: 'pop', at: 1.5 },
      { id: 'riser', at: 2.5 },
    ]);
  });
});

describe('sound-effect time references', () => {
  it('resolves section sfx and clip automation in section time', () => {
    const { descriptor, issues } = resolveTimeRefs({
      global: {},
      sections: [
        card('a', {
          cues: { drop: 2 },
          sfx: [{ id: 'hit', at: 'cue:drop' }],
          options: { duration: 4, audioAutomation: [{ at: 'end - 1', volume: 0 }] },
        }),
      ],
    });
    const section = (descriptor.sections as Bag[])[0];

    expect(issues).toEqual([]);
    expect(section.sfx).toEqual([{ id: 'hit', at: 2 }]);
    expect((section.options as Bag).audioAutomation).toEqual([{ at: 3, volume: 0 }]);
  });

  it('resolves global sfx and music automation on the whole-video timeline', () => {
    const { descriptor, issues } = resolveTimeRefs({
      global: {
        beats: { bpm: 120 },
        sfx: [
          { id: 'whoosh', at: 'outro.start - 0.2' },
          { id: 'riser', at: 'cue:drop' },
          { id: 'tick', at: 'beat:3' },
        ],
        audio: {
          automation: [
            { at: 'intro.end', volume: 1 },
            { at: '50%', volume: 0.5 },
            { at: 'end', volume: 0 },
          ],
        },
      },
      sections: [card('intro', {}, 3), { name: 'form', type: 'form' }, card('outro', { cues: { drop: 1.5 } }, 5)],
    });
    const global = descriptor.global as Bag;

    expect(issues).toEqual([]);
    expect(global.sfx).toEqual([
      { id: 'whoosh', at: 2.8 },
      { id: 'riser', at: 4.5 },
      { id: 'tick', at: 1 },
    ]);
    expect((global.audio as Bag).automation).toEqual([
      { at: 3, volume: 1 },
      { at: 4, volume: 0.5 },
      { at: 8, volume: 0 },
    ]);
  });

  it('reports unknown sections and cues, and starts that depend on a probed clip', () => {
    const found = errors({
      global: {
        musicEnabled: false,
        sfx: [
          { id: 'hit', at: 'outr.start' },
          { id: 'hit', at: 'cue:dorp' },
        ],
      },
      sections: [card('intro', { cues: { drop: 1 } }), card('outro')],
    });

    expect(found).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'global.sfx[0].at', code: 'unknown_time_ref' }),
        expect.objectContaining({ path: 'global.sfx[1].at', code: 'unknown_time_ref' }),
      ])
    );

    const probed = errors({
      global: { musicEnabled: false, sfx: [{ id: 'hit', at: 'b.start' }] },
      sections: [{ name: 'a', type: 'project_video' }, card('b')],
    });

    expect(probed).toEqual([expect.objectContaining({ path: 'global.sfx[0].at', code: 'unresolvable_time_ref' })]);
  });
});

describe('sound-effect schema and catalog', () => {
  it('accepts the audio polish fields and rejects an unknown sound or a voice on a silent section', () => {
    const ok = {
      global: {
        musicEnabled: false,
        sfx: [{ id: 'ding', at: 'end - 1.5' }],
        audio: { sfx: 'auto', automation: [{ at: 0, volume: 1, ease: '$snappy' }] },
      },
      sections: [
        {
          name: 'clip',
          type: 'video',
          options: { duration: 3, voice: 'clean', audioAutomation: [{ at: 1, volume: 0.5 }] },
          sfx: [{ id: 'hit', at: 1, volume: 0.6 }],
        },
      ],
    };

    expect(errors(ok)).toEqual([]);
    expect(errors({ ...ok, sections: [card('a', { sfx: [{ id: 'gong', at: 1 }] })] })).not.toEqual([]);
    expect(errors({ ...ok, sections: [card('a', { options: { duration: 2, voice: 'clean' } })] })).not.toEqual([]);
  });

  it('lists every sound with when to use it, plus voice presets and automation', () => {
    const { audio } = motionCatalog();

    expect(audio.sfx.map((entry) => entry.id)).toEqual([...SFX_IDS]);
    expect(audio.sfx.every((entry) => entry.useWhen.length > 0 && entry.avoidWhen.length > 0)).toBe(true);
    expect(audio.sfx.find((entry) => entry.id === 'riser')?.anchor).toBe('end');
    expect(Object.keys(audio.voice)).toEqual(['clean', 'broadcast', 'warm', 'rumble-cut', 'room-gate']);
    expect(motionCatalog().timing.fields).toContain('sfx[].at');
  });

  it('expects audio in the QC once a sound effect is placed', () => {
    const buildInfos = {
      durations: { a: 2 },
      transitions: [],
      sourceHasAudio: {},
      musicPath: '',
    } as unknown as ProjectBuildInfos;
    const silent = [{ name: 'a', type: 'color_background', options: { duration: 2 } }] as Section[];
    const withSfx = [{ ...silent[0], sfx: [{ id: 'pop', at: 1 }] }] as Section[];

    expect(qcExpectations(silent, buildInfos, { musicEnabled: false }, 30).audioExpected).toBe(false);
    expect(qcExpectations(withSfx, buildInfos, { musicEnabled: false }, 30).audioExpected).toBe(true);
    expect(qcExpectations(silent, buildInfos, { sfx: [{ id: 'pop', at: 1 }] }, 30).audioExpected).toBe(true);
  });
});
