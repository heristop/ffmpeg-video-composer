import { describe, expect, it } from 'vitest';
import { motionCatalog } from '@/core/motion/catalog';
import { SFX_IDS } from '@/core/audio/sfx-library';
import { SoundSchema } from '@/schemas/sound.schemas';

// motionCatalog().audio.compose: how to build a sound from the vocabulary, with the library recipes as
// worked examples, so an agent composes instead of reaching for the same whoosh.

describe('audio.compose', () => {
  it('explains the vocabulary, the recipes by role and the composing rules', () => {
    const { compose } = motionCatalog().audio;

    expect(compose.vocabulary.length).toBeGreaterThan(0);
    expect(Object.keys(compose.recipes)).toEqual(['impact', 'riser', 'blip', 'texture']);
    expect(compose.rules.join(' ')).toMatch(/vary pitch rather than repeat/);
    expect(compose.analyze).toMatch(/analyze_sound/);

    for (const recipe of Object.values(compose.recipes)) {
      expect(recipe.how.length).toBeGreaterThan(0);
      expect(recipe.presets.every((id) => (SFX_IDS as readonly string[]).includes(id))).toBe(true);
      expect(SoundSchema.safeParse(recipe.example).error?.issues ?? []).toEqual([]);
    }
  });

  it('names every library recipe as a preset to start from', () => {
    expect(motionCatalog().audio.compose.presets).toMatch(/sound: \{ preset/);
  });
});
