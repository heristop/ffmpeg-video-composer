// Lazy chunk: decode audio with Web Audio and run the engine's platform-neutral beat analyzer on it. Only
// loaded when a template wants a measured grid for music the library table does not cover.
import { analyzeBeats, type BeatAnalysis } from 'ffmpeg-video-composer/src/core/audio/beats.ts';

const SAMPLE_RATE = 22050;

/** The channels of a decoded buffer averaged into one. */
export function downmix(buffer: AudioBuffer): Float32Array {
  const mono = new Float32Array(buffer.length);

  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);

    for (let index = 0; index < data.length; index++) mono[index] += data[index] / buffer.numberOfChannels;
  }

  return mono;
}

export async function analyzeAudioBytes(bytes: ArrayBuffer): Promise<BeatAnalysis> {
  // An OfflineAudioContext decodes straight to its own sample rate, without touching the audio output.
  const context = new OfflineAudioContext(1, 1, SAMPLE_RATE);
  const buffer = await context.decodeAudioData(bytes);

  return analyzeBeats(downmix(buffer), buffer.sampleRate);
}
