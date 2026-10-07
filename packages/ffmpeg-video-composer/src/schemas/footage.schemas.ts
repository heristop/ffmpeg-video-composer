import { z } from 'zod';
import { EasingSpecSchema } from './motion.schemas';
import { timeValue } from './time.schemas';
import { SPEED_RAMP_PRESETS } from '../core/footage/presets';
import { KeepRangesSchema, TrimSilenceSchema } from './take.schemas';

// Footage editing options: how a clip is reframed into the output (fit / fill / focus, every visual
// section) and how a video / project_video clip is cut in time (clip range, speed ramp, freeze frames).
// Lowered by editor/utils/reframe.ts and editor/utils/footage-lowering.ts; durations by core/footage/plan.ts.

export const SECTION_FITS = ['cover', 'letterbox', 'blur', 'off'] as const;
export const FOCUS_ANCHORS = ['center', 'left', 'right', 'top', 'bottom'] as const;

const unit = z.number().min(0).max(1);

export const FitFillSchema = z
  .object({
    blur: z.number().min(1).max(100).optional().describe('Gaussian blur sigma of the fill copy (default 20).'),
    dim: z.number().min(0).max(1).optional().describe('How much the fill copy is darkened, 0..1 (default 0.15).'),
    zoom: z
      .number()
      .min(1)
      .max(3)
      .optional()
      .describe('Extra zoom of the fill copy past cover, 1..3 (default 1: it just covers the frame).'),
  })
  .strict()
  .describe('The blurred background of fit "blur": blur strength, dimming and zoom.');

export const FocusKeySchema = z
  .object({
    t: timeValue(z.number().min(0)).describe('Section time of this key, in seconds or a time reference.'),
    x: unit.describe('Horizontal focus, 0 = left edge of the source, 1 = right edge.'),
    y: unit.describe('Vertical focus, 0 = top edge of the source, 1 = bottom edge.'),
    ease: EasingSpecSchema.optional().describe('Curve INTO this key from the previous one (default linear).'),
  })
  .strict();

export const FocusSchema = z
  .union([z.enum(FOCUS_ANCHORS), z.object({ x: unit, y: unit }).strict(), z.array(FocusKeySchema).min(1).max(32)])
  .describe(
    'Which part of the source a cover crop keeps: an anchor (center = default, left, right, top, bottom), ' +
      'a point { x, y } as 0..1 fractions of the source, or keyframes [{ t, x, y, ease? }] that pan the crop ' +
      'over time (keys ease into each other; before the first key the first holds). Only used by fit cover.'
  );

export const ClipRangeSchema = z
  .object({
    from: z.number().min(0).optional().describe('In-point in source seconds (default 0).'),
    to: z
      .number()
      .positive()
      .optional()
      .describe('Out-point in source seconds (default: the end of the clip); clamped to the clip length.'),
  })
  .strict()
  .refine((clip) => clip.to === undefined || clip.to > (clip.from ?? 0), {
    message: 'clip.to must be after clip.from',
    path: ['to'],
  })
  .describe(
    'Which part of the source clip plays, in SOURCE seconds (before any ramp). Trimmed frame-exactly with ' +
      'the trim/atrim filters (decodes the skipped head; identical on every backend).'
  );

export const SpeedRampKeySchema = z
  .object({
    at: timeValue(z.number().min(0)).describe(
      'Section (output) time this speed is reached, in seconds or a time reference.'
    ),
    speed: z
      .number()
      .min(0.1)
      .max(10)
      .describe('Playback rate at this key: 1 = real time, 0.3 = slow motion, 3 = fast.'),
    ease: EasingSpecSchema.optional().describe('Curve INTO this key from the previous one (default linear).'),
  })
  .strict();

export const SpeedRampSchema = z
  .union([z.enum(SPEED_RAMP_PRESETS), z.array(SpeedRampKeySchema).min(1).max(32)])
  .describe(
    'Speed ramp over the clip: a preset (hero, montage, bullet, flash-in, flash-out; timed as fractions of ' +
      'the trimmed clip) or keys [{ at, speed, ease? }] in OUTPUT seconds, strictly increasing. Before the ' +
      'first key its speed holds, after the last key the last speed holds; the clip ends when its source ' +
      'runs out. Picture frames are dropped/duplicated on the output frame grid (no interpolation).'
  );

export const FreezeSchema = z
  .object({
    at: timeValue(z.number().min(0)).describe(
      'Section time of the frame to hold, in seconds or a time reference (after any ramp and earlier holds).'
    ),
    hold: z.number().positive().max(10).describe('Seconds the frame is held; the section grows by this much.'),
    flash: z.boolean().optional().describe('A white flash hit on the frozen frame (default false).'),
    audio: z
      .enum(['silence', 'continue'])
      .optional()
      .describe(
        'Clip sound during the hold: silence (default; the sound pauses and resumes in sync) or continue ' +
          '(the sound runs on and the section ends with the hold as silence).'
      ),
  })
  .strict();

/** Reframing options, shared by every visual section. */
export const FIT_OPTION_FIELDS = {
  fit: z
    .enum(SECTION_FITS)
    .optional()
    .describe(
      'How the source maps into the output frame: cover (fill and crop, default), letterbox (whole picture ' +
        'with bars), blur (whole picture over a blurred, dimmed copy of itself filling the frame), off (no ' +
        'scaling). Overrides forceAspectRatio / forceOriginalAspectRatio.'
    ),
  fill: FitFillSchema.optional(),
  focus: FocusSchema.optional(),
};

/** Time editing options, for video and project_video sections. */
export const FOOTAGE_OPTION_FIELDS = {
  clip: ClipRangeSchema.optional(),
  speedRamp: SpeedRampSchema.optional(),
  rampAudio: z
    .enum(['stretch', 'mute'])
    .optional()
    .describe(
      'Clip sound under a speed ramp: stretch (default; pitch-preserving tempo change per ramp step) or mute ' +
        '(silence wherever the speed is not 1).'
    ),
  freeze: z
    .array(FreezeSchema)
    .min(1)
    .max(16)
    .optional()
    .describe('Freeze frames, in section-time order: each holds one frame for `hold` seconds.'),
  // Take editing (schemas/take.schemas.ts): exclusive with clip / speedRamp / freeze (validation).
  trimSilence: TrimSilenceSchema.optional(),
  keep: KeepRangesSchema.optional(),
};

export { CutawaySchema, CutawaysSchema, KeepRangeSchema, KeepRangesSchema, TrimSilenceSchema } from './take.schemas';

export type FootageFit = (typeof SECTION_FITS)[number];
export type FitFill = z.infer<typeof FitFillSchema>;
export type Focus = z.infer<typeof FocusSchema>;
export type ClipRange = z.infer<typeof ClipRangeSchema>;
export type SpeedRamp = z.infer<typeof SpeedRampSchema>;
export type Freeze = z.infer<typeof FreezeSchema>;
