import { z } from 'zod';

// How a layer meets the picture beneath it (inputs[].options.blend, lowered by editor/presets/layer-blend.ts)
// and the motion blur of a layer or a kinetic block (options.motionBlur / kinetic[].motionBlur, lowered by
// editor/presets/motion-blur.ts). Bounded here: an enum, an integer shutter angle, an integer sample count.

export const BLEND_MODES = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'add',
  'darken',
  'lighten',
  'difference',
] as const;

export type BlendMode = (typeof BLEND_MODES)[number];

export const BlendModeSchema = z
  .enum(BLEND_MODES)
  .describe(
    'How the layer mixes with the picture beneath, inside its own alpha (default normal). multiply darkens, ' +
      'screen lightens (glows, flares), overlay adds contrast, add sums light (sparks, fire), darken / lighten ' +
      'keep the darker / lighter, difference inverts where the layer is light. Needs the blend filter: without ' +
      'it the layer composites normally with a warning.'
  );

export const MOTION_BLUR_DEFAULTS = { shutter: 180, samples: 8 } as const;

/** Kinetic presets whose units never travel: nothing to blur. */
export const MOTION_BLUR_STILL_PRESETS: ReadonlySet<string> = new Set(['fade', 'typewriter', 'scramble', 'counter']);

const MotionBlurSettingsSchema = z
  .object({
    shutter: z
      .number()
      .int()
      .min(0)
      .max(360)
      .optional()
      .describe('Shutter angle in degrees, 0..360 (default 180, the film look); 0 is off.'),
    samples: z
      .number()
      .int()
      .min(2)
      .max(16)
      .optional()
      .describe('Sub-frame samples averaged per frame, 2..16 (default 8); smoother and costlier as it grows.'),
  })
  .strict();

export const MotionBlurSchema = z
  .union([z.literal(true), MotionBlurSettingsSchema])
  .describe(
    'Motion blur while the element moves: true, or { shutter, samples }. Resting frames stay sharp. Needs the ' +
      'tmix filter: without it the element draws sharp.'
  )
  .meta({ id: 'MotionBlur' });

export type MotionBlur = z.infer<typeof MotionBlurSchema>;

export interface ResolvedMotionBlur {
  shutter: number;
  samples: number;
}

/** The blur settings with defaults, or null when there is none (absent, or a closed shutter). */
export function resolveMotionBlur(value: MotionBlur | undefined): ResolvedMotionBlur | null {
  if (value === undefined) return null;

  const settings = value === true ? {} : value;
  const shutter = settings.shutter ?? MOTION_BLUR_DEFAULTS.shutter;

  if (shutter === 0) return null;

  return { shutter, samples: settings.samples ?? MOTION_BLUR_DEFAULTS.samples };
}

const CLIP_CONFLICT = 'clip cannot combine with blend or motionBlur yet; drop one';

/** An input whose options pair `clip` with a non-normal blend or a motionBlur: one issue per offending field. */
export function layerCompositeIssues(
  input: { options?: { clip?: unknown; blend?: string; motionBlur?: unknown } },
  ctx: z.RefinementCtx
): void {
  const options = input.options;

  if (options?.clip === undefined) return;

  if (options.blend !== undefined && options.blend !== 'normal') {
    ctx.addIssue({ code: 'custom', path: ['options', 'blend'], message: CLIP_CONFLICT });
  }

  if (options.motionBlur !== undefined) {
    ctx.addIssue({ code: 'custom', path: ['options', 'motionBlur'], message: CLIP_CONFLICT });
  }
}
