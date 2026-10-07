import { describe, expect, it } from 'vitest';
import { SFX_IDS, SFX_LIBRARY } from '@/core/audio/sfx-library';
import { SOUND_PRESETS, isVaried, varyPreset } from '@/core/audio/sound-presets';
import { MAX_NOTE_SECONDS, MAX_SOUND_LENGTH } from '@/core/audio/synth/bounds';
import { noteSeconds, soundLength } from '@/core/audio/synth/timing';
import { renderSound } from '@/core/audio/synth/render';
import { analyzeChannels } from '@/core/audio/synth/analysis';
import type { ToneLayer, StrikeLayer } from '@/core/audio/synth/types';
import { SoundSchema } from '@/schemas/sound.schemas';

// The library re-expressed as recipes: every id has one, as long as its file and valid as a `sound`; a
// preset's variations (pitch, length, brightness, room) rewrite the recipe before it renders.

function centroid(sound: Parameters<typeof renderSound>[0]): number {
  const { left, right } = renderSound(sound, 1);

  return analyzeChannels([left, right]).centroidHz;
}

describe('SOUND_PRESETS', () => {
  it('has a valid recipe for every library sound, exactly as long as its file', () => {
    expect(Object.keys(SOUND_PRESETS).sort()).toEqual([...SFX_IDS].sort());

    for (const id of SFX_IDS) {
      expect(soundLength(SOUND_PRESETS[id]), id).toBe(SFX_LIBRARY[id].duration);
      expect(SoundSchema.safeParse(SOUND_PRESETS[id]).error?.issues ?? [], id).toEqual([]);
    }
  });
});

describe('preset render cost', () => {
  it('stays within the note budget at any variation, so the schema need not measure presets', () => {
    for (const id of SFX_IDS) {
      const longest = varyPreset(id, { length: MAX_SOUND_LENGTH, room: 1, pitch: 0.25 });

      expect(noteSeconds(longest), id).toBeLessThanOrEqual(MAX_NOTE_SECONDS);
    }
  });
});

describe('varyPreset', () => {
  it('is unvaried with no variation', () => {
    expect(isVaried({})).toBe(false);
    expect(isVaried({ room: 0.2 })).toBe(true);
    expect(varyPreset('whoosh', {})).toEqual(SOUND_PRESETS.whoosh);
  });

  it('scales every pitch by `pitch`', () => {
    const ding = varyPreset('ding', { pitch: 2 });

    expect((ding.layers[0] as StrikeLayer).pitch).toBe(2637);
    expect(soundLength(ding)).toBe(1.5);
    expect((varyPreset('hit', { pitch: 0.5 }).layers[0] as ToneLayer).pitch).toEqual({
      from: 97.5,
      to: 27.5,
      time: 0.08,
    });
  });

  it('stretches every time to `length`', () => {
    const whoosh = varyPreset('whoosh', { length: 1.2 });

    expect(soundLength(whoosh)).toBe(1.2);
    expect(whoosh.layers[0]).toMatchObject({ envelope: { attack: 0.64, decay: 0.56 } });
  });

  it('tilts the spectrum with `brightness` and adds `room`', () => {
    const base = centroid(SOUND_PRESETS.whoosh);

    expect(centroid(varyPreset('whoosh', { brightness: -1 }))).toBeLessThan(base * 0.7);
    expect(centroid(varyPreset('whoosh', { brightness: 1 }))).toBeGreaterThan(base * 1.3);
    expect(varyPreset('ding', { room: 0.4 }).fx).toEqual({ room: 0.4 });
  });
});
