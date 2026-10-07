import { z } from 'zod';
import {
  MAX_CUTOFF,
  MAX_LAYERS,
  MAX_NOTE_SECONDS,
  MAX_PARTIALS,
  MAX_PITCH,
  MAX_REPEAT,
  MAX_RESONANCE,
  MAX_SOUND_LENGTH,
  MIN_CUTOFF,
  MIN_PITCH,
  MIN_RESONANCE,
  MIN_SOUND_LENGTH,
} from '../core/audio/synth/bounds';
import { SFX_IDS } from '../core/audio/sfx-library';
import { noteSeconds } from '../core/audio/synth/timing';
import type { Layer, SoundFx } from '../core/audio/synth/types';

// ── composed sounds: the vocabulary of `sfx[].sound` ──────────────────────────────────────────────────
//
// Shapes and bounds only; the synth (core/audio/synth) renders them and the mix (editor/utils/sfx-sound.ts)
// places the WAV. Descriptions stay terse: agents read them through get_template_schema.

const unit = z.number().min(0).max(1);
const seconds = z.number().min(0).max(MAX_SOUND_LENGTH);
const curve = z.enum(['linear', 'exp']);
const hz = z.number().min(MIN_PITCH).max(MAX_PITCH);

const PitchSchema = z
  .union([hz, z.object({ from: hz, to: hz, curve: curve.optional(), time: seconds.optional() }).strict()])
  .describe('Hz, or a sweep {from,to} over each note (exp by default), or over `time` s then held.')
  .meta({ id: 'SoundPitch' });

const EnvelopeSchema = z
  .object({
    attack: seconds.optional(),
    hold: seconds.optional(),
    decay: seconds.optional(),
    sustain: unit.optional(),
    release: seconds.optional(),
    curve: curve.optional(),
  })
  .strict()
  .describe(
    'Seconds; attack (default 0.005) to 1, hold, decay to sustain (default 0; no decay = the whole note), ' +
      'release at the note end. curve: exp (default; the attack swells, decays fall fast) or linear.'
  )
  .meta({ id: 'SoundEnvelope' });

const cutoff = z.number().min(MIN_CUTOFF).max(MAX_CUTOFF);

const FilterSchema = z
  .object({
    type: z.enum(['lowpass', 'highpass', 'bandpass']),
    cutoff: cutoff.optional(),
    from: cutoff.optional(),
    to: cutoff.optional(),
    curve: curve.optional(),
    time: seconds.optional(),
    resonance: z.number().min(MIN_RESONANCE).max(MAX_RESONANCE).optional(),
  })
  .strict()
  .superRefine((spec, ctx) => {
    const fixed = spec.cutoff !== undefined;
    const swept = spec.from !== undefined || spec.to !== undefined;

    if (fixed === swept) ctx.addIssue({ code: 'custom', message: 'give cutoff, or from and to (a sweep)' });

    if (swept && (spec.from === undefined || spec.to === undefined)) {
      ctx.addIssue({ code: 'custom', message: 'a sweep needs both from and to' });
    }
  })
  .describe('Hz: cutoff, or from→to over each note. resonance = Q (default 0.707).')
  .meta({ id: 'SoundFilter' });

type LayerSource = 'tone' | 'noise' | 'strike' | 'silence';

// Fields only some sources take (one flat layer object keeps the schema small for the generation prompt).
const SOURCE_FIELDS: Partial<Record<string, readonly LayerSource[]>> = {
  pitch: ['tone', 'strike'],
  wave: ['tone'],
  vibrato: ['tone'],
  color: ['noise'],
  ring: ['strike'],
  partials: ['strike'],
  click: ['strike'],
};
const SILENCE_FIELDS = new Set(['source', 'length', 'delay']);

function layerIssues(layer: Record<string, unknown> & { source: LayerSource }): string[] {
  const present = Object.keys(layer).filter((key) => layer[key] !== undefined);
  const misplaced = present.filter((key) => SOURCE_FIELDS[key]?.includes(layer.source) === false);
  const issues = misplaced.map((key) => `${key} is not a ${layer.source} field`);

  if ((layer.source === 'tone' || layer.source === 'strike') && layer.pitch === undefined) issues.push('needs pitch');

  if (layer.source !== 'silence') return issues;

  const extra = present.filter((key) => !SILENCE_FIELDS.has(key) && !misplaced.includes(key));

  return [
    ...issues,
    ...extra.map((key) => `${key} is not a silence field`),
    ...(layer.length === undefined ? ['needs length'] : []),
  ];
}

export const SoundLayerSchema = z
  .object({
    source: z.enum(['tone', 'noise', 'strike', 'silence']),
    pitch: PitchSchema.optional(),
    wave: z.enum(['sine', 'triangle', 'square', 'saw']).optional().describe('tone'),
    vibrato: z
      .object({ rate: z.number().min(0.1).max(20), depth: z.number().min(0).max(2).describe('Semitones.') })
      .strict()
      .optional()
      .describe('tone'),
    color: z.enum(['white', 'pink', 'brown']).optional().describe('noise'),
    ring: z.number().min(0.01).max(MAX_SOUND_LENGTH).optional().describe('strike: seconds to fall 60 dB (0.6).'),
    partials: z
      .array(z.object({ ratio: z.number().min(0.25).max(16), gain: unit }).strict())
      .min(1)
      .max(MAX_PARTIALS)
      .optional()
      .describe('strike overtones, ratio × pitch (default 1, 2, 3).'),
    click: unit.optional().describe('strike: noise transient.'),
    gain: unit.optional(),
    delay: seconds.optional().describe('Seconds before the layer.'),
    pan: z.number().min(-1).max(1).optional(),
    envelope: EnvelopeSchema.optional(),
    filter: z
      .union([FilterSchema, z.array(FilterSchema).min(1).max(3)])
      .optional()
      .describe('One filter or a chain (e.g. highpass then lowpass).'),
    drive: unit.optional().describe('Per-layer soft clip (square-ish, 808).'),
    length: z.number().min(0.005).max(MAX_SOUND_LENGTH).optional().describe('Seconds per note.'),
    repeat: z.number().int().min(1).max(MAX_REPEAT).optional().describe('Hits (rolls, ticks).'),
    every: z.number().min(0.01).max(2).optional().describe('Seconds between hits (0.1).'),
    accelerate: z.number().min(-1).max(0.9).optional().describe('Each gap ×(1-accelerate).'),
    jitter: unit.optional().describe('Seeded hit timing/level variation.'),
  })
  .strict()
  .superRefine((layer, ctx) => {
    for (const message of layerIssues(layer)) ctx.addIssue({ code: 'custom', message });
  })
  .describe('tone and strike need pitch; silence takes only length and delay.');

const SoundFxSchema = z
  .object({
    saturate: unit.optional(),
    crush: unit.optional(),
    room: unit.optional(),
    echo: unit.optional(),
  })
  .strict()
  .describe('Whole-sound fx, 0..1: soft clip, bit crush, small reverb, echo (mix; 0.18 s, feedback 0.35).');

const PRESET_ONLY = ['pitch', 'brightness', 'room'] as const;

// Render cost grows with the note-seconds. Presets stay within the budget at any variation (checked
// by tests/sound-presets.test.ts), so only composed layers are measured.
function costIssue(sound: { layers: unknown[]; length?: number; fx?: SoundFx }): string | null {
  const seconds = noteSeconds({ layers: sound.layers as Layer[], length: sound.length, fx: sound.fx });

  if (seconds <= MAX_NOTE_SECONDS) return null;

  return (
    `the notes add up to ${Math.round(seconds)} s of audio to render (every hit's note, cut at the end of the ` +
    `sound); the limit is ${MAX_NOTE_SECONDS} s: use shorter notes or fewer repeats`
  );
}

export const SoundSchema = z
  .object({
    preset: z
      .enum(SFX_IDS)
      .optional()
      .describe('Start from a library sound; vary it with pitch/length/brightness/room.'),
    pitch: z.number().min(0.25).max(4).optional().describe('Preset only: pitch ratio.'),
    brightness: z.number().min(-1).max(1).optional().describe('Preset only: filter tilt.'),
    room: unit.optional().describe('Preset only: added reverb.'),
    layers: z.array(SoundLayerSchema).min(1).max(MAX_LAYERS).optional(),
    length: z
      .number()
      .min(MIN_SOUND_LENGTH)
      .max(MAX_SOUND_LENGTH)
      .optional()
      .describe('Seconds (default: the layers plus the fx tail).'),
    anchor: z.enum(['start', 'end']).optional().describe('Edge that lands on `at` (end = a riser). Default start.'),
    fx: SoundFxSchema.optional(),
  })
  .strict()
  .superRefine((sound, ctx) => {
    const preset = sound.preset !== undefined;

    if (preset === (sound.layers !== undefined)) ctx.addIssue({ code: 'custom', message: 'give preset or layers' });

    if (preset && sound.fx !== undefined) ctx.addIssue({ code: 'custom', message: 'fx needs layers', path: ['fx'] });

    const stray = preset ? [] : PRESET_ONLY.filter((key) => sound[key] !== undefined);

    for (const key of stray) ctx.addIssue({ code: 'custom', message: `${key} needs a preset`, path: [key] });

    const cost = sound.layers && !preset ? costIssue({ ...sound, layers: sound.layers }) : null;

    if (cost) ctx.addIssue({ code: 'custom', message: cost, path: ['layers'] });
  })
  .describe(
    'A synthesized sound: layers of tone/noise/strike/silence, each shaped (envelope, filter, gain, pan, ' +
      'delay, repeat), mixed, fx applied, peak-normalised to -3 dBFS. Or a preset varied. Max 4 s, 8 layers, ' +
      '32 s of notes in all.'
  )
  .meta({ id: 'Sound' });

export type SoundInput = z.infer<typeof SoundSchema>;
