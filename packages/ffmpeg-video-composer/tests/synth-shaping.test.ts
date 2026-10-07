import { describe, expect, it } from 'vitest';
import { SYNTH_RATE, PEAK_DBFS } from '@/core/audio/synth/bounds';
import { envelope } from '@/core/audio/synth/envelope';
import { filter } from '@/core/audio/synth/filter';
import { tone } from '@/core/audio/synth/oscillator';
import { onsets } from '@/core/audio/synth/sequence';
import { crush, echo, saturate } from '@/core/audio/synth/sound-fx';
import { room } from '@/core/audio/synth/room';
import { normalizePeak, peakOf } from '@/core/audio/synth/normalize';
import { encodeWav } from '@/core/audio/synth/wav';
import { seededRandom } from '@/core/determinism/hash';

function rms(buffer: Float64Array, from = 0, to = buffer.length): number {
  let sum = 0;

  for (let i = from; i < to; i++) sum += buffer[i] * buffer[i];

  return Math.sqrt(sum / (to - from));
}

function argmax(buffer: Float64Array): number {
  let best = 0;

  for (let i = 0; i < buffer.length; i++) if (buffer[i] > buffer[best]) best = i;

  return best;
}

const ms = SYNTH_RATE / 1000;

describe('synth envelope', () => {
  it('peaks at attack + hold and falls to zero at the end of the decay', () => {
    const gains = envelope(SYNTH_RATE, { attack: 0.05, hold: 0.1, decay: 0.3 });

    expect(gains[0]).toBe(0);
    expect(Math.abs(argmax(gains) - 50 * ms)).toBeLessThanOrEqual(1);
    expect(gains[Math.round(140 * ms)]).toBe(1);
    expect(gains[Math.round(450 * ms)]).toBeLessThan(0.01);
    expect(Math.max(...gains.subarray(Math.round(460 * ms)))).toBe(0);
  });

  it('holds a sustain level and releases it at the end of the note', () => {
    const gains = envelope(SYNTH_RATE / 2, { attack: 0.01, decay: 0.05, sustain: 0.5, release: 0.1, curve: 'linear' });

    expect(gains[Math.round(200 * ms)]).toBeCloseTo(0.5, 6);
    expect(gains[Math.round(450 * ms)]).toBeCloseTo(0.25, 1);
    expect(gains.at(-1)).toBeLessThan(0.01);
  });

  it('decays faster early with the exponential curve than the linear one', () => {
    const exp = envelope(SYNTH_RATE, { attack: 0, decay: 1, curve: 'exp' });
    const linear = envelope(SYNTH_RATE, { attack: 0, decay: 1, curve: 'linear' });

    expect(exp[SYNTH_RATE / 4]).toBeLessThan(linear[SYNTH_RATE / 4] / 2);
  });

  it('fits the attack and release into a note shorter than both, releasing from the level reached', () => {
    const steady = envelope(Math.round(0.015 * SYNTH_RATE), { sustain: 1, release: 0.02 });
    const struck = envelope(Math.round(0.05 * SYNTH_RATE), { attack: 0.001, decay: 0.04, release: 0.1 });

    expect(Math.max(...steady)).toBeGreaterThan(0.9);
    expect(steady.at(-1)).toBeLessThan(0.05);
    expect(Math.max(...struck)).toBeGreaterThan(0.9);
    expect(struck.at(-1)).toBeLessThan(0.05);
  });

  it('keeps a release that fits the note as it was', () => {
    const fits = envelope(SYNTH_RATE / 2, { attack: 0.1, sustain: 0.5, release: 0.4, curve: 'linear' });

    expect(fits[Math.round(100 * ms)]).toBeCloseTo(0.5, 6);
    expect(fits[Math.round(300 * ms)]).toBeCloseTo(0.25, 2);
  });

  it('decays across the whole note when no decay is given', () => {
    const gains = envelope(SYNTH_RATE, { attack: 0.01, curve: 'linear' });

    expect(gains[SYNTH_RATE / 2]).toBeGreaterThan(0.4);
    expect(gains[SYNTH_RATE - 1]).toBeLessThan(0.01);
  });
});

describe('synth filter', () => {
  it('a lowpass at 1 kHz passes 200 Hz and attenuates 8 kHz by more than 30 dB', () => {
    const low = filter(tone({ samples: SYNTH_RATE / 2, wave: 'sine', pitch: 200 }), { type: 'lowpass', cutoff: 1000 });
    const high = filter(tone({ samples: SYNTH_RATE / 2, wave: 'sine', pitch: 8000 }), {
      type: 'lowpass',
      cutoff: 1000,
    });
    const settled = SYNTH_RATE / 10;

    expect(rms(low, settled)).toBeGreaterThan(0.65);
    expect(20 * Math.log10(rms(high, settled) / Math.SQRT1_2)).toBeLessThan(-30);
  });

  it('a highpass does the opposite and a bandpass keeps only its band', () => {
    const at = (pitch: number, spec: Parameters<typeof filter>[1]) =>
      rms(filter(tone({ samples: SYNTH_RATE / 2, wave: 'sine', pitch }), spec), SYNTH_RATE / 10);

    expect(at(100, { type: 'highpass', cutoff: 2000 })).toBeLessThan(0.01);
    expect(at(8000, { type: 'highpass', cutoff: 2000 })).toBeGreaterThan(0.65);
    expect(at(1000, { type: 'bandpass', cutoff: 1000 })).toBeGreaterThan(0.3);
    expect(at(100, { type: 'bandpass', cutoff: 1000 })).toBeLessThan(0.02);
    expect(at(10000, { type: 'bandpass', cutoff: 1000 })).toBeLessThan(0.02);
  });

  it('sweeps the cutoff: a closing lowpass darkens a steady tone over time', () => {
    const swept = filter(tone({ samples: SYNTH_RATE, wave: 'sine', pitch: 3000 }), {
      type: 'lowpass',
      from: 12000,
      to: 300,
    });

    expect(rms(swept, 0.05 * SYNTH_RATE, 0.15 * SYNTH_RATE)).toBeGreaterThan(0.6);
    expect(rms(swept, 0.9 * SYNTH_RATE)).toBeLessThan(0.05);
  });

  it('stays bounded at the highest resonance', () => {
    const resonant = filter(tone({ samples: SYNTH_RATE / 2, wave: 'saw', pitch: 110 }), {
      type: 'lowpass',
      cutoff: 880,
      resonance: 12,
    });

    expect(Number.isFinite(peakOf([resonant]))).toBe(true);
    expect(peakOf([resonant])).toBeLessThan(20);
  });
});

describe('synth sequence', () => {
  it('repeats every `every` seconds and speeds up with `accelerate`', () => {
    expect(onsets({ repeat: 3, every: 0.1 }, seededRandom(1))).toEqual([
      { time: 0, gain: 1 },
      { time: 0.1, gain: 1 },
      { time: 0.2, gain: 1 },
    ]);

    const rolled = onsets({ repeat: 4, every: 0.2, accelerate: 0.5 }, seededRandom(1)).map((hit) => hit.time);

    expect(rolled).toEqual([0, 0.2, 0.3, 0.35]);
  });

  it('jitters times and gains by the seed, never before zero', () => {
    const a = onsets({ repeat: 8, every: 0.1, jitter: 0.5 }, seededRandom(4));
    const b = onsets({ repeat: 8, every: 0.1, jitter: 0.5 }, seededRandom(4));

    expect(a).toEqual(b);
    expect(a.some((hit, i) => Math.abs(hit.time - i * 0.1) > 1e-6)).toBe(true);
    expect(a.every((hit) => hit.time >= 0 && hit.gain <= 1 && hit.gain >= 0.7)).toBe(true);
  });

  it('keeps jittered hits in order, even on an accelerating or slowing roll', () => {
    for (const spec of [
      { repeat: 16, every: 0.1, accelerate: 0.3, jitter: 1 },
      { repeat: 32, every: 0.05, accelerate: 0.3, jitter: 1 },
      { repeat: 16, every: 0.01, accelerate: -1, jitter: 1 },
      { repeat: 32, every: 0.1, jitter: 1 },
    ]) {
      for (let seed = 0; seed < 500; seed++) {
        const times = onsets(spec, seededRandom(seed)).map((hit) => hit.time);

        expect(times.length).toBe(spec.repeat);
        expect(
          times.every((time, i) => i === 0 || time > times[i - 1]),
          `${JSON.stringify(spec)} seed ${seed}`
        ).toBe(true);
      }
    }
  });

  it('is a single hit at 0 without repeat', () => {
    expect(onsets({}, seededRandom(1))).toEqual([{ time: 0, gain: 1 }]);
  });
});

describe('synth whole-sound fx', () => {
  it('saturate soft-clips: louder body, same peak ceiling', () => {
    const sine = tone({ samples: 4800, wave: 'sine', pitch: 200 });
    const driven = saturate(Float64Array.from(sine), 1);

    expect(peakOf([driven])).toBeLessThanOrEqual(1);
    expect(rms(driven)).toBeGreaterThan(rms(sine) * 1.15);
    expect(saturate(Float64Array.from(sine), 0)).toEqual(sine);
  });

  it('crush quantises the signal to fewer levels', () => {
    const sine = tone({ samples: 4800, wave: 'sine', pitch: 200 });
    const crushed = crush(Float64Array.from(sine), 1);

    expect(new Set(crushed).size).toBeLessThan(40);
    expect(crush(Float64Array.from(sine), 0)).toEqual(sine);
  });

  it('echo repeats an impulse after its time, quieter by the feedback', () => {
    const impulse = new Float64Array(SYNTH_RATE);

    impulse[0] = 1;
    const out = echo(impulse, { mix: 0.5, time: 0.1, feedback: 0.5 });

    expect(out[0]).toBe(1);
    expect(out[Math.round(0.1 * SYNTH_RATE)]).toBeCloseTo(0.5, 6);
    expect(out[Math.round(0.2 * SYNTH_RATE)]).toBeCloseTo(0.25, 6);
  });

  it('room adds a decaying, decorrelated tail after the dry sound', () => {
    const left = new Float64Array(SYNTH_RATE);
    const right = new Float64Array(SYNTH_RATE);

    left[0] = 1;
    right[0] = 1;
    room(left, right, 0.6);

    const early = rms(left, 0.05 * SYNTH_RATE, 0.15 * SYNTH_RATE);
    const late = rms(left, 0.8 * SYNTH_RATE);

    expect(early).toBeGreaterThan(0);
    expect(late).toBeLessThan(early);
    expect(left).not.toEqual(right);
  });
});

describe('synth normalise and WAV', () => {
  it('scales the loudest sample to -3 dBFS and reports the peak before', () => {
    const left = Float64Array.from([0, 2, -4, 1]);
    const right = Float64Array.from([0, 1, 1, 1]);
    const before = normalizePeak([left, right], PEAK_DBFS);

    expect(before).toBe(4);
    expect(peakOf([left, right])).toBeCloseTo(10 ** (-3 / 20), 9);
    expect(normalizePeak([new Float64Array(4)], PEAK_DBFS)).toBe(0);
  });

  it('writes a 16-bit stereo 48 kHz PCM WAV', () => {
    const left = Float64Array.from([0, 0.5, -1, 1]);
    const right = Float64Array.from([0, -0.5, 1, -1]);
    const bytes = encodeWav(left, right);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const text = (at: number) => String.fromCodePoint(...bytes.subarray(at, at + 4));

    expect(text(0)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(bytes.length - 8);
    expect(text(8)).toBe('WAVE');
    expect(text(12)).toBe('fmt ');
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(48000);
    expect(view.getUint32(28, true)).toBe(48000 * 4);
    expect(view.getUint16(32, true)).toBe(4);
    expect(view.getUint16(34, true)).toBe(16);
    expect(text(36)).toBe('data');
    expect(view.getUint32(40, true)).toBe(16);
    expect(bytes.length).toBe(44 + 16);
    expect([1, 2, 3, 4, 5, 6, 7].map((k) => view.getInt16(44 + k * 2, true))).toEqual([
      0, 16384, -16384, -32767, 32767, 32767, -32767,
    ]);
  });
});

describe('synth vocabulary extensions', () => {
  it('chains several filters on one layer (a highpass then a lowpass make a wide band)', () => {
    const at = (pitch: number) =>
      rms(
        filter(tone({ samples: SYNTH_RATE / 2, wave: 'sine', pitch }), [
          { type: 'highpass', cutoff: 300 },
          { type: 'lowpass', cutoff: 5000 },
        ]),
        SYNTH_RATE / 10
      );

    expect(at(1500)).toBeGreaterThan(0.65);
    expect(at(60)).toBeLessThan(0.05);
    expect(at(16000)).toBeLessThan(0.1);
  });

  it('the exponential curve also bends the attack into a swell', () => {
    const exp = envelope(SYNTH_RATE, { attack: 1, sustain: 1, curve: 'exp' });
    const linear = envelope(SYNTH_RATE, { attack: 1, sustain: 1, curve: 'linear' });

    expect(exp[SYNTH_RATE / 2]).toBeLessThan(0.1);
    expect(linear[SYNTH_RATE / 2]).toBeCloseTo(0.5, 3);
    expect(exp[SYNTH_RATE - 1]).toBeCloseTo(1, 3);
  });
});
