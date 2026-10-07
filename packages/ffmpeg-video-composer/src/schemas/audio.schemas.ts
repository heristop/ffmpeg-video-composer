import { z } from 'zod';
import { EasingSpecSchema } from './motion.schemas';
import { timeValue } from './time.schemas';
import { SFX_IDS } from '../core/audio/sfx-library';
import { VOICE_PRESETS } from '../core/audio/voice-presets';
import { SoundSchema } from './sound.schemas';

// ── audio polish: voice presets, volume automation and sound effects ─────────────
//
// Shapes only; lowering lives in core/audio (voice-presets, automation, sfx-library) and the mix in
// editor/utils/sfx-mix.ts. Every "when" here takes seconds or a time reference, resolved before lowering.

export const VoicePresetSchema = z
  .enum(VOICE_PRESETS)
  .describe(
    'Voice clean-up for recorded speech, applied before audioEffect and fades. clean: highpass 80 Hz, light ' +
      'denoise, -3 dB at 250 Hz, +3 dB presence at 3 kHz, gentle 2.5:1 compression, -1 dB limiter. broadcast: ' +
      'the same with stronger presence and 4:1 compression (radio voice). warm: low-mid lift, softened highs. ' +
      'rumble-cut: highpass 100 Hz only (wind, handling, traffic). room-gate: closes between phrases to cut ' +
      'room tone. Stages the engine build lacks are skipped.'
  );

const VolumeSchema = z.number().min(0).max(4);

const AutomationKeySchema = z
  .object({
    at: timeValue(z.number().min(0)).describe('When the volume reaches this key: seconds or a time reference.'),
    volume: VolumeSchema.describe('Gain multiplier at this key: 1 = unchanged, 0 = silent, 2 = +6 dB (max 4).'),
    ease: EasingSpecSchema.optional().describe('Curve from the previous key into this one (default linear).'),
  })
  .strict();

export const AutomationSchema = z
  .array(AutomationKeySchema)
  .min(1)
  .max(64)
  .describe(
    'Volume automation keys. Each key eases from the previous one; the first volume holds before the first ' +
      'key and the last after the last. Lowered to volume=eval=frame with a piecewise expression in t.'
  );

export const SfxIdSchema = z
  .enum(SFX_IDS)
  .describe('A sound from the bundled library (motionCatalog().audio.sfx lists when to use each one).');

export const SfxCueSchema = z
  .object({
    id: SfxIdSchema.optional(),
    sound: SoundSchema.optional(),
    at: timeValue(z.number().min(0)).describe(
      'When the sound lands: seconds or a time reference ("cue:drop", "title.end", "beat:8"). A riser ends ' +
        'at this moment; every other sound starts at it.'
    ),
    volume: z
      .number()
      .min(0)
      .max(2)
      .optional()
      .describe('Gain of this sound in the mix (default: the library default for the id or preset, else 0.6).'),
  })
  .strict()
  .superRefine((cue, ctx) => {
    if ((cue.id === undefined) === (cue.sound === undefined)) {
      ctx.addIssue({ code: 'custom', message: 'a sound effect needs exactly one of id (library) or sound (composed)' });
    }
  })
  // The refinement doesn't reach JSON Schema: say "exactly one of id or sound" there too.
  .meta({
    description: 'One sound effect: a library `id`, or a composed `sound`.',
    oneOf: [{ required: ['id'] }, { required: ['sound'] }],
  });

export const SectionSfxSchema = z
  .array(SfxCueSchema)
  .max(32)
  .describe('Sound effects placed in this section; `at` is section time. Mixed over music and clip sound.');

export const GlobalSfxSchema = z
  .array(SfxCueSchema)
  .max(64)
  .describe(
    'Sound effects on the whole-video timeline. `at`: video seconds, "beat:n" / "bar:n", "<section>.start" / ' +
      '"<section>.end" (a section name), "cue:<name>" (the first section with that cue), "50%" or "end" of the ' +
      'video, each with an optional offset.'
  );

/** The `global.audio` fields this feature adds. */
export const GLOBAL_AUDIO_POLISH_FIELDS = {
  automation: AutomationSchema.optional().describe(
    'Volume automation of the MUSIC BED on the whole-video timeline (`at`: video seconds, "beat:n", ' +
      '"<section>.start", "cue:<name>"...). Multiplies the per-section musicVolume and runs before ducking, ' +
      'so ducking still dips the automated level under speech.'
  ),
  sfx: z
    .literal('auto')
    .optional()
    .describe(
      '"auto" adds sound effects from the motion: a whoosh on each designed transition, a hit where a kinetic ' +
        'impact block lands and on camera hits, a riser into every "drop" cue. Deterministic, at most 12, ' +
        'never on top of an authored sfx.'
    ),
};

/** Section option fields for the clip's own sound. */
export const CLIP_AUDIO_OPTION_FIELDS = {
  voice: VoicePresetSchema.optional(),
  audioAutomation: AutomationSchema.optional().describe(
    "Volume automation of this section's own sound (section time; time references allowed). Applied " +
      'after voice and audioEffect, before audioFade.'
  ),
};

export type SfxCue = z.infer<typeof SfxCueSchema>;
export type { VoicePreset } from '../core/audio/voice-presets';
export type AutomationKeyInput = z.infer<typeof AutomationKeySchema>;
