import { z } from 'zod';
import { RevealSchema } from './reveal.schemas';

// Section visual effects — the look/grade preset list, colour-grade, motion/geometry and background
// layer/framing schemas — live here to keep `effects.schemas` under the max-lines budget; all are
// re-exported from `./effects.schemas` so importers keep a single entry point.

export const LOOK_PRESETS = [
  'cinematic',
  'warm',
  'cool',
  'vintage',
  'noir',
  'vivid',
  'dreamy',
  // LUT-backed cinema looks (lut3d + a generated .cube) — a stronger grade than the eq/curves presets.
  'teal-orange',
  'warm-film',
  'mono-film',
  'noir-film',
  'vivid-pop',
  // Stylized looks (Phase 4): duotone/posterize/sketch/glitch/soft-vignette — see looks.ts LOOK_TABLE.
  'duotone',
  'posterize',
  'sketch',
  'glitch',
  'soft-vignette',
] as const;

/** The look presets backed by a generated `.cube` (lut3d): the only ones `strength` can blend. */
export const LUT_LOOK_PRESETS = ['teal-orange', 'warm-film', 'mono-film', 'noir-film', 'vivid-pop'] as const;

// ── grade / look ───────────────────────────────────────────────────────────────

const LutStrengthSchema = z
  .number()
  .min(0)
  .max(1)
  .describe('How much of the LUT to apply, 0..1 (default 1): 0 = untouched footage, 1 = the full grade.');

export const LookSchema = z
  .union([
    z.enum(LOOK_PRESETS),
    z
      .object({
        preset: z.enum(LOOK_PRESETS).describe('Look preset name (same values as the string form).'),
        strength: LutStrengthSchema.optional().describe(
          `Grade strength 0..1 (default 1), blended into the generated LUT; only for the LUT looks (${LUT_LOOK_PRESETS.join(', ')}).`
        ),
      })
      .strict(),
  ])
  .describe(
    'Named colour-grade preset: a preset string, or { preset, strength } to dial a LUT look down (e.g. { "preset": "teal-orange", "strength": 0.6 }).'
  );

export const GradeLutSchema = z
  .object({
    url: z
      .string()
      .min(1)
      .describe('URL or assets-relative path of a 3D .cube LUT (e.g. a camera Log-to-Rec.709 conversion).'),
    strength: LutStrengthSchema.optional(),
  })
  .strict()
  .describe('A user-supplied 3D .cube LUT applied first in the grade (before eq/colour balance/curves).');

const ChannelAdjustSchema = z
  .object({
    r: z.number().min(-1).max(1).optional().describe('Red channel adjustment, -1..1.'),
    g: z.number().min(-1).max(1).optional().describe('Green channel adjustment, -1..1.'),
    b: z.number().min(-1).max(1).optional().describe('Blue channel adjustment, -1..1.'),
  })
  .describe('Per-channel RGB adjustment for a tonal range.');

export const GradeSchema = z
  .object({
    brightness: z.number().min(-1).max(1).optional().describe('Brightness offset, -1..1 (default 0).'),
    contrast: z.number().min(0).max(2).optional().describe('Contrast multiplier, 0..2 (default 1).'),
    saturation: z.number().min(0).max(3).optional().describe('Saturation multiplier, 0..3 (default 1).'),
    gamma: z.number().min(0.1).max(3).optional().describe('Gamma correction exponent, 0.1..3 (default 1).'),
    hue: z.number().min(-180).max(180).optional().describe('Hue rotation in degrees, -180..180 (default 0).'),
    colorBalance: z
      .object({
        shadows: ChannelAdjustSchema.optional().describe('RGB adjustment applied to shadow tones.'),
        midtones: ChannelAdjustSchema.optional().describe('RGB adjustment applied to midtone tones.'),
        highlights: ChannelAdjustSchema.optional().describe('RGB adjustment applied to highlight tones.'),
      })
      .optional()
      .describe('Per-range colour balance correction.'),
    blur: z.number().min(0).max(20).optional().describe('Gaussian blur radius in pixels, 0..20 (default 0).'),
    grain: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe('Film-grain strength, 0..1 (default 0; lowered to the FFmpeg noise filter).'),
    curvesPreset: z.string().optional().describe('Named curves preset key applied on top of other grade settings.'),
    lut: GradeLutSchema.optional().describe(
      'User .cube LUT { url, strength? } applied before the other grade settings (single lut3d, every backend).'
    ),
  })
  .describe('Colour-grade settings applied to the section video via FFmpeg eq/curves filters.');

// ── motion effects ─────────────────────────────────────────────────────────────

export const MotionEffectSchema = z
  .discriminatedUnion('type', [
    z.object({
      type: z.literal('kenburns').describe('Slow zoom-and-pan (Ken Burns) effect on the section video.'),
      direction: z
        .enum(['in', 'out', 'left', 'right', 'up', 'down'])
        .optional()
        .describe('Direction of the Ken Burns pan or zoom (default: in).'),
      intensity: z
        .number()
        .min(1.01)
        .max(2)
        .optional()
        .describe('Zoom scale factor at the end of the effect, 1.01..2 (default 1.15).'),
    }),
    z.object({
      type: z.literal('rotate').describe('Rotates the video frame by a fixed angle.'),
      angle: z.number().describe('Rotation angle in degrees; positive values rotate clockwise.'),
    }),
    z.object({
      type: z.literal('crop').describe('Crops the video frame to the specified rectangle.'),
      w: z.union([z.number(), z.string()]).describe('Crop width in pixels or as an FFmpeg expression.'),
      h: z.union([z.number(), z.string()]).describe('Crop height in pixels or as an FFmpeg expression.'),
      x: z
        .union([z.number(), z.string()])
        .optional()
        .describe('Crop x offset in pixels or FFmpeg expression (default (iw-ow)/2).'),
      y: z
        .union([z.number(), z.string()])
        .optional()
        .describe('Crop y offset in pixels or FFmpeg expression (default (ih-oh)/2).'),
    }),
    z.object({
      type: z.literal('flip').describe('Flips the video frame along the specified axis.'),
      axis: z
        .enum(['horizontal', 'vertical'])
        .describe('Axis of the flip: "horizontal" mirrors left-right, "vertical" mirrors top-bottom.'),
    }),
    z.object({
      type: z
        .literal('shake')
        .describe('Handheld camera shake: the frame jitters via a crop window that wanders over time.'),
      intensity: z
        .number()
        .min(1)
        .max(20)
        .optional()
        .describe('Maximum jitter amplitude in pixels, 1..20 (default 6).'),
      frequency: z.number().min(0.5).max(8).optional().describe('Wobble speed in Hz, 0.5..8 (default 2).'),
    }),
    z.object({
      type: z.literal('pulse').describe('Rhythmic zoom pulse in and out around the frame centre.'),
      intensity: z
        .number()
        .min(1.01)
        .max(1.3)
        .optional()
        .describe('Peak zoom of each pulse, 1.01..1.3 (default 1.08).'),
      frequency: z.number().min(0.25).max(4).optional().describe('Pulses per second, 0.25..4 (default 1).'),
    }),
  ])
  .describe('Motion or geometric effect applied to the section video.');

// ── background layer ───────────────────────────────────────────────────────────

export const BackgroundLayerSchema = z
  .object({
    color: z
      .string()
      .optional()
      .describe('Solid fill colour as a CSS hex string or FFmpeg colour name (e.g. "#FF0000").'),
    opacity: z.number().min(0).max(1).optional().describe('Layer opacity, 0..1 (default 1).'),
    x: z
      .union([z.number(), z.string()])
      .optional()
      .describe('Horizontal offset of the layer in output pixels or FFmpeg expression (default 0).'),
    y: z
      .union([z.number(), z.string()])
      .optional()
      .describe('Vertical offset of the layer in output pixels or FFmpeg expression (default 0).'),
    w: z
      .union([z.number(), z.string()])
      .optional()
      .describe('Layer width in output pixels or FFmpeg expression (default: full output width).'),
    h: z
      .union([z.number(), z.string()])
      .optional()
      .describe('Layer height in output pixels or FFmpeg expression (default: full output height).'),
    gradient: z
      .object({
        from: z.string().describe('Start colour of the gradient as a CSS hex string or FFmpeg colour name.'),
        to: z.string().describe('End colour of the gradient as a CSS hex string or FFmpeg colour name.'),
        direction: z
          .enum(['horizontal', 'vertical', 'diagonal'])
          .optional()
          .describe('Direction of the gradient sweep (default: vertical); only meaningful for the linear shape.'),
        angle: z
          .number()
          .optional()
          .describe(
            'Free angle of the linear sweep in degrees, CSS convention: 0 = bottom→top, 90 = left→right, 180 = top→bottom, 270 = right→left. Overrides direction when set; only meaningful for the linear shape.'
          ),
        shape: z
          .enum(['linear', 'radial', 'circular', 'spiral'])
          .optional()
          .describe(
            'Geometry of the gradient (default: linear): radial fills outward from the centre, circular sweeps angularly around it, spiral twists the angular sweep.'
          ),
      })
      .optional()
      .describe('Gradient drawn across the layer; overrides the solid color field.'),
    border: z
      .object({
        color: z.string().describe('Outline colour as a CSS hex string or FFmpeg colour name (e.g. "#FFFFFF").'),
        width: z.number().int().min(1).describe('Outline thickness in output pixels.'),
      })
      .optional()
      .describe(
        'Outline stroke drawn along the layer rectangle edge, over the fill — or alone when the layer has no fill colour. Ignored on gradient layers.'
      ),
    reveal: RevealSchema.optional().describe(
      'Animated entrance for the layer. Gradient layers fade/slide in via the overlay motion machinery; solid (drawbox) layers cannot animate alpha, so they appear at the reveal delay via a timeline gate.'
    ),
  })
  .describe('A single composited background layer drawn onto the color_background section.');

// ── framing guide ──────────────────────────────────────────────────────────────

export const FramingGuideSchema = z
  .object({
    type: z
      .literal('silhouette')
      .describe('Visual style of the framing guide overlay; only "silhouette" is supported.'),
    position: z
      .enum(['left', 'center', 'right'])
      .describe('Horizontal position of the silhouette within the recording viewfinder.'),
    opacity: z.number().min(0).max(1).optional().describe('Opacity of the framing guide overlay, 0..1 (default 0.45).'),
    style: z
      .enum(['bust', 'outline'])
      .optional()
      .describe('Silhouette rendering style: a filled "bust" (default) or a stroked "outline".'),
  })
  .describe('Camera framing guide shown in the recording UI; never rendered into the video.');
