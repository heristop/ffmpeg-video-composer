import { z } from 'zod';

// A clip box: the element only shows inside it, on any background (footage included). Shared by kinetic
// blocks (`clip`) and image / animation / html layers (`options.clip`); lowered in editor/presets/clip-box.ts.

/** Bound of a box coordinate or size, px, like the other px fields. */
const MAX_PX = 20000;

export const ClipBoxSchema = z
  .object({
    x: z.number().min(-MAX_PX).max(MAX_PX).describe('Left edge in output px.'),
    y: z.number().min(-MAX_PX).max(MAX_PX).describe('Top edge in output px.'),
    w: z.number().positive().max(MAX_PX).describe('Width in output px.'),
    h: z.number().positive().max(MAX_PX).describe('Height in output px.'),
  })
  .strict()
  .describe('A box in output pixels; the element is cut to it.');

export const KineticClipSchema = z
  .union([z.enum(['block', 'line']), ClipBoxSchema])
  .describe(
    'Cut the block to a box, so it reveals as if from behind an invisible edge (rise out of a slot, drop ' +
      'from under a rule), on any background: "block" = its own resting box, "line" = each line its own box ' +
      '(each line rises out of its own slot), or { x, y, w, h } in px.'
  );

export type ClipBox = z.infer<typeof ClipBoxSchema>;
export type KineticClip = z.infer<typeof KineticClipSchema>;
