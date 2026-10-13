import { z } from 'zod';
import { TrackSchema } from './motion.schemas';

// Keyframe tracks on an image, animation or html layer input (`inputs[].options.animate`), lowered by
// editor/presets/layer-keyframes.ts. Keys are the drawtext track's `{ t, v, ease? }`; the track set adds
// the transforms a layer can take that text cannot (non-uniform scale, rotation).

export const LAYER_TRACKS = ['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotate', 'opacity'] as const;

/** The tracks that change the layer's own frame (and so need its box): everything but x, y and opacity. */
export const LAYER_TRANSFORM_TRACKS = ['scale', 'scaleX', 'scaleY', 'rotate'] as const;

export const LAYER_ORIGINS = [
  'center',
  'top-left',
  'top',
  'top-right',
  'left',
  'right',
  'bottom-left',
  'bottom',
  'bottom-right',
] as const;

export const LayerOriginSchema = z
  .enum(LAYER_ORIGINS)
  .describe(
    'The point of the layer box that animate scale and rotate tracks pivot about (default center); it stays ' +
      'put while the layer scales or turns.'
  );

export const LayerAnimateSchema = z
  .object({
    x: TrackSchema.optional().describe(
      'Horizontal position track (overlay x): pixels, or "+80"/"-40" relative to options.position.'
    ),
    y: TrackSchema.optional().describe(
      'Vertical position track (overlay y): pixels, or "+80"/"-40" relative to options.position.'
    ),
    scale: TrackSchema.optional().describe('Uniform scale track: a multiplier of the layer box (0..10).'),
    scaleX: TrackSchema.optional().describe(
      'Horizontal scale track (0..10), multiplied with scale: squash and stretch, or a card flip (1 → 0 → 1).'
    ),
    scaleY: TrackSchema.optional().describe('Vertical scale track (0..10), multiplied with scale.'),
    rotate: TrackSchema.optional().describe(
      'Rotation track in degrees, clockwise: absolute, or "+15"/"-15" relative to options.rotation.'
    ),
    opacity: TrackSchema.optional().describe('Opacity track 0..1, multiplied with options.opacity.'),
  })
  .strict()
  .describe(
    'Keyframe tracks for the layer, times in section seconds. Each key eases into the next. A track ' +
      'overrides the same property of options.motion (x/y over a rise or slide, opacity over a fade). ' +
      'scale/scaleX/scaleY/rotate need the layer box: an html layer, or options.scale as "W:H" pixels.'
  )
  .meta({ id: 'LayerAnimate' });

export type LayerAnimate = z.infer<typeof LayerAnimateSchema>;
export type LayerOrigin = (typeof LAYER_ORIGINS)[number];
