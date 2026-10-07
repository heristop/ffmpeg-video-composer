import { describe, expect, it } from 'vitest';
import { SfxCueSchema } from '@/schemas/audio.schemas';
import { SoundSchema } from '@/schemas/sound.schemas';
import { templateDescriptorJsonSchema } from '@/schemas/template.schemas';
import { TemplateValidator } from '@/services/TemplateValidator';

// A sound-effect cue names a bundled preset (`id`) or carries a composed `sound`, never both; the sound's
// every parameter is bounded so a careless value can't render a 20-second shriek.

const composed = {
  length: 0.45,
  layers: [
    {
      source: 'noise',
      color: 'pink',
      filter: { type: 'lowpass', from: 9000, to: 600 },
      envelope: { attack: 0.01, decay: 0.35, curve: 'exp' },
      gain: 0.8,
    },
    { source: 'tone', wave: 'sine', pitch: { from: 180, to: 55 }, envelope: { attack: 0.002, decay: 0.3 }, gain: 0.6 },
  ],
  fx: { saturate: 0.2, room: 0.15 },
};

function issues(value: unknown): string[] {
  const parsed = SoundSchema.safeParse(value);

  return parsed.success ? [] : parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
}

const card = (sfx: unknown[]) => ({ name: 'a', type: 'color_background', options: { duration: 2 }, sfx });

describe('SfxCueSchema', () => {
  it('accepts a preset id or a composed sound, exactly one of them', () => {
    expect(SfxCueSchema.safeParse({ id: 'whoosh', at: 1 }).success).toBe(true);
    expect(SfxCueSchema.safeParse({ sound: composed, at: 'beat:4', volume: 0.5 }).success).toBe(true);
    expect(SfxCueSchema.safeParse({ at: 1 }).success).toBe(false);
    expect(SfxCueSchema.safeParse({ id: 'hit', sound: composed, at: 1 }).success).toBe(false);
  });

  it('says "exactly one of id or sound" in the JSON schema too', () => {
    const global = templateDescriptorJsonSchema.properties?.global as { properties: Record<string, unknown> };
    const cue = (global.properties.sfx as { items: Record<string, unknown> }).items;

    expect(cue.required).toEqual(['at']);
    expect(cue.oneOf).toEqual([{ required: ['id'] }, { required: ['sound'] }]);
  });

  it('validates inside a template, sections and global', () => {
    const validator = new TemplateValidator();
    const template = {
      global: { musicEnabled: false, sfx: [{ at: 0.5, sound: { preset: 'sparkle', pitch: 1.2, length: 0.8 } }] },
      sections: [
        card([
          { id: 'hit', at: 0 },
          { at: 1, sound: composed },
        ]),
      ],
    };

    expect(validator.validateTemplate(template).errors ?? []).toEqual([]);
    expect(validator.validateTemplate({ ...template, sections: [card([{ at: 1 }])] }).success).toBe(false);
  });
});

describe('SoundSchema bounds', () => {
  it('accepts the spec example and every source', () => {
    expect(issues(composed)).toEqual([]);
    expect(
      issues({
        layers: [
          { source: 'strike', pitch: 660, ring: 0.4, click: 0.3, partials: [{ ratio: 2.76, gain: 0.4 }] },
          { source: 'tone', wave: 'square', pitch: 440, vibrato: { rate: 5, depth: 0.3 }, repeat: 4, every: 0.1 },
          { source: 'silence', length: 0.1 },
        ],
        anchor: 'end',
        fx: { echo: 0.3, crush: 0.5 },
      })
    ).toEqual([]);
  });

  it('accepts glides, filter chains and drive', () => {
    expect(
      issues({
        layers: [
          {
            source: 'tone',
            pitch: { from: 160, to: 40, time: 0.2 },
            drive: 0.6,
            filter: [
              { type: 'highpass', cutoff: 30 },
              { type: 'lowpass', from: 2000, to: 300, time: 0.1 },
            ],
          },
        ],
      })
    ).toEqual([]);
    expect(
      issues({
        layers: [{ source: 'noise', filter: Array.from({ length: 4 }, () => ({ type: 'lowpass', cutoff: 900 })) }],
      })
    ).not.toEqual([]);
  });

  it('rejects out-of-bound values', () => {
    const tone = { source: 'tone', pitch: 440 };

    expect(issues({ length: 5, layers: [tone] })).not.toEqual([]);
    expect(issues({ layers: Array.from({ length: 9 }, () => tone) })).not.toEqual([]);
    expect(issues({ layers: [] })).not.toEqual([]);
    expect(issues({ layers: [{ ...tone, pitch: 19 }] })).not.toEqual([]);
    expect(issues({ layers: [{ ...tone, pitch: { from: 100, to: 13000 } }] })).not.toEqual([]);
    expect(issues({ layers: [{ ...tone, gain: 1.5 }] })).not.toEqual([]);
    expect(issues({ layers: [{ ...tone, pan: 2 }] })).not.toEqual([]);
    expect(issues({ layers: [{ ...tone, repeat: 33 }] })).not.toEqual([]);
    expect(issues({ layers: [{ ...tone, filter: { type: 'lowpass', cutoff: 1000, resonance: 20 } }] })).not.toEqual([]);
    expect(issues({ layers: [tone], fx: { room: 2 } })).not.toEqual([]);
    expect(issues({ layers: [{ ...tone, wobble: 1 }] })).not.toEqual([]);
  });

  it('needs a cutoff or a from/to sweep on a filter, not both', () => {
    const at = (spec: object) => issues({ layers: [{ source: 'noise', filter: { type: 'highpass', ...spec } }] });

    expect(at({ cutoff: 800 })).toEqual([]);
    expect(at({ from: 200, to: 4000 })).toEqual([]);
    expect(at({})).not.toEqual([]);
    expect(at({ from: 200 })).not.toEqual([]);
    expect(at({ cutoff: 800, from: 200, to: 300 })).not.toEqual([]);
  });

  it('takes either a preset with its variations or layers, never a mix', () => {
    expect(issues({ preset: 'whoosh', pitch: 0.8, brightness: -0.5, room: 0.3, length: 1 })).toEqual([]);
    expect(issues({ preset: 'gong' })).not.toEqual([]);
    expect(issues({ preset: 'whoosh', layers: composed.layers })).not.toEqual([]);
    expect(issues({ preset: 'whoosh', pitch: 8 })).not.toEqual([]);
    expect(issues({ layers: composed.layers, brightness: 0.5 })).not.toEqual([]);
    expect(issues({})).not.toEqual([]);
  });

  it('bounds the note-seconds a sound renders, with a message saying what to cut', () => {
    const roll = { source: 'strike', pitch: 220, ring: 4, length: 4, repeat: 32 };

    expect(issues({ layers: Array.from({ length: 8 }, () => roll) })).toEqual([
      expect.stringMatching(/^layers: the notes add up to \d+ s .*32 s.*shorter notes or fewer repeats/),
    ]);
    expect(issues({ layers: Array.from({ length: 8 }, () => ({ ...roll, repeat: 1 })) })).toEqual([]);
    expect(issues({ preset: 'whoosh', length: 4 })).toEqual([]);
  });
});
