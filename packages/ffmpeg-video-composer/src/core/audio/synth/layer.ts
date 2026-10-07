// One layer of a sound: each hit renders a note (source → filter → envelope → gain) and adds it into the
// stereo mix at the layer's delay plus the hit's time, panned at equal power. A layer without an envelope
// plays steady (a 5 ms attack, a 20 ms release); a strike carries its own decay. Each layer draws from its
// own seeded streams (the source's noise and the sequence's jitter), named by its index, so changing one
// layer never perturbs another's randomness. Pure.

import { fnv1a32, seededRandom } from '@/core/determinism/hash';
import { SYNTH_RATE } from './bounds';
import { envelope } from './envelope';
import { filter } from './filter';
import { noise } from './noise';
import { tone } from './oscillator';
import { onsets, type Hit } from './sequence';
import { saturate } from './sound-fx';
import { strike } from './strike';
import { noteLength } from './timing';
import type { Envelope, Layer } from './types';

export interface StereoMix {
  left: Float64Array;
  right: Float64Array;
}

type Audible = Exclude<Layer, { source: 'silence' }>;

const STEADY: Envelope = { sustain: 1, release: 0.02 };

function source(layer: Audible, samples: number, random: () => number): Float64Array {
  if (layer.source === 'noise') return noise(samples, layer.color ?? 'white', random);

  if (layer.source === 'strike') {
    return strike({
      samples,
      pitch: layer.pitch,
      ring: layer.ring,
      partials: layer.partials,
      click: layer.click,
      random,
    });
  }

  return tone({ samples, wave: layer.wave, pitch: layer.pitch, vibrato: layer.vibrato });
}

function shapeOf(layer: Audible): Envelope | null {
  if (layer.envelope) return layer.envelope;

  return layer.source === 'strike' ? null : STEADY;
}

// Samples of hit `k`: its note length, else up to the next hit, else to the end of the sound.
function hitSamples(layer: Audible, hits: readonly Hit[], k: number, room: number): number {
  const note = noteLength(layer);
  const next = hits.at(k + 1);
  const seconds = note ?? (next ? next.time - hits[k].time : Number.POSITIVE_INFINITY);

  return Math.min(room, Math.round(seconds * SYNTH_RATE));
}

function addInto(mix: StereoMix, note: Float64Array, start: number, pan: number): void {
  const angle = ((Math.max(-1, Math.min(1, pan)) + 1) * Math.PI) / 4;
  const left = Math.cos(angle);
  const right = Math.sin(angle);

  for (let i = 0; i < note.length; i++) {
    mix.left[start + i] += note[i] * left;
    mix.right[start + i] += note[i] * right;
  }
}

function renderHit(layer: Audible, samples: number, gain: number, random: () => number): Float64Array {
  const note = source(layer, samples, random);
  const shape = shapeOf(layer);

  if (layer.filter) filter(note, layer.filter);

  saturate(note, layer.drive ?? 0);

  const gains = shape ? envelope(samples, shape) : null;

  for (let i = 0; i < samples; i++) note[i] *= gain * (gains ? gains[i] : 1);

  return note;
}

/** Adds layer `index` of a sound seeded `seed` into `mix`. */
export function renderLayer(layer: Layer, index: number, seed: number, mix: StereoMix): void {
  if (layer.source === 'silence') return;

  const random = seededRandom(fnv1a32(`${seed}:layers[${index}]`));
  const hits = onsets(layer, seededRandom(fnv1a32(`${seed}:layers[${index}].jitter`)));
  const total = mix.left.length;
  const delay = layer.delay ?? 0;

  for (const [k, hit] of hits.entries()) {
    const start = Math.round((delay + hit.time) * SYNTH_RATE);
    const samples = hitSamples(layer, hits, k, total - start);

    if (samples <= 0) continue;

    addInto(mix, renderHit(layer, samples, (layer.gain ?? 1) * hit.gain, random), start, layer.pan ?? 0);
  }
}
