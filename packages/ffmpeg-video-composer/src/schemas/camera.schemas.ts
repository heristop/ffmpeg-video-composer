import { z } from 'zod';
import { EasingSpecSchema, KeyframeSchema, MotionRoleSchema } from './motion.schemas';
import { TimeRefSchema, timeValue } from './time.schemas';

// ── virtual camera (docs/plans/motion-system.md §4.2) ─────────────────────────
//
// A section-level camera that moves over the finished frame (footage, graphics and, by default, text).
// A preset gives a complete move; tracks, hits and shake refine or replace it. Lowered to `zoompan` +
// `rotate` on the frame clock: deterministic, and on every backend.

export const CAMERA_PRESETS = [
  'none',
  'push-in',
  'pull-out',
  'drift-left',
  'drift-right',
  'drift-up',
  'drift-down',
  'orbit',
  'handheld',
] as const;

const CameraTrackSchema = z.array(KeyframeSchema).min(1).max(32);

export const CameraHitSchema = z
  .object({
    at: timeValue(z.number().min(0)).describe(
      'When the punch lands: seconds from the section start or a time reference ("beat:8", "title.end").'
    ),
    strength: z.number().min(0.01).max(0.4).optional().describe('Zoom bump (0.08 = 8% punch-in; default 0.08).'),
    decay: z.number().min(1).max(40).optional().describe('How fast the punch relaxes, per second (default 10).'),
  })
  .strict();

export const CameraSchema = z
  .object({
    preset: z
      .enum(CAMERA_PRESETS)
      .optional()
      .describe(
        'Camera move. push-in / pull-out: slow dolly toward / away. drift-*: lateral or vertical glide. orbit: ' +
          'push with a curved drift. handheld: organic seeded shake only. none: hits/shake/tracks only (default).'
      ),
    amount: z
      .number()
      .min(0.01)
      .max(0.6)
      .optional()
      .describe('Move strength: zoom delta and drift range (default 0.12).'),
    delay: timeValue(z.number().min(0))
      .optional()
      .describe('When the preset move starts: seconds (default 0) or a time reference.'),
    duration: z.number().positive().optional().describe('Seconds the preset move takes (default: to the section end).'),
    ease: EasingSpecSchema.optional().describe('Curve of the preset move (default ease-in-out-sine).'),
    role: MotionRoleSchema.optional(),
    zoom: CameraTrackSchema.optional().describe(
      'Zoom keyframes (1 = framed, 1.2 = 20% closer); overrides the preset zoom.'
    ),
    x: CameraTrackSchema.optional().describe(
      'Camera x keyframes in output px (+ moves the camera right); overrides the preset.'
    ),
    y: CameraTrackSchema.optional().describe(
      'Camera y keyframes in output px (+ moves the camera down); overrides the preset.'
    ),
    rotate: CameraTrackSchema.optional().describe('Roll keyframes in degrees (+ clockwise), within ±15.'),
    hits: z
      .array(z.union([z.number().min(0), TimeRefSchema, CameraHitSchema]))
      .max(16)
      .optional()
      .describe(
        'Punch-ins on beats: seconds, a time reference ("beat:8"), or { at, strength, decay }. Pair with kinetic impact or a flash.'
      ),
    shake: z
      .object({
        amplitude: z.number().min(0).max(60).optional().describe('Wander in output px (default 6).'),
        frequency: z.number().min(0.1).max(8).optional().describe('Wander speed in Hz (default 0.8).'),
        rotation: z.number().min(0).max(5).optional().describe('Roll wobble in degrees (default 0).'),
      })
      .strict()
      .optional()
      .describe('Seeded organic shake (sum of sines; global.seed reshuffles it).'),
    includeText: z
      .boolean()
      .optional()
      .describe(
        'Move text and graphics with the frame (default true); false keeps overlays steady over a moving shot.'
      ),
  })
  .strict()
  .describe('Virtual camera over the section.')
  .meta({ id: 'Camera' });

export type Camera = z.infer<typeof CameraSchema>;
