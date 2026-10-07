import { describe, expect, it } from 'vitest';
import { SYNTH_RATE } from '@/core/audio/synth/bounds';
import { analyzeChannels } from '@/core/audio/synth/analysis';
import { tone } from '@/core/audio/synth/oscillator';
import { noise } from '@/core/audio/synth/noise';
import { envelope } from '@/core/audio/synth/envelope';
import { seededRandom } from '@/core/determinism/hash';

// The numbers an author who can't hear checks a sound by: peak, RMS level, spectral centroid, the share of
// energy above 8 kHz and below 250 Hz, and the attack time.

describe('analyzeChannels', () => {
  it('measures a full-scale 1 kHz sine', () => {
    const sine = tone({ samples: SYNTH_RATE, wave: 'sine', pitch: 1000 });
    const metrics = analyzeChannels([sine, sine]);

    expect(metrics.duration).toBe(1);
    expect(metrics.peakDb).toBeCloseTo(0, 2);
    expect(metrics.rmsDb).toBeCloseTo(-3.01, 1);
    expect(Math.abs(metrics.centroidHz - 1000)).toBeLessThan(40);
    expect(metrics.highShare).toBeLessThan(0.01);
    expect(metrics.lowShare).toBeLessThan(0.01);
    expect(metrics.attackMs).toBeLessThan(5);
  });

  it('places white noise high and a 100 Hz sine low', () => {
    const white = noise(SYNTH_RATE, 'white', seededRandom(1));
    const low = tone({ samples: SYNTH_RATE, wave: 'sine', pitch: 100 });

    expect(analyzeChannels([white]).centroidHz).toBeGreaterThan(10000);
    expect(analyzeChannels([white]).highShare).toBeGreaterThan(0.6);
    expect(analyzeChannels([low]).lowShare).toBeGreaterThan(0.95);
  });

  it('times the attack: where the level first gets within 1 dB of its loudest', () => {
    const swell = tone({ samples: SYNTH_RATE, wave: 'sine', pitch: 440 });
    const gains = envelope(SYNTH_RATE, { attack: 0.2, sustain: 1, curve: 'linear' });

    for (let i = 0; i < swell.length; i++) swell[i] *= gains[i];

    expect(Math.abs(analyzeChannels([swell]).attackMs - 178)).toBeLessThan(15);
  });

  it('reports silence as -Infinity dB with a zero centroid', () => {
    const metrics = analyzeChannels([new Float64Array(4800)]);

    expect(metrics.peakDb).toBe(Number.NEGATIVE_INFINITY);
    expect(metrics.centroidHz).toBe(0);
    expect(metrics.attackMs).toBe(0);
  });
});
