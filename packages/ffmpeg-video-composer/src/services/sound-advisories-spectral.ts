// The sound advisories that need the sound itself: every rendered cue (a composed sound or a varied preset)
// is synthesized once — the same render the mix makes, milliseconds each — and measured
// (core/audio/synth/analysis.ts). Library files and unvaried presets are curated and skipped, and so is a
// sound over the render budget (MAX_NOTE_SECONDS): the schema already rejects it, and measuring it would
// cost seconds.

import { analyzeChannels } from '@/core/audio/synth/analysis';
import { MAX_NOTE_SECONDS } from '@/core/audio/synth/bounds';
import { renderSound } from '@/core/audio/synth/render';
import { noteSeconds } from '@/core/audio/synth/timing';
import type { MotionWarning } from './motion-lint';
import type { CueSound } from './sound-cues';

export const SPECTRAL_THRESHOLDS = {
  // +9 dBFS: the raw layer mix (before normalisation). The bundled four-voice tada chord peaks at +6.5 dB
  // and is fine; past +9 dB most layers sit at full gain on top of each other, so the written gains no
  // longer describe the result — the render scales everything down to -3 dBFS and the balance is luck.
  clippedPeak: 10 ** (9 / 20),
  // Over half the energy above 8 kHz: white noise measures 0.67, pink 0.14, every bundled sound but the
  // 50 ms click and the reverse cymbal under 0.2. Sustained that bright, it hisses and tires the ear.
  harshShare: 0.5,
  // Sounds this short may be bright: a click or a tick is a transient, not a texture.
  harshMinLength: 0.25,
  // Over 90 % of the energy under 250 Hz for longer than 0.8 s (the hit, boom and sub-drop recipes measure
  // 0.97-0.99): a long low tail sits exactly where the music's kick and bass live and blurs them.
  muddyShare: 0.9,
  muddyMinLength: 0.8,
};

export interface Measured {
  peak: number;
  highShare: number;
  lowShare: number;
  duration: number;
}

function measure(cue: CueSound, cache: Map<string, Measured>): Measured | null {
  const placement = cue.resolved.sound;

  if (!placement || noteSeconds(placement.spec) > MAX_NOTE_SECONDS) return null;

  const cached = cache.get(cue.resolved.file);

  if (cached) return cached;

  const rendered = renderSound(placement.spec, placement.seed);
  const metrics = analyzeChannels([rendered.left, rendered.right]);
  const measured = { peak: rendered.peak, ...metrics };

  cache.set(cue.resolved.file, measured);

  return measured;
}

function warn(path: string, code: string, message: string, hint: string): MotionWarning {
  return { path: `${path}.sound`, code, message, severity: 'warn', hint };
}

/** The spectral findings of one measured sound at `path` (`music`: whether a music bed plays under it). */
export function measuredFindings(path: string, m: Measured, music: boolean): MotionWarning[] {
  const t = SPECTRAL_THRESHOLDS;
  const out: MotionWarning[] = [];

  if (m.peak === 0) {
    return [
      warn(
        path,
        'sound_silent',
        'the sound renders silent',
        'Give a layer an audible source and a gain above 0, and start its notes inside the sound length.'
      ),
    ];
  }

  if (m.peak > t.clippedPeak) {
    const db = (20 * Math.log10(m.peak)).toFixed(1);

    out.push(
      warn(
        path,
        'sound_clipped',
        `layers sum to +${db} dBFS before normalisation`,
        'Lower the layer gains so they add up near 1; gains set the balance.'
      )
    );
  }

  if (m.highShare > t.harshShare && m.duration > t.harshMinLength) {
    out.push(
      warn(
        path,
        'sound_harsh',
        `${Math.round(m.highShare * 100)} % of the energy is above 8 kHz`,
        'Lowpass the noise (6-8 kHz), use pink noise, or shorten it.'
      )
    );
  }

  if (music && m.lowShare > t.muddyShare && m.duration > t.muddyMinLength) {
    out.push(
      warn(
        path,
        'sound_muddy',
        `${Math.round(m.lowShare * 100)} % of the energy is under 250 Hz for ${m.duration} s`,
        'Shorten the low tail, highpass it, or keep one such hit for the biggest moment.'
      )
    );
  }

  return out;
}

/** sound_silent, sound_clipped, sound_harsh and sound_muddy for every rendered cue. */
export function spectralAdvisories(cues: readonly CueSound[], music: boolean): MotionWarning[] {
  const cache = new Map<string, Measured>();

  return cues.flatMap((cue) => {
    const measured = measure(cue, cache);

    return measured ? measuredFindings(cue.path, measured, music) : [];
  });
}
