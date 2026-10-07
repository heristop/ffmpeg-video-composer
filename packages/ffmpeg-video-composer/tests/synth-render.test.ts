import { describe, expect, it } from 'vitest';
import { MAX_NOTE_SECONDS, MAX_SOUND_LENGTH, PEAK_DBFS, SYNTH_RATE } from '@/core/audio/synth/bounds';
import { renderSound, renderSoundWav, soundLength, soundUsesSeed } from '@/core/audio/synth/render';
import { noteSeconds } from '@/core/audio/synth/timing';
import type { ComposedSound } from '@/core/audio/synth/types';
import { sha256Hex } from '@/core/determinism/sha256';

// A whole sound: layers placed, panned and mixed, the whole-sound fx, the peak normalisation and the WAV.
// The golden digests pin the exact bytes: the same sound and seed must always write the same file.

const impact: ComposedSound = {
  length: 0.45,
  layers: [
    {
      source: 'noise',
      color: 'pink',
      filter: { type: 'lowpass', from: 9000, to: 600 },
      envelope: { attack: 0.01, decay: 0.35, curve: 'exp' },
      gain: 0.8,
    },
    {
      source: 'tone',
      wave: 'sine',
      pitch: { from: 180, to: 55 },
      envelope: { attack: 0.002, decay: 0.3 },
      gain: 0.6,
    },
  ],
  fx: { saturate: 0.2, room: 0.15 },
};

const roll: ComposedSound = {
  layers: [
    { source: 'strike', pitch: 220, ring: 0.08, click: 0.6, repeat: 8, every: 0.09, accelerate: 0.2, jitter: 0.3 },
    { source: 'tone', wave: 'triangle', pitch: 880, vibrato: { rate: 6, depth: 0.5 }, delay: 0.5, pan: 0.5 },
  ],
  fx: { echo: 0.3, crush: 0.2 },
};

const peakTarget = 10 ** (PEAK_DBFS / 20);

function peak(channels: Float64Array[]): number {
  return Math.max(...channels.map((channel) => channel.reduce((max, value) => Math.max(max, Math.abs(value)), 0)));
}

describe('renderSound', () => {
  it('renders the declared length at 48 kHz, peak-normalised to -3 dBFS', () => {
    const sound = renderSound(impact, 1);

    expect(sound.left).toHaveLength(Math.round(0.45 * SYNTH_RATE));
    expect(sound.right).toHaveLength(sound.left.length);
    expect(peak([sound.left, sound.right])).toBeCloseTo(peakTarget, 9);
    expect(sound.peak).toBeGreaterThan(0);
    expect(sound.duration).toBe(0.45);
  });

  it('is deterministic: same sound and seed, same bytes; another seed changes the noise', () => {
    const a = renderSoundWav(impact, 42);
    const b = renderSoundWav(structuredClone(impact), 42);
    const c = renderSoundWav(impact, 43);

    expect(sha256Hex(a)).toBe(sha256Hex(b));
    expect(sha256Hex(c)).not.toBe(sha256Hex(a));
  });

  it('matches the golden digests', () => {
    expect(sha256Hex(renderSoundWav(impact, 42))).toMatchInlineSnapshot(
      `"2962fa70024733d3e61be607f34408e0d9d60c30078dc7b624c0fa76072af656"`
    );
    expect(sha256Hex(renderSoundWav(roll, 7))).toMatchInlineSnapshot(
      `"d293384935d050b361839ef2b4d153d40dbc219026ebecc986cc387e3db7e1a2"`
    );
  });

  it('only depends on the seed when the sound draws random numbers', () => {
    const pure: ComposedSound = { layers: [{ source: 'tone', pitch: 440, envelope: { decay: 0.2 } }] };

    expect(soundUsesSeed(pure)).toBe(false);
    expect(soundUsesSeed(impact)).toBe(true);
    expect(soundUsesSeed(roll)).toBe(true);
    expect(sha256Hex(renderSoundWav(pure, 1))).toBe(sha256Hex(renderSoundWav(pure, 2)));
  });

  it('derives the length from the layers when none is given, plus the fx tail, capped at 4 s', () => {
    expect(soundLength({ layers: [{ source: 'tone', pitch: 440, envelope: { attack: 0.01, decay: 0.2 } }] })).toBe(
      0.21
    );
    expect(soundLength({ layers: [{ source: 'strike', pitch: 440, ring: 0.5, delay: 0.1 }] })).toBe(0.6);
    expect(soundLength({ layers: [{ source: 'noise', envelope: { decay: 0.2 }, repeat: 3, every: 0.1 }] })).toBe(0.405);
    expect(soundLength({ layers: [{ source: 'tone', pitch: 440, envelope: { decay: 0.2 } }], fx: { room: 1 } })).toBe(
      1.405
    );
    expect(soundLength({ layers: [{ source: 'silence', length: 9 }] })).toBe(MAX_SOUND_LENGTH);
    expect(soundLength({ length: 0.3, layers: [{ source: 'tone', pitch: 440, length: 2 }] })).toBe(0.3);
  });

  it('delays and pans a layer', () => {
    const sound = renderSound(
      { length: 0.5, layers: [{ source: 'tone', pitch: 440, delay: 0.25, pan: -1, envelope: { sustain: 1 } }] },
      1
    );
    const half = 0.25 * SYNTH_RATE;

    expect(peak([sound.left.subarray(0, half - 1), sound.right])).toBe(0);
    expect(peak([sound.left.subarray(half)])).toBeCloseTo(peakTarget, 6);
  });

  it('drives a layer into a square-ish soft clip', () => {
    const crest = (drive: number) => {
      const { left } = renderSound(
        { length: 0.2, layers: [{ source: 'tone', pitch: 110, drive, envelope: { sustain: 1 } }] },
        1
      );
      const rmsValue = Math.sqrt(left.reduce((sum, value) => sum + value * value, 0) / left.length);

      return peak([left]) / rmsValue;
    };

    expect(crest(0)).toBeGreaterThan(1.35);
    expect(crest(1)).toBeLessThan(1.15);
  });

  it('keeps a silent sound silent instead of dividing by zero', () => {
    const sound = renderSound({ length: 0.2, layers: [{ source: 'silence', length: 0.2 }] }, 1);

    expect(peak([sound.left, sound.right])).toBe(0);
    expect(sound.peak).toBe(0);
  });

  it('renders the largest bounded sound quickly and without non-finite samples', () => {
    const heavy: ComposedSound = {
      length: MAX_SOUND_LENGTH,
      layers: Array.from({ length: 8 }, (_, i) => ({
        source: 'noise' as const,
        color: 'brown' as const,
        filter: { type: 'bandpass' as const, from: 12000, to: 40, resonance: 12 },
        gain: 1,
        delay: i * 0.1,
        envelope: { sustain: 1 },
      })),
      fx: { saturate: 1, crush: 1, room: 1, echo: { mix: 1, time: 1, feedback: 0.8 } },
    };
    const started = performance.now();
    const sound = renderSound(heavy, 9);

    expect(performance.now() - started).toBeLessThan(2000);
    expect(sound.left.every(Number.isFinite)).toBe(true);
    expect(peak([sound.left, sound.right])).toBeCloseTo(peakTarget, 9);
  });

  it('keeps notes shorter than the default release audible', () => {
    const short: ComposedSound[] = [
      { layers: [{ source: 'tone', pitch: 800, length: 0.015 }] },
      { layers: [{ source: 'tone', pitch: 800, length: 0.015, repeat: 8, every: 0.03 }] },
      { layers: [{ source: 'noise', repeat: 16, every: 0.01 }] },
      {
        layers: [{ source: 'tone', pitch: 800, length: 0.05, envelope: { attack: 0.001, decay: 0.04, release: 0.1 } }],
      },
    ];

    for (const sound of short) expect(renderSound(sound, 1).peak, JSON.stringify(sound)).toBeGreaterThan(0.5);
  });

  it('counts the note-seconds a sound renders, each note cut at the end of the sound', () => {
    expect(noteSeconds({ length: 1, layers: [{ source: 'tone', pitch: 440, length: 0.2, repeat: 3 }] })).toBeCloseTo(
      0.6,
      9
    );
    expect(noteSeconds({ layers: [{ source: 'strike', pitch: 440, ring: 4, length: 4, repeat: 32 }] })).toBeCloseTo(
      32 * 4 - 0.1 * ((31 * 32) / 2),
      6
    );
    expect(noteSeconds({ layers: [{ source: 'silence', length: 4 }] })).toBe(0);
  });

  it('renders the most expensive sound within the note budget quickly', () => {
    const partials = Array.from({ length: 8 }, (_, k) => ({ ratio: k + 1, gain: 1 / (k + 1) }));
    const heaviest: ComposedSound = {
      length: MAX_SOUND_LENGTH,
      layers: Array.from({ length: 8 }, (_, i) => ({
        source: 'strike' as const,
        pitch: { from: 2000, to: 60 },
        partials,
        ring: 4,
        length: 4,
        click: 1,
        filter: [{ type: 'bandpass' as const, from: 12000, to: 40, resonance: 12 }],
        delay: i * 0.001,
      })),
      fx: { room: 1, echo: { mix: 1, time: 1, feedback: 0.8 } },
    };
    const started = performance.now();

    expect(noteSeconds(heaviest)).toBeLessThanOrEqual(MAX_NOTE_SECONDS);
    renderSound(heaviest, 3);
    expect(performance.now() - started).toBeLessThan(3000);
  });
});
