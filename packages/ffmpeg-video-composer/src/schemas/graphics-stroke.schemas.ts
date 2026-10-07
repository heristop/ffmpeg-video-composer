import { z } from 'zod';
import { FxTargetSchema } from './fx.schemas';

// ── fields of the stroke graphics: frame, corners, underline (editor/presets/stroke-*.ts) ────────────────
//
// Every field here is optional; the defaults are derived from the context: a trace that starts top-left
// with a short head fade, even-pixel strokes, a visible exit before `until` (or the end of the section) and, for frame/corners, contrast-aware colour.

export const STROKE_EXITS = ['none', 'fade', 'retract', 'expand'] as const;
export const FRAME_TRACES = ['sides', 'path', 'split', 'fade'] as const;
export const CORNER_TRACES = ['together', 'clockwise', 'fade'] as const;
export const STROKE_CONTRASTS = ['none', 'auto', 'shadow'] as const;
export const UNDERLINE_CAPS = ['square', 'round'] as const;

const exitFields = {
  exit: z
    .enum(STROKE_EXITS)
    .optional()
    .describe(
      'How it leaves before `until` (or the end of the section when `until` is unset): fade (opacity to 0), ' +
        'retract (the stroke undraws in its trace order), expand (grows ~4% outward while fading; frame/corners), ' +
        'none (holds to the cut). Default: fade for frame and underline, expand for corners.'
    ),
  exitDuration: z
    .number()
    .min(0.1)
    .max(1.5)
    .optional()
    .describe('Seconds the exit takes on $smooth (default: 60% of the entrance, between 0.15 and 0.35).'),
};

const outlineFields = {
  ...exitFields,
  target: FxTargetSchema.optional().describe(
    'What the strokes frame instead of the whole frame: "layer:<i>", "pane:<i>", "text:<i>" or a {x, y, w, h} ' +
      'rectangle in px or frame fractions. They sit `clearance` px outside it, clamped inside the frame.'
  ),
  clearance: z
    .number()
    .min(-200)
    .max(400)
    .optional()
    .describe('With `target`. Px between the target edge and the strokes (default 24; negative = inside it).'),
  radius: z
    .number()
    .min(0)
    .max(400)
    .optional()
    .describe(
      'Corner radius in px (default 0 = square corners); raised to the thickness when smaller. Rounded ' +
        'corners are anti-aliased arcs generated at their exact size.'
    ),
  contrast: z
    .enum(STROKE_CONTRASTS)
    .optional()
    .describe(
      'Keeps the strokes readable on any background. auto (default): on a known solid background an ' +
        'unset colour becomes light or dark ink by its luminance, and a low-contrast colour or an unknown ' +
        'background (footage, images) gets a soft offset shadow. shadow: always the shadow. none: as authored.'
    ),
};

export const frameStrokeFields = {
  ...outlineFields,
  trace: z
    .enum(FRAME_TRACES)
    .optional()
    .describe(
      'How the outline draws on, always starting at the top-left corner: path (one head travels clockwise ' +
        'at constant speed, default), split (two heads leave the top-left and meet bottom-right), sides ' +
        '(each side in turn takes a quarter of the time), fade (no draw-on, fades in).'
    ),
};

export const cornerStrokeFields = {
  ...outlineFields,
  trace: z
    .enum(CORNER_TRACES)
    .optional()
    .describe(
      'together (all four brackets extend at once), clockwise (they start one after another from the ' +
        'top-left; default), fade (no draw-on, they fade in at full length).'
    ),
  spread: z
    .number()
    .min(1)
    .max(1.3)
    .optional()
    .describe(
      'Size the bracket rectangle starts at relative to its rest size: 1.08 = they close in from 108% onto ' +
        'the subject on the entrance curve (default 1.06; 1 = no travel).'
    ),
};

export const underlineStrokeFields = {
  ...exitFields,
  caps: z.enum(UNDERLINE_CAPS).optional().describe('Line ends: round (anti-aliased half discs, default) or square.'),
  settle: z
    .number()
    .min(0)
    .max(0.12)
    .optional()
    .describe(
      'Overshoot of the draw-on as a fraction of the width: the line runs that much past its end, then ' +
        'settles back (default 0.03; 0 = none).'
    ),
};
