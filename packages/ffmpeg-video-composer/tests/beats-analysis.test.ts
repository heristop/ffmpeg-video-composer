import { describe, expect, it } from 'vitest';
import { analyzeBeats, detectOnsets, MIN_CONFIDENCE } from '@/core/audio/beats';
import { createFft } from '@/core/audio/fft';
import { adaptiveThreshold, medianMad } from '@/core/audio/onset';

// The analyzer on synthetic signals whose truth is known: click tracks at a set tempo and phase, accents
// that make one octave or one bar position win, noise, a calm pad with no pulse, and a loudness ramp
// with a drop. Every signal is generated here, deterministically (a fixed-seed LCG for the noise).

const SR = 22050;

function noiseSource(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;

    return (state / 2 ** 32) * 2 - 1;
  };
}

interface ClickTrack {
  bpm: number;
  seconds: number;
  offset?: number;
  accent?: (beat: number) => number;
  noise?: number;
}

function clickTrack({ bpm, seconds, offset = 0, accent = () => 0.8, noise = 0 }: ClickTrack): Float32Array {
  const out = new Float32Array(Math.round(SR * seconds));
  const random = noiseSource(7);

  for (let beat = 0; offset + (beat * 60) / bpm < seconds; beat++) {
    const start = Math.round((offset + (beat * 60) / bpm) * SR);
    const gain = accent(beat);

    for (let k = 0; k < 0.03 * SR && start + k < out.length; k++) {
      out[start + k] += gain * Math.exp(-k / (0.005 * SR)) * Math.sin((2 * Math.PI * 1000 * k) / SR);
    }
  }

  if (noise === 0) return out;

  return out.map((value) => value + noise * random());
}

function mix(a: Float32Array, b: Float32Array): Float32Array {
  return a.map((value, index) => value + (b[index] ?? 0));
}

describe('beat analysis — tempo and phase', () => {
  it.each([
    { bpm: 120, offset: 0 },
    { bpm: 128, offset: 0.37 },
    { bpm: 90, offset: 0.2 },
  ])('finds $bpm BPM with beat 1 at $offset s', ({ bpm, offset }) => {
    const analysis = analyzeBeats(clickTrack({ bpm, seconds: 30, offset }), SR);

    expect(analysis.bpm).toBeCloseTo(bpm, 0);
    expect(Math.abs(analysis.bpm - bpm)).toBeLessThan(0.3);
    expect(Math.abs(analysis.offset - offset)).toBeLessThan(0.015);
    expect(analysis.usable).toBe(true);
    expect(analysis.confidence).toBeGreaterThanOrEqual(MIN_CONFIDENCE);
    expect(analysis.beatsPerBar).toBe(4);
    // Tracked beats sit on the clicks, every one of them, in order.
    for (const [index, time] of analysis.times.entries()) {
      expect(Math.abs(time - (offset + (index * 60) / bpm))).toBeLessThan(0.015);
    }
    expect(analysis.times.length).toBeGreaterThan((30 - offset) / (60 / bpm) - 2);
  });

  it('places beat 1 on the accented bar position (the downbeat)', () => {
    // Beats 2, 6, 10… (0-based) are loud: the bar starts on the third click.
    const analysis = analyzeBeats(
      clickTrack({ bpm: 100, seconds: 30, offset: 0.1, accent: (beat) => (beat % 4 === 2 ? 1 : 0.4) }),
      SR
    );

    expect(analysis.bpm).toBeCloseTo(100, 0);
    expect(Math.abs(analysis.offset - (0.1 + 2 * 0.6))).toBeLessThan(0.015);
    expect(Math.abs((analysis.times.at(0) ?? 0) - analysis.offset)).toBeLessThan(0.01);
  });

  it('honours another bar length', () => {
    const analysis = analyzeBeats(
      clickTrack({ bpm: 120, seconds: 20, offset: 0.25, accent: (beat) => (beat % 3 === 1 ? 1 : 0.35) }),
      SR,
      { beatsPerBar: 3 }
    );

    expect(analysis.beatsPerBar).toBe(3);
    expect(Math.abs(analysis.offset - 0.75)).toBeLessThan(0.015);
  });

  it('reports onsets on the clicks', () => {
    const onsets = detectOnsets(clickTrack({ bpm: 120, seconds: 3, offset: 0.25 }), SR);

    expect(onsets).toHaveLength(6);
    for (const [index, time] of onsets.entries()) expect(Math.abs(time - (0.25 + index * 0.5))).toBeLessThan(0.012);
  });
});

describe('beat analysis — half / double tempo', () => {
  it('keeps a slow pulse with nothing between the beats (70 BPM stays 70)', () => {
    expect(analyzeBeats(clickTrack({ bpm: 70, seconds: 30, offset: 0.1 }), SR).bpm).toBeCloseTo(70, 0);
  });

  it('counts kicks, not the off-beat hats between them (100, not 200)', () => {
    const kicks = clickTrack({ bpm: 100, seconds: 30, offset: 0.2, accent: () => 0.9 });
    const hats = clickTrack({ bpm: 100, seconds: 30, offset: 0.5, accent: () => 0.25 });
    const analysis = analyzeBeats(mix(kicks, hats), SR);

    expect(analysis.bpm).toBeCloseTo(100, 0);
    expect(Math.abs(analysis.offset - 0.2)).toBeLessThan(0.015);
  });

  it('lifts a strong-weak pulse into the 80–160 band (150, not 75)', () => {
    const analysis = analyzeBeats(
      clickTrack({ bpm: 150, seconds: 30, offset: 0.1, accent: (beat) => (beat % 2 ? 0.3 : 0.9) }),
      SR
    );

    expect(analysis.bpm).toBeCloseTo(150, 0);
  });

  it('reads an even pulse above 160 BPM at half time (174 reads as 87)', () => {
    const analysis = analyzeBeats(clickTrack({ bpm: 174, seconds: 30, offset: 0.05 }), SR);

    expect(analysis.bpm).toBeCloseTo(87, 0);
    expect(Math.abs(analysis.offset - 0.05)).toBeLessThan(0.015);
  });
});

describe('beat analysis — robustness and confidence', () => {
  it('keeps the tempo and phase under steady noise', () => {
    const analysis = analyzeBeats(clickTrack({ bpm: 110, seconds: 30, offset: 0.1, noise: 0.2 }), SR);

    expect(analysis.bpm).toBeCloseTo(110, 0);
    expect(Math.abs(analysis.offset - 0.1)).toBeLessThan(0.015);
    expect(analysis.usable).toBe(true);
  });

  it('marks a calm pad (no pulse) as not usable', () => {
    const pad = new Float32Array(SR * 30).map((_, index) => {
      const t = index / SR;
      const swell = 1 + 0.3 * Math.sin(2 * Math.PI * 0.1 * t);

      return (
        0.2 *
        swell *
        (Math.sin(2 * Math.PI * 220 * t) +
          0.5 * Math.sin(2 * Math.PI * 277 * t) +
          0.4 * Math.sin(2 * Math.PI * 330 * t))
      );
    });
    const analysis = analyzeBeats(pad, SR);

    expect(analysis.usable).toBe(false);
    expect(analysis.confidence).toBeLessThan(MIN_CONFIDENCE);
  });

  it('marks white noise as not usable', () => {
    const random = noiseSource(11);
    const analysis = analyzeBeats(
      new Float32Array(SR * 20).map(() => 0.3 * random()),
      SR
    );

    expect(analysis.usable).toBe(false);
  });

  it('returns an empty, unusable grid for silence', () => {
    const analysis = analyzeBeats(new Float32Array(SR * 5), SR);

    expect(analysis).toMatchObject({ times: [], usable: false, confidence: 0 });
    expect(analysis.cues.drop).toBeUndefined();
  });

  it('is deterministic', () => {
    const track = clickTrack({ bpm: 128, seconds: 20, offset: 0.3, noise: 0.05 });

    expect(analyzeBeats(track, SR)).toEqual(analyzeBeats(track.slice(), SR));
  });

  it('works at another sample rate', () => {
    const rate = 44100;
    const track = new Float32Array(rate * 15);

    for (let beat = 0; beat * 0.5 + 0.2 < 15; beat++) {
      const start = Math.round((beat * 0.5 + 0.2) * rate);

      for (let k = 0; k < 0.03 * rate; k++) track[start + k] = Math.exp(-k / (0.005 * rate)) * Math.sin(k);
    }

    const analysis = analyzeBeats(track, rate);

    expect(analysis.bpm).toBeCloseTo(120, 0);
    expect(Math.abs(analysis.offset - 0.2)).toBeLessThan(0.015);
  });
});

describe('beat analysis — cues', () => {
  // Noise at -30 dB for 10 s, a ramp to -15 dB until 18 s (the build), -3 dB until 28 s (the drop), then
  // near-silence: the music ends at 28 s.
  function rampDb(t: number): number {
    if (t < 10) return -30;

    if (t < 18) return -30 + ((t - 10) * 15) / 8;

    return t < 28 ? -3 : -80;
  }

  function rampTrack(): Float32Array {
    const random = noiseSource(3);

    return new Float32Array(SR * 30).map((_, index) => 10 ** (rampDb(index / SR) / 20) * random());
  }

  it('finds the build, the drop and the end of an energy ramp', () => {
    const { cues } = analyzeBeats(rampTrack(), SR);

    expect(Math.abs((cues.drop ?? 0) - 18)).toBeLessThan(0.3);
    expect(Math.abs((cues.build ?? 0) - 10)).toBeLessThan(1);
    expect(Math.abs(cues.end - 28)).toBeLessThan(0.3);
  });

  it('finds no drop in a track of steady loudness', () => {
    const { cues } = analyzeBeats(clickTrack({ bpm: 120, seconds: 20, offset: 0.1 }), SR);

    expect(cues.drop).toBeUndefined();
    expect(cues.build).toBeUndefined();
  });

  it('snaps the drop to the nearest beat when the grid is usable', () => {
    const quiet = clickTrack({ bpm: 120, seconds: 30, offset: 0, accent: (beat) => (beat < 32 ? 0.05 : 0.9) });
    const analysis = analyzeBeats(quiet, SR);

    expect(analysis.usable).toBe(true);
    expect(analysis.times).toContain(analysis.cues.drop);
    expect(Math.abs((analysis.cues.drop ?? 0) - 16)).toBeLessThan(0.3);
  });
});

describe('beat analysis — building blocks', () => {
  it('computes FFT magnitudes of a pure tone', () => {
    const fft = createFft(64);
    const frame = new Float64Array(64).map((_, index) => Math.cos((2 * Math.PI * 8 * index) / 64));
    const out = new Float64Array(33);

    fft.magnitudes(frame, out);

    expect(out[8]).toBeCloseTo(32, 6);
    expect(out[3]).toBeCloseTo(0, 6);
    expect(() => createFft(100)).toThrow(/power of two/);
  });

  it('thresholds at median + k·MAD', () => {
    expect(medianMad([1, 2, 3, 4, 100])).toEqual({ median: 3, mad: 1 });

    const values = new Float64Array(200).fill(1);

    values[100] = 50;
    expect(adaptiveThreshold(values, 100, 2)[100]).toBe(1);
  });
});
