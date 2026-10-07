import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TemplateDescriptor } from 'ffmpeg-video-composer/src/core/types.d.ts';
import { applyMediaChoices } from './applyMediaChoices';
import { analyzeMusicInBrowser, wantsBeatAnalysis } from './musicBeats';

const TABLE = {
  'drop-track': {
    bpm: 120,
    offset: 0.5,
    beatsPerBar: 4,
    times: [0.5, 1, 1.5],
    confidence: 5.1,
    usable: true,
    cues: { build: 2, drop: 6.5, end: 30 },
  },
};

vi.mock('@leclap/creative-kit/music-beats', () => ({
  findMusicBeats: (id: string) => (TABLE as Record<string, unknown>)[id],
}));

const analyzeAudioBytes = vi.fn();
// A decoder that fails, outside vi.fn: a mock records its rejected promise, which surfaces as unhandled.
let failDecoding = false;

vi.mock('./browserMusicAnalysis', () => ({
  analyzeAudioBytes: async (bytes: ArrayBuffer) => {
    if (failDecoding) throw new Error('EncodingError');

    return analyzeAudioBytes(bytes);
  },
}));

function twoCards(beats?: unknown): TemplateDescriptor {
  return {
    global: beats === undefined ? {} : { beats },
    sections: [
      { name: 'a', type: 'color_background', options: { duration: 4 } },
      { name: 'b', type: 'color_background', options: { duration: 4 } },
    ],
  } as unknown as TemplateDescriptor;
}

beforeEach(() => analyzeAudioBytes.mockReset());

describe('picking a library track', () => {
  it('fills global.beats and the drop cue of the section playing then', () => {
    const descriptor = twoCards();

    applyMediaChoices(descriptor, { music: { source: 'library', id: 'drop-track' } });

    expect(descriptor.global?.beats).toEqual({ bpm: 120, offset: 0.5, beatsPerBar: 4, confidence: 5.1, usable: true });
    expect((descriptor.sections?.[1] as { cues?: unknown } | undefined)?.cues).toEqual({ drop: 2.5 });
    expect(descriptor.global?.music?.name).toBe('drop-track');
  });

  it('keeps an authored grid', () => {
    const descriptor = twoCards({ bpm: 90 });

    applyMediaChoices(descriptor, { music: { source: 'library', id: 'drop-track' } });

    expect(descriptor.global?.beats).toEqual({ bpm: 90 });
  });

  it('leaves the grid out for a track the table does not have', () => {
    const descriptor = twoCards();

    applyMediaChoices(descriptor, { music: { source: 'library', id: 'unknown-track' } });

    expect(descriptor.global?.beats).toBeUndefined();
  });
});

describe('uploaded music', () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const source = { getBytes: vi.fn(async () => bytes) };

  it('is analyzed in the browser and fills the grid', async () => {
    analyzeAudioBytes.mockResolvedValue({ ...TABLE['drop-track'], bpm: 128 });
    const descriptor = twoCards({ analyze: 'music' });

    applyMediaChoices(descriptor, { music: { source: 'upload', key: 'k1', label: 'song.mp3' } });
    await analyzeMusicInBrowser(descriptor, source);

    expect(source.getBytes).toHaveBeenCalledWith('k1');
    expect(descriptor.global?.beats).toMatchObject({ bpm: 128, usable: true });
  });

  it('is not analyzed when the template already has a grid', async () => {
    const descriptor = twoCards({ bpm: 100 });

    applyMediaChoices(descriptor, { music: { source: 'upload', key: 'k1', label: 'song.mp3' } });
    await analyzeMusicInBrowser(descriptor, source);

    expect(analyzeAudioBytes).not.toHaveBeenCalled();
    expect(wantsBeatAnalysis(descriptor)).toBe(false);
  });

  it('keeps the request when decoding fails', async () => {
    failDecoding = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const descriptor = twoCards({ analyze: 'music' });

    applyMediaChoices(descriptor, { music: { source: 'upload', key: 'k1', label: 'song.mp3' } });
    await analyzeMusicInBrowser(descriptor, source);

    expect(descriptor.global?.beats).toEqual({ analyze: 'music' });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    failDecoding = false;
  });
});
