// How long notes and sounds last before anything is rendered: the mix needs a sound's length to anchor a
// riser by its end, and the length decides the buffer. A note lasts its layer's `length`, else a strike's
// `ring`, else its envelope (attack + hold + decay + release), else it fills the sound. A sound lasts its
// `length`, else its longest layer plus the fx tail, within [MIN_SOUND_LENGTH, MAX_SOUND_LENGTH]. Pure.

import { DEFAULT_NOTE, DEFAULT_RING, MAX_SOUND_LENGTH, MIN_SOUND_LENGTH } from './bounds';
import { envelopeLength } from './envelope';
import { roomTail } from './room';
import { intervals } from './sequence';
import { echoSpec } from './sound-fx';
import { clamp } from './sweep';
import type { ComposedSound, Layer, SoundFx } from './types';

const ECHO_REPEATS = 3;

export function round6(value: number): number {
  return Number(value.toFixed(6));
}

/** Seconds of one note of `layer`, or null when it fills the rest of the sound. */
export function noteLength(layer: Layer): number | null {
  if (layer.length !== undefined) return layer.length;

  if (layer.source === 'silence') return null;

  if (layer.source === 'strike' && layer.envelope === undefined) return layer.ring ?? DEFAULT_RING;

  return layer.envelope ? envelopeLength(layer.envelope) : null;
}

function layerEnd(layer: Layer): number {
  const lastHit = layer.source === 'silence' ? 0 : intervals(layer).reduce((sum, interval) => sum + interval, 0);

  return (layer.delay ?? 0) + lastHit + (noteLength(layer) ?? DEFAULT_NOTE);
}

/** Seconds the fx ring past the dry sound. */
export function fxTail(fx: SoundFx | undefined): number {
  const echo = fx?.echo === undefined ? 0 : echoSpec(fx.echo);
  const echoTail = echo && echo.mix > 0 ? echo.time * ECHO_REPEATS : 0;

  return Math.max(roomTail(fx?.room ?? 0), echoTail);
}

/** The rendered length of `sound`, seconds. */
export function soundLength(sound: ComposedSound): number {
  if (sound.length !== undefined) return round6(clamp(sound.length, MIN_SOUND_LENGTH, MAX_SOUND_LENGTH));

  const dry = Math.max(0, ...sound.layers.map(layerEnd));

  return round6(clamp(dry + fxTail(sound.fx), MIN_SOUND_LENGTH, MAX_SOUND_LENGTH));
}
