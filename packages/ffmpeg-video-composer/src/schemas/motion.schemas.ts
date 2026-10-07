import { z } from 'zod';
import { easingError } from '../core/motion/easing';

// ── motion system schemas (docs/plans/motion-system.md §2–3) ─────────────────────────────────
//
// Shapes only. The grammar of an easing string, token references and keyframe ordering are checked by
// the motion rules in services/motion-validation.ts, which report precise paths and messages (a zod
// regex would only say "invalid string").

export const EASING_SPEC_DESCRIPTION =
  'Easing: linear | ease-out | ease-in-out | ease-out-back, ' +
  'ease | ease-in | ease-out-expo | ease-in-out-sine | ease-out-elastic | ease-out-bounce | … , ' +
  'cubic-bezier(x1,y1,x2,y2), spring(stiffness,damping[,mass[,velocity]]), steps(n[,start|end]), ' +
  'a $token from global.motion or the built-ins ($snappy, $gentle, $bouncy, $wobbly, $smooth, $juicy, $expo, ' +
  '$anticipate), a motion role $role.<micro|panel|camera|headline|accent|mascot>, or { points: [[p,value],…] }.';

// Grammar is checked here so a typo fails at the schema, with the reason; a `$token` only has to be
// well formed, because whether it exists depends on the template's global.motion (a descriptor rule).
function easingGrammarIssue(spec: string): string | null {
  if (spec.startsWith('$')) {
    return /^\$(?:role\.)?[a-z][a-z0-9-]{0,31}$/.test(spec) ? null : `malformed motion token "${spec}"`;
  }

  return easingError(spec);
}

const EasingStringSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .superRefine((spec, ctx) => {
    const issue = easingGrammarIssue(spec);

    // `params.easing` lets the validator attach the nearest named easing as a suggestion.
    if (issue) ctx.addIssue({ code: 'custom', message: issue, params: { easing: true } });
  });

export const EasingSpecSchema = z
  .union([
    EasingStringSchema,
    z
      .object({
        points: z
          .array(z.tuple([z.number().min(0).max(1), z.number().min(-2).max(3)]))
          .min(2)
          .max(64)
          .describe('Curve control points [progress, value] from [0,0] to [1,1], non-decreasing in progress.'),
      })
      .strict(),
  ])
  .describe(EASING_SPEC_DESCRIPTION)
  // An id emits this once under $defs in the JSON Schema and references it from every easing field.
  .meta({ id: 'EasingSpec' });

const TOKEN_NAME = /^[a-z][a-z0-9-]{0,31}$/;
const TokenNameSchema = z.string().regex(TOKEN_NAME, 'token names are lower-kebab-case, 1..32 characters');

export const SpringTokenSchema = z
  .object({
    stiffness: z.number().min(1).max(2000).describe('Spring stiffness k (1..2000). Higher is snappier.'),
    damping: z.number().min(1).max(200).describe('Damping c (1..200). Lower bounces more.'),
    mass: z.number().min(0.1).max(20).optional().describe('Mass m (0.1..20, default 1). Heavier is slower.'),
    velocity: z
      .number()
      .min(-50)
      .max(50)
      .optional()
      .describe('Initial velocity toward the target, in distances per second (default 0).'),
  })
  .strict()
  .describe('A physical spring; its duration is derived (time to settle within 0.1%) unless one is authored.');

// ── motion roles: one feel per class of object ───────────────────────────────

export const MOTION_ROLES = ['micro', 'panel', 'camera', 'headline', 'accent', 'mascot'] as const;
export const MOTION_OVERSHOOTS = ['none', 'subtle', 'playful'] as const;

export const MotionRoleSchema = z
  .enum(MOTION_ROLES)
  .describe(
    'Motion role of this element (global.motion.roles): micro (small UI bits, quick, no overshoot), panel ' +
      '(plates/cards, controlled settle), camera (smooth, near-invisible), headline (strong entrance, stable ' +
      'hold), accent (snappy emphasis), mascot (playful overshoot). Supplies ease (and duration when the ease ' +
      'comes from the role) to an element that sets none; an explicit ease/duration always wins.'
  );

const DurationTokenSchema = z
  .string()
  .regex(/^\$[a-z][a-z0-9-]{0,31}$/, 'a duration token looks like "$base"')
  .describe('A duration token from global.motion.durations or the built-ins ($micro, $short, $base, $long…).');

export const MotionRoleSpecSchema = z
  .object({
    ease: EasingSpecSchema.describe('Curve for every element of this role; a $token is allowed, a $role.* is not.'),
    duration: z
      .union([z.number().positive().max(10), DurationTokenSchema])
      .optional()
      .describe('Seconds (or a duration token) applied with the ease; omit to keep each element default or physics.'),
    overshoot: z
      .enum(MOTION_OVERSHOOTS)
      .optional()
      .describe('Declared overshoot budget: none (settles), subtle (a few %), playful (visible bounce).'),
  })
  .strict()
  .describe('A motion role: the ease, duration and overshoot budget shared by one class of object.');

export const MotionRolesSchema = z
  .object({
    micro: MotionRoleSpecSchema.optional().describe(
      'Small UI bits: toggles, chips, icons (default quick, no overshoot).'
    ),
    panel: MotionRoleSpecSchema.optional().describe(
      'Plates, cards, backing panels (default $expo, controlled settle).'
    ),
    camera: MotionRoleSpecSchema.optional().describe('Camera moves (default ease-in-out-sine, near-invisible).'),
    headline: MotionRoleSpecSchema.optional().describe(
      'Hero copy (default $expo 0.7 s: strong entrance, stable hold).'
    ),
    accent: MotionRoleSpecSchema.optional().describe('Emphasis hits: a word, an underline (default $snappy).'),
    mascot: MotionRoleSpecSchema.optional().describe('Characters, stickers, playful props (default $bouncy).'),
  })
  .strict()
  .describe(
    'Motion rules per class of object, overriding the built-in defaults role by role. Elements opt in with ' +
      '`role`; `$role.<name>` works wherever an easing or a duration token is accepted.'
  );

export const MotionTokensSchema = z
  .object({
    energy: z
      .number()
      .min(0)
      .max(1.5)
      .optional()
      .describe(
        'Global motion intensity (0..1.5, default 1): scales every reveal/exit/overlay travel distance and ' +
          'relative keyframe offset. 0 is a reduced-motion cut (fades only).'
      ),
    springs: z.record(TokenNameSchema, SpringTokenSchema).optional().describe('Named springs, referenced as $name.'),
    curves: z
      .record(TokenNameSchema, EasingSpecSchema)
      .optional()
      .describe('Named easing curves, referenced as $name.'),
    durations: z
      .record(TokenNameSchema, z.number().min(0).max(30))
      .optional()
      .describe('Named durations in seconds, referenced from keyframe times as "$name" or "+$name".'),
    roles: MotionRolesSchema.optional(),
  })
  .strict()
  .describe('Motion tokens: one design system for time, shared by every animated field.');

// ── animate: keyframe tracks ───────────────────────────────────────────────────

export const KeyframeSchema = z
  .object({
    t: z
      .union([z.number().min(0), z.string().trim().min(1).max(80)])
      .optional()
      .describe(
        'When this key is reached: seconds from the section start (1.2), relative to the previous key ' +
          '("+0.3"), a duration token ("$base", "+$short"), or a time reference ("title.end + 0.2", ' +
          '"beat:8 - 0.1", "50%", "end - 0.5", "cue:drop"). Omitted: the previous key plus this ease\'s ' +
          'natural duration (a spring settles on its own) or 0.6 s; the first key defaults to 0.'
      ),
    v: z
      .union([z.number(), z.string().regex(/^[+-]\d+(?:\.\d+)?$/, 'relative values look like "+80" or "-40"')])
      .describe(
        'Value at this key. x/y: pixels, or "+80"/"-40" relative to the resting position (scaled by energy). ' +
          'opacity: 0..1. scale: a multiplier of the font size.'
      ),
    ease: EasingSpecSchema.optional().describe('Curve INTO this key from the previous one (default linear).'),
  })
  .strict();

const TrackSchema = z.array(KeyframeSchema).min(1).max(32).meta({ id: 'KeyframeTrack' });

export const AnimateSchema = z
  .object({
    x: TrackSchema.optional().describe('Horizontal position track (drawtext x).'),
    y: TrackSchema.optional().describe('Vertical position track (drawtext y).'),
    opacity: TrackSchema.optional().describe('Opacity track (drawtext alpha), clamped to 0..1.'),
    scale: TrackSchema.optional().describe('Scale track: multiplies a numeric fontsize, re-rasterized every frame.'),
  })
  .strict()
  .describe(
    'Keyframe tracks for a positioned drawtext. Each key eases into the next; a track ' +
      'overrides the same property from reveal/exit.'
  )
  .meta({ id: 'Animate' });

export type EasingSpecInput = z.infer<typeof EasingSpecSchema>;
export type MotionTokens = z.infer<typeof MotionTokensSchema>;
export type Keyframe = z.infer<typeof KeyframeSchema>;
export type Animate = z.infer<typeof AnimateSchema>;
export type MotionRole = (typeof MOTION_ROLES)[number];
export type MotionRoleSpec = z.infer<typeof MotionRoleSpecSchema>;
