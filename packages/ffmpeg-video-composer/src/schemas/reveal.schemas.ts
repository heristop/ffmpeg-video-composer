import { z } from 'zod';
import { EasingSpecSchema } from './motion.schemas';
import { timeValue } from './time.schemas';

// ── reveal / exit (animated text entrance + exit) ────────────────────────────────
//
// Animated entrance/exit for sugar text. Each is authored as the bare type ("rise") or the full
// object with timing. The reveal preset (editor/presets/text.ts) lowers them to drawtext alpha/x/y
// expressions. Split out of effects.schemas.ts to keep that file under the max-lines budget;
// re-exported from there so importers keep a single entry point.

export const REVEAL_TYPES = ['none', 'fade', 'rise', 'slide-left', 'slide-right'] as const;

// Progress curves for the entrance ramp. Lowered as pure expression math on the drawtext alpha/x/y
// and overlay x/y (ease-out = 1-(1-p)^3, ease-in-out = smoothstep p*p*(3-2p)) — no extra filter, so
// the LGPL on-device build keeps parity. An overlay `fade` motion lowers to the fade FILTER, which
// is linear only, so easing applies to rise/slide overlay paths (text fades ARE eased: drawtext alpha).
export const REVEAL_EASINGS = ['linear', 'ease-out', 'ease-in-out', 'ease-out-back'] as const;

export const RevealObjectSchema = z
  .object({
    type: z.enum(REVEAL_TYPES).describe('Entrance style: none, fade, rise (up from below), slide-left, slide-right.'),
    delay: z.number().min(0).optional().describe('Seconds before the entrance starts (default 0.3).'),
    duration: z.number().positive().optional().describe('Seconds the entrance takes (default 0.6).'),
    distance: z.number().positive().optional().describe('Pixels the text travels for rise/slide (default 60).'),
    easing: EasingSpecSchema.optional().describe(
      'Progress curve for the entrance (default linear). ease-out decelerates; ease-in-out ramps up and settles; ease-out-back overshoots travel by about 10% and settles, with text alpha clamped to 0..1. Also springs (duration derived when omitted), cubic-bezier, the named curves and $tokens. Ignored by an overlay fade motion (the fade filter is linear only).'
    ),
  })
  .strict()
  .describe('Animated entrance for sugar text, with optional timing overrides.');

export const RevealSchema = z
  .union([z.enum(REVEAL_TYPES), RevealObjectSchema])
  .describe('Animated text entrance: a bare type ("rise") or an object with timing overrides.');

// An animated EXIT (fade/slide out). Same styles as a reveal; `after` says when the exit begins
// (seconds from the section start), defaulting so the exit ends at the section's end.
export const ExitObjectSchema = z
  .object({
    type: z.enum(REVEAL_TYPES).describe('Exit style: none, fade, rise (up/out), slide-left, slide-right.'),
    easing: EasingSpecSchema.optional().describe(
      'Exit curve (default linear). ease-out-back overshoots travel by about 10%; text alpha stays in 0..1. Also any easing spec or $token.'
    ),
    after: z
      .number()
      .min(0)
      .optional()
      .describe('Seconds from the section start when the exit begins (default: timed to end at the section end).'),
    duration: z.number().positive().optional().describe('Seconds the exit takes (default 0.6).'),
    distance: z.number().positive().optional().describe('Pixels travelled for rise/slide exits (default 60).'),
  })
  .strict()
  .describe('Animated exit for sugar text, with optional timing overrides.');

export const ExitSchema = z
  .union([z.enum(REVEAL_TYPES), ExitObjectSchema])
  .describe('Animated text exit: a bare type ("fade") or an object with timing overrides.');

// A positioned drawtext filter's reveal/exit: the same vocabulary, with time references on `delay` and
// `after` ("title.end + 0.2", "beat:8 - 0.1"), resolved to seconds before lowering.
export const TimedRevealSchema = z
  .union([
    z.enum(REVEAL_TYPES),
    RevealObjectSchema.extend({
      delay: timeValue(z.number().min(0))
        .optional()
        .describe('When the entrance starts: seconds (default 0.3) or a time reference ("title.end + 0.2").'),
    }),
  ])
  .describe('Animated text entrance: a bare type ("rise") or an object with timing overrides.');

export const TimedExitSchema = z
  .union([
    z.enum(REVEAL_TYPES),
    ExitObjectSchema.extend({
      after: timeValue(z.number().min(0))
        .optional()
        .describe('When the exit begins: seconds or a time reference ("end - 0.6"); default: ends with the section.'),
    }),
  ])
  .describe('Animated text exit: a bare type ("fade") or an object with timing overrides.');
