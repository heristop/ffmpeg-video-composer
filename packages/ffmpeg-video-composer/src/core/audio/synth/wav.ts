// A 16-bit PCM WAV writer (stereo, the synth rate), built on a DataView over a Uint8Array: no Buffer, no
// TextEncoder, so it runs unchanged on Node, in browsers and on Hermes. Samples are clamped to [-1, 1] and
// rounded half away from zero (symmetric, so a sound and its inverse write mirrored bytes). Pure.

import { SYNTH_RATE } from './bounds';

const HEADER = 44;
const CHANNELS = 2;
const BYTES_PER_SAMPLE = 2;
const FULL_SCALE = 32767;

function ascii(view: DataView, at: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.codePointAt(i) ?? 0);
}

function pcm(value: number): number {
  const clamped = Math.max(-1, Math.min(1, value));

  return Math.sign(clamped) * Math.round(Math.abs(clamped) * FULL_SCALE);
}

function writeHeader(view: DataView, dataBytes: number): void {
  ascii(view, 0, 'RIFF');
  view.setUint32(4, HEADER - 8 + dataBytes, true);
  ascii(view, 8, 'WAVE');
  ascii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, CHANNELS, true);
  view.setUint32(24, SYNTH_RATE, true);
  view.setUint32(28, SYNTH_RATE * CHANNELS * BYTES_PER_SAMPLE, true);
  view.setUint16(32, CHANNELS * BYTES_PER_SAMPLE, true);
  view.setUint16(34, BYTES_PER_SAMPLE * 8, true);
  ascii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);
}

/** The WAV file of two equally long channels. */
export function encodeWav(left: Float64Array, right: Float64Array): Uint8Array {
  const frames = Math.min(left.length, right.length);
  const dataBytes = frames * CHANNELS * BYTES_PER_SAMPLE;
  const bytes = new Uint8Array(HEADER + dataBytes);
  const view = new DataView(bytes.buffer);

  writeHeader(view, dataBytes);

  for (let i = 0; i < frames; i++) {
    view.setInt16(HEADER + i * 4, pcm(left[i]), true);
    view.setInt16(HEADER + i * 4 + 2, pcm(right[i]), true);
  }

  return bytes;
}
