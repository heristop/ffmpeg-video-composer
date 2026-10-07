import { describe, expect, it } from 'vitest';
import { TemplateValidator } from '@/services/TemplateValidator';
import { soundAdvisories, SOUND_THRESHOLDS } from '@/services/sound-advisories';

// The guardrails for an author who can't hear: advisory, like the motion lint (never `errors`), each with a
// fix hint, surfaced through getMotionWarnings (CLI `validate`, MCP validate_template).

type Bag = Record<string, unknown>;

function card(name: string, sfx: unknown[], duration = 4): Bag {
  return { name, type: 'color_background', options: { backgroundColor: '#101014', duration }, sfx };
}

function codes(template: Bag): Array<{ code: string; path: string }> {
  return soundAdvisories(template).map(({ code, path }) => ({ code, path }));
}

const tone = (pitch: number, gain = 1) => ({ source: 'tone', pitch, gain, envelope: { decay: 0.2 } });

describe('sound advisories', () => {
  it('stay quiet on a sensible template', () => {
    const template = {
      global: { musicEnabled: true, sfx: [{ id: 'whoosh', at: 3.9 }] },
      sections: [
        card('a', [
          { id: 'hit', at: 0.5 },
          { at: 1.5, sound: { preset: 'pop', pitch: 1.3 } },
          { at: 2.5, sound: { layers: [tone(660), { source: 'noise', color: 'pink', envelope: { decay: 0.1 } }] } },
        ]),
      ],
    };

    expect(codes(template)).toEqual([]);
  });

  it('sound_clipped: layers summed far over full scale before normalisation', () => {
    const hot = { layers: Array.from({ length: 6 }, () => tone(220)) };

    expect(SOUND_THRESHOLDS.clippedPeak).toBeCloseTo(2.82, 2);
    expect(codes({ sections: [card('a', [{ at: 1, sound: hot }])] })).toEqual([
      { code: 'sound_clipped', path: 'sections[0].sfx[0].sound' },
    ]);
  });

  it('sound_harsh: a sustained sound with most of its energy above 8 kHz', () => {
    const hiss = { length: 0.8, layers: [{ source: 'noise', envelope: { sustain: 1 } }] };
    const tick = { length: 0.05, layers: [{ source: 'noise', envelope: { decay: 0.04 } }] };

    expect(codes({ sections: [card('a', [{ at: 1, sound: hiss }])] }).map((w) => w.code)).toEqual(['sound_harsh']);
    expect(codes({ sections: [card('a', [{ at: 1, sound: tick }])] })).toEqual([]);
  });

  it('sound_muddy: a long, low-heavy sound under music', () => {
    const rumble = { length: 1.5, layers: [{ source: 'tone', pitch: 45, envelope: { sustain: 1 } }] };

    expect(codes({ global: { musicEnabled: true }, sections: [card('a', [{ at: 1, sound: rumble }])] })).toEqual([
      { code: 'sound_muddy', path: 'sections[0].sfx[0].sound' },
    ]);
    expect(codes({ global: { musicEnabled: false }, sections: [card('a', [{ at: 1, sound: rumble }])] })).toEqual([]);
  });

  it('sound_long: a sound running well past the end of its section', () => {
    expect(codes({ sections: [card('a', [{ id: 'boom', at: 2.5 }], 3)] })).toEqual([
      { code: 'sound_long', path: 'sections[0].sfx[0]' },
    ]);
    expect(codes({ sections: [card('a', [{ id: 'boom', at: 2.2 }], 3)] })).toEqual([]);
  });

  it('sound_repeated: the same sound on every cue of a section', () => {
    const same = [0.5, 1.5, 2.5].map((at) => ({ id: 'pop', at }));
    const varied = [0.5, 1.5, 2.5].map((at, i) => ({ at, sound: { preset: 'pop', pitch: 1 + i * 0.1 } }));

    expect(codes({ sections: [card('a', same)] })).toEqual([{ code: 'sound_repeated', path: 'sections[0].sfx' }]);
    expect(codes({ sections: [card('a', varied)] })).toEqual([]);
    // Typing and counting sounds are meant to repeat (the library: "one per character", "a counter step").
    expect(
      codes({
        sections: [
          card(
            'a',
            [0.5, 1, 1.5].map((at) => ({ id: 'keystroke', at }))
          ),
        ],
      })
    ).toEqual([]);
  });

  it('sound_overlap: more sounds at once than the ear separates', () => {
    const wall = ['hit', 'boom', 'whoosh', 'ding', 'sparkle'].map((id, i) => ({ id, at: 1 + i * 0.05 }));

    expect(codes({ sections: [card('a', wall)] })).toEqual([{ code: 'sound_overlap', path: 'sections[0].sfx[3]' }]);
  });

  it('rides along getMotionWarnings with a hint each', () => {
    const warnings = new TemplateValidator().getMotionWarnings({
      global: { musicEnabled: false },
      sections: [
        card(
          'a',
          [0.5, 1.5, 2.5].map((at) => ({ id: 'pop', at }))
        ),
      ],
    });
    const repeated = warnings.find((warning) => warning.code === 'sound_repeated');

    expect(repeated).toMatchObject({ severity: 'warn' });
    expect(repeated?.hint).toMatch(/pitch/);
  });
});
