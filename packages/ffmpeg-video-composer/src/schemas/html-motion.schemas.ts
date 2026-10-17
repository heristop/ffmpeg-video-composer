import { z } from 'zod';
import { TrackSchema } from './motion.schemas';
import { HTML_MOTION_MAX_NAMES, isMotionName } from '../core/html/limits';

// Per-element motion inside an HTML layer (`inputs[].motion`, html inputs only): each key names the
// `data-motion` attribute of the elements it moves. The tracks are the layer keyframe tracks' keys; the frame
// plan and its budget live in core/html/motion-frames.ts, the drawing in editor/html/stage-html-sequence.ts.

export const ElementMotionSchema = z
  .object({
    x: TrackSchema.optional().describe(
      'Horizontal offset track in pixels from where the element is laid out ("+40" and 40 alike).'
    ),
    y: TrackSchema.optional().describe('Vertical offset track in pixels from where the element is laid out.'),
    scale: TrackSchema.optional().describe('Scale track (0..10) about the element centre.'),
    rotate: TrackSchema.optional().describe('Rotation track in degrees, clockwise, about the element centre.'),
    opacity: TrackSchema.optional().describe("Opacity track 0..1, multiplied with the element's own CSS opacity."),
    stagger: z
      .number()
      .min(0)
      .max(2)
      .optional()
      .describe('Seconds each further element with this name starts after the previous one, in document order.'),
  })
  .strict()
  .meta({ id: 'HtmlElementMotion' });

export const HtmlMotionSchema = z
  .record(
    z.string().refine(isMotionName, {
      message:
        'motion names are lowercase letters, digits and dashes, 32 at most, starting with a letter, and not ease, easing or animate',
    }),
    ElementMotionSchema
  )
  .refine((map) => Object.keys(map).length <= HTML_MOTION_MAX_NAMES, {
    message: `at most ${HTML_MOTION_MAX_NAMES} motion names per html layer`,
  })
  .describe(
    'html layer: keyframe tracks per element. Each key names the data-motion attribute of the elements it ' +
      'moves; times are section seconds. The card is drawn frame by frame over the animated span only.'
  )
  .meta({ id: 'HtmlMotion' });

export type ElementMotion = z.infer<typeof ElementMotionSchema>;
export type HtmlMotion = z.infer<typeof HtmlMotionSchema>;
