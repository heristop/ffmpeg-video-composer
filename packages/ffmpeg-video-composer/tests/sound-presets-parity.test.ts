import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SFX_IDS, SFX_LIBRARY, type SfxId } from '@/core/audio/sfx-library';
import { SOUND_PRESETS } from '@/core/audio/sound-presets';
import { renderSound } from '@/core/audio/synth/render';
import { analyzeChannels, type SoundMetrics } from '@/core/audio/synth/analysis';

// Each recipe renders close to the shipped file it stands for (decoded from the .m4a): the same length, the
// library's -3 dBFS peak, an RMS level within 3 dB and a spectral centroid within -30 % / +40 %. The lavfi
// originals use things the vocabulary approximates (ffmpeg's 2-pole bandpass and qsin/exp fade curves,
// aecho, a flanger, FM and hashed per-slice pitches), so "close" is a level and a brightness, not a
// waveform. Wider tolerances are listed with their reason.

const here = path.dirname(fileURLToPath(import.meta.url));
const sfxDir = path.resolve(here, '../../leclap-creative-kit/src/library/sfx');

const RMS_DB = 3;
const CENTROID = [0.7, 1.4] as const;

/** Presets whose file can't be matched as closely, and why. */
const LOOSER: Partial<Record<SfxId, { rmsDb: number; reason: string }>> = {
  click: { rmsDb: 6, reason: 'AAC smears the 50 ms burst: the shipped file peaks at -7.4 dB, not -3' },
};

function decoded(id: SfxId): SoundMetrics {
  const file = path.join(sfxDir, SFX_LIBRARY[id].file);
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f64le', '-ac', '2', '-ar', '48000', '-'], {
    maxBuffer: 1 << 28,
  });
  const samples = new Float64Array(raw.buffer, raw.byteOffset, raw.byteLength / 8);
  const left = samples.filter((_, i) => i % 2 === 0);
  const right = samples.filter((_, i) => i % 2 === 1);

  return analyzeChannels([left, right]);
}

describe('preset parity with the shipped files', () => {
  it.each([...SFX_IDS])('%s renders close to its file', (id) => {
    const file = decoded(id);
    const sound = renderSound(SOUND_PRESETS[id], 1);
    const recipe = analyzeChannels([sound.left, sound.right]);
    const ratio = recipe.centroidHz / file.centroidHz;

    expect(recipe.duration).toBe(SFX_LIBRARY[id].duration);
    expect(recipe.peakDb).toBeCloseTo(-3, 1);
    expect(Math.abs(recipe.rmsDb - file.rmsDb)).toBeLessThanOrEqual(LOOSER[id]?.rmsDb ?? RMS_DB);
    expect(ratio).toBeGreaterThanOrEqual(CENTROID[0]);
    expect(ratio).toBeLessThanOrEqual(CENTROID[1]);
  });
});
