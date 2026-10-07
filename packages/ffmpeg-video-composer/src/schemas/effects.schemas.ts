import { z } from 'zod';
import { DESIGNED_TRANSITIONS } from '../core/motion/transitions';
import { EasingSpecSchema } from './motion.schemas';
import { GLOBAL_AUDIO_POLISH_FIELDS } from './audio.schemas';

// ── overlay fit ────────────────────────────────────────────────────────────────

// How an overlay maps into its "w:h" scale box. Lives here (not section.schemas) because both the
// section input options and the global animation options use it, and global.schemas cannot import
// from section.schemas without a cycle. Lowered by buildAnimationLegFilters to core LGPL filters
// (scale / pad / crop) so the on-device (--disable-gpl) engine keeps parity.
export const OVERLAY_FITS = ['stretch', 'contain', 'cover'] as const;

export const OverlayFitSchema = z
  .enum(OVERLAY_FITS)
  .describe(
    'How the overlay maps into its "w:h" scale box: "stretch" (default) scales freely and may distort; "contain" letterboxes inside the box with transparent padding; "cover" fills the box and centre-crops the overflow. Ignored without a fixed positive "w:h" scale.'
  );

// Mirror applied to the overlay leg itself, before rotation and compositing. Lives here for the same
// section/global reuse reason as OverlayFitSchema. Lowered by buildAnimationLegFilters to hflip/vflip —
// the same core LGPL filters the section motion flip emits — so on-device parity is proven.
export const OVERLAY_FLIPS = ['horizontal', 'vertical', 'both'] as const;

export const OverlayFlipSchema = z
  .enum(OVERLAY_FLIPS)
  .describe(
    'Mirror the overlay before compositing: "horizontal" flips left-right, "vertical" flips top-bottom, "both" applies both.'
  );

// ── xfade / audio constants ────────────────────────────────────────────────────

export const XFADE_TRANSITIONS = [
  'fade',
  'fadeblack',
  'fadewhite',
  'fadegrays',
  'fadefast',
  'fadeslow',
  'distance',
  'dissolve',
  'pixelize',
  'radial',
  'hblur',
  'wipeleft',
  'wiperight',
  'wipeup',
  'wipedown',
  'wipetl',
  'wipetr',
  'wipebl',
  'wipebr',
  'slideleft',
  'slideright',
  'slideup',
  'slidedown',
  'smoothleft',
  'smoothright',
  'smoothup',
  'smoothdown',
  'circlecrop',
  'rectcrop',
  'circleclose',
  'circleopen',
  'horzclose',
  'horzopen',
  'vertclose',
  'vertopen',
  'diagbl',
  'diagbr',
  'diagtl',
  'diagtr',
  'hlslice',
  'hrslice',
  'vuslice',
  'vdslice',
  'hlwind',
  'hrwind',
  'vuwind',
  'vdwind',
  'coverleft',
  'coverright',
  'coverup',
  'coverdown',
  'revealleft',
  'revealright',
  'revealup',
  'revealdown',
  'squeezeh',
  'squeezev',
  'zoomin',
] as const;

export const AFADE_CURVES = [
  'tri',
  'qsin',
  'hsin',
  'esin',
  'log',
  'ipar',
  'qua',
  'cub',
  'squ',
  'cbr',
  'par',
  'exp',
  'iqsin',
  'ihsin',
  'dese',
  'desi',
  'losi',
  'sinc',
  'isinc',
  'nofade',
] as const;

// Reveal/exit (animated text entrance + exit) and the text-legibility (shadow/outline) + chroma-key
// sugar live in their own files to keep this one under the max-lines budget; all are re-exported here
// so importers keep a single `effects.schemas` entry point.
export {
  REVEAL_TYPES,
  REVEAL_EASINGS,
  RevealObjectSchema,
  RevealSchema,
  ExitObjectSchema,
  ExitSchema,
} from './reveal.schemas';
export { TextEffectSchema, ChromaKeySchema } from './text-media.schemas';

// ── transition ─────────────────────────────────────────────────────────────────

/**
 * Effective transition duration fallback (seconds) when neither the section nor the global
 * transition declares one. Shared by the validator, the director's timeline math and the
 * music windows — they MUST agree or validation passes templates that render desynced.
 */
export const DEFAULT_TRANSITION_DURATION = 0.3;

// Upper bound on a transition's duration (seconds) — the schema's `.max()`. Exported so the
// editor's duration slider covers the full valid range instead of hardcoding (and drifting from) it.
export const MAX_TRANSITION_DURATION = 5;

export const TransitionSchema = z
  .object({
    type: z
      .union([z.enum(XFADE_TRANSITIONS), z.enum(DESIGNED_TRANSITIONS), z.literal('cut')])
      .describe(
        'xfade transition name between this section and the next, "cut" for a hard cut, or ' +
          'a designed transition: push-left/right/up/down, swipe-left/right, zoom-through, iris, ' +
          'whip-left/right/up/down (a push motion-blurred at peak speed).'
      ),
    ease: EasingSpecSchema.optional().describe(
      'Curve of a designed transition (default cubic-bezier(0.65, 0, 0.35, 1)); springs overshoot.'
    ),
    duration: z
      .number()
      .positive()
      .max(MAX_TRANSITION_DURATION)
      .optional()
      .describe('Transition length in seconds (default: the global transition duration, then 0.3).'),
  })
  .describe('Transition applied at the end of the section before the next one begins.');

// ── audio ──────────────────────────────────────────────────────────────────────

export const AudioFadeSchema = z
  .object({
    duration: z.number().positive().describe('Fade length in seconds.'),
    curve: z.enum(AFADE_CURVES).optional().describe('FFmpeg afade curve shape (default: tri).'),
  })
  .describe('Audio fade-in or fade-out applied to the section audio.');

export const DuckingSchema = z
  .object({
    threshold: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe('Audio level (0..1) below which music ducking activates (default 0.05).'),
    ratio: z
      .number()
      .min(1)
      .max(20)
      .optional()
      .describe('Compression ratio applied when ducking is active, 1..20 (default 8).'),
    attack: z.number().positive().optional().describe('Ducking attack time in milliseconds (default 20).'),
    release: z.number().positive().optional().describe('Ducking release time in milliseconds (default 400).'),
  })
  .describe('Fine-grained ducking parameters; used when global.audio.ducking is an object instead of a boolean.');

export const GlobalAudioSchema = z
  .object({
    sourceVolume: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe('Volume of the recorded/source audio in the final mix, 0..1 (default 1).'),
    musicVolume: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe('Volume of the background music track in the final mix, 0..1 (default 0.5).'),
    normalize: z
      .enum(['loudnorm', 'dynaudnorm'])
      .optional()
      .describe('FFmpeg audio normalisation filter to apply to the final mix (default: none).'),
    ducking: z
      .union([z.boolean(), DuckingSchema])
      .optional()
      .describe('Enable music ducking when source audio is present; true uses defaults, object allows fine-tuning.'),
    musicFade: z
      .number()
      .min(0.05)
      .max(3)
      .optional()
      .describe(
        'Length in seconds of the music cross-fade between sections, independent of the video transition (default: the global transition duration). Longer values smooth large per-section musicVolume changes.'
      ),
    ...GLOBAL_AUDIO_POLISH_FIELDS,
  })
  .describe('Global audio mix settings applied across the entire composition.');

// ── section visual effects ───────────────────────────────────────────────────────

// The look/grade preset list, colour-grade, motion/geometry and background layer/framing schemas live
// in a sibling to keep this file under the max-lines budget; re-exported so importers keep a single
// `effects.schemas` entry point.
export {
  LOOK_PRESETS,
  LUT_LOOK_PRESETS,
  LookSchema,
  GradeLutSchema,
  GradeSchema,
  MotionEffectSchema,
  BackgroundLayerSchema,
  FramingGuideSchema,
} from './effects-visual.schemas';
