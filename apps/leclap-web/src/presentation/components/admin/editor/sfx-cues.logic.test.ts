import { describe, expect, it } from 'vitest';
import { GlobalSfxSchema, SectionSfxSchema, type SfxCue } from 'ffmpeg-video-composer/src/schemas/audio.schemas.ts';
import { SFX_LIBRARY } from 'ffmpeg-video-composer/src/core/audio/sfx-library.ts';
import { DEFAULT_SOUND_VOLUME } from 'ffmpeg-video-composer/src/core/audio/synth/bounds.ts';
import {
  GLOBAL_SFX_MAX,
  SECTION_SFX_MAX,
  addCue,
  cueDefaultVolume,
  cueLibraryId,
  formatCueTime,
  parseCueTime,
  percentToVolume,
  removeCue,
  resetCueVolume,
  setCueTime,
  setCueVolume,
  sfxPreviewUrl,
  volumeToPercent,
} from './sfx-cues.logic';

const composed: SfxCue = { sound: { layers: [{ source: 'noise' }] }, at: 1 } as SfxCue;

describe('sfx cue limits', () => {
  it('match the engine schemas (32 per section, 64 on the whole video)', () => {
    const cues = (n: number) => Array.from({ length: n }, () => ({ id: 'pop' as const, at: 0 }));

    expect(SectionSfxSchema.safeParse(cues(SECTION_SFX_MAX)).success).toBe(true);
    expect(SectionSfxSchema.safeParse(cues(SECTION_SFX_MAX + 1)).success).toBe(false);
    expect(GlobalSfxSchema.safeParse(cues(GLOBAL_SFX_MAX)).success).toBe(true);
    expect(GlobalSfxSchema.safeParse(cues(GLOBAL_SFX_MAX + 1)).success).toBe(false);
  });
});

describe('addCue', () => {
  it('appends a library sound at 0 s with no volume, so it plays at its own level', () => {
    expect(addCue(undefined, 'whoosh', SECTION_SFX_MAX)).toEqual([{ id: 'whoosh', at: 0 }]);
    expect(addCue([{ id: 'hit', at: 1 }], 'boom', SECTION_SFX_MAX)).toEqual([
      { id: 'hit', at: 1 },
      { id: 'boom', at: 0 },
    ]);
  });

  it('refuses to grow past the limit', () => {
    const full = Array.from({ length: SECTION_SFX_MAX }, () => ({ id: 'pop' as const, at: 0 }));

    expect(addCue(full, 'hit', SECTION_SFX_MAX)).toBe(full);
  });

  it('produces cues the engine schema accepts', () => {
    expect(SectionSfxSchema.safeParse(addCue(undefined, 'riser', SECTION_SFX_MAX)).success).toBe(true);
  });
});

describe('removeCue', () => {
  it('drops one cue and keeps the others in order', () => {
    const cues: SfxCue[] = [
      { id: 'hit', at: 1 },
      { id: 'pop', at: 2 },
      { id: 'ding', at: 3 },
    ];

    expect(removeCue(cues, 1)).toEqual([
      { id: 'hit', at: 1 },
      { id: 'ding', at: 3 },
    ]);
  });

  it('clears the list when the last cue goes, so no empty sfx array is written', () => {
    expect(removeCue([{ id: 'hit', at: 1 }], 0)).toBeUndefined();
  });
});

describe('volume mapping', () => {
  it('maps the 0..200% slider onto the 0..2 gain', () => {
    expect(percentToVolume(0)).toBe(0);
    expect(percentToVolume(100)).toBe(1);
    expect(percentToVolume(200)).toBe(2);
    expect(percentToVolume(55)).toBe(0.55);
    expect(volumeToPercent(0.45)).toBe(45);
    expect(volumeToPercent(2)).toBe(200);
  });

  it('clamps out-of-range slider values', () => {
    expect(percentToVolume(250)).toBe(2);
    expect(percentToVolume(-10)).toBe(0);
  });

  it('defaults a library cue to its library level', () => {
    expect(cueDefaultVolume({ id: 'whoosh', at: 0 })).toBe(SFX_LIBRARY.whoosh.defaultVolume);
    expect(cueDefaultVolume({ id: 'hit', at: 0 })).toBe(SFX_LIBRARY.hit.defaultVolume);
  });

  it('defaults a preset sound to its library level and a composed sound to the engine fallback', () => {
    expect(cueDefaultVolume({ sound: { preset: 'tada' }, at: 0 } as SfxCue)).toBe(SFX_LIBRARY.tada.defaultVolume);
    expect(cueDefaultVolume(composed)).toBe(DEFAULT_SOUND_VOLUME);
    expect(DEFAULT_SOUND_VOLUME).toBe(0.6);
  });

  it('sets a volume without touching the other fields of the cue', () => {
    const cues = [{ ...composed, extra: 'kept' } as SfxCue];

    expect(setCueVolume(cues, 0, 1.5)[0]).toEqual({ ...composed, extra: 'kept', volume: 1.5 });
  });

  it('removes the volume key on reset, so the cue falls back to its default', () => {
    const next = resetCueVolume([{ id: 'hit', at: 1, volume: 1.2 }], 0);

    expect(next[0]).toEqual({ id: 'hit', at: 1 });
    expect(next[0]).not.toHaveProperty('volume');
  });
});

describe('time validation', () => {
  it('accepts plain seconds, including decimals and a comma', () => {
    expect(parseCueTime('1.5')).toEqual({ ok: true, at: 1.5 });
    expect(parseCueTime(' 2 ')).toEqual({ ok: true, at: 2 });
    expect(parseCueTime('0,25')).toEqual({ ok: true, at: 0.25 });
  });

  it('keeps a valid time reference as text', () => {
    expect(parseCueTime('cue:drop')).toEqual({ ok: true, at: 'cue:drop' });
    expect(parseCueTime('title.end + 0.2')).toEqual({ ok: true, at: 'title.end + 0.2' });
    expect(parseCueTime('beat:8 - 0.1')).toEqual({ ok: true, at: 'beat:8 - 0.1' });
    expect(parseCueTime('end')).toEqual({ ok: true, at: 'end' });
  });

  it('rejects empty, negative and malformed values', () => {
    expect(parseCueTime('').ok).toBe(false);
    expect(parseCueTime('   ').ok).toBe(false);
    expect(parseCueTime('-1').ok).toBe(false);
    expect(parseCueTime('soon').ok).toBe(false);
    expect(parseCueTime('beat:0').ok).toBe(false);
    expect(parseCueTime('150%').ok).toBe(false);
    expect(parseCueTime('x'.repeat(81)).ok).toBe(false);
  });

  it('agrees with the engine schema on what it accepts', () => {
    for (const text of ['1.5', 'cue:drop', 'title.end + 0.2', '50%', 'soon', 'beat:0', '-1']) {
      const parsed = parseCueTime(text);
      const at = parsed.ok ? parsed.at : text;

      expect(SectionSfxSchema.safeParse([{ id: 'pop', at }]).success).toBe(parsed.ok);
    }
  });

  it('formats numbers and references back for the field', () => {
    expect(formatCueTime(1.5)).toBe('1.5');
    expect(formatCueTime(0)).toBe('0');
    expect(formatCueTime('cue:drop')).toBe('cue:drop');
  });

  it('leaves the list alone for an index out of range', () => {
    const cues: SfxCue[] = [{ id: 'hit', at: 1 }];

    expect(setCueTime(cues, 3, 2)).toEqual(cues);
    expect(setCueVolume(cues, 3, 1)).toEqual(cues);
  });

  it('sets the time of one cue and keeps the rest of it', () => {
    expect(setCueTime([{ id: 'hit', at: 1, volume: 0.3 }], 0, 'cue:drop')).toEqual([
      { id: 'hit', at: 'cue:drop', volume: 0.3 },
    ]);
  });
});

describe('library helpers', () => {
  it('names the library id of a cue (an id, or an unvaried preset) and nothing for a composed sound', () => {
    expect(cueLibraryId({ id: 'pop', at: 0 })).toBe('pop');
    expect(cueLibraryId(composed)).toBeUndefined();
  });

  it('serves previews from the staged creative-kit library', () => {
    expect(sfxPreviewUrl('whoosh')).toBe('/assets/sfx/whoosh.m4a');
  });
});
