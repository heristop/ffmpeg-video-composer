import { z } from 'zod';
import { ColorToken } from './color-token.schemas';

// Text-legibility and media-keying sugar, split out of effects.schemas to keep that file under the
// max-lines budget. Re-exported from effects.schemas so importers keep a single entry point.

// ── text effect (shadow / outline) ───────────────────────────────────────────────

// Drop shadow + outline for sugar text legibility over busy footage. The text preset
// (editor/presets/text.ts) lowers it to drawtext shadowx/shadowy/shadowcolor + borderw/bordercolor.
export const TextEffectSchema = z
  .object({
    shadow: z
      .union([
        z.boolean(),
        z
          .object({
            color: ColorToken.optional().describe('Shadow colour token, e.g. "#000000@0.6" (default #000000@0.6).'),
            dx: z.number().optional().describe('Horizontal shadow offset in pixels (default 2).'),
            dy: z.number().optional().describe('Vertical shadow offset in pixels (default 2).'),
          })
          .strict(),
      ])
      .optional()
      .describe('Drop shadow: true for the default soft black shadow, or an object to customise colour/offset.'),
    outline: z
      .union([
        z.boolean(),
        z
          .object({
            color: ColorToken.optional().describe('Outline colour token (default #000000).'),
            width: z.number().min(0).optional().describe('Outline width in pixels (default 2).'),
          })
          .strict(),
      ])
      .optional()
      .describe('Outline/border: true for a 2px black outline, or an object to customise colour/width.'),
  })
  .strict()
  .describe('Drop shadow and/or outline applied to sugar text for legibility on any background.');

// ── chroma key (background removal) ──────────────────────────────────────────────

// Keys out a solid screen colour (green/blue screen) and composites the clip over a solid background.
// Lowered by MapManager.addChromakeyComposite into a split → drawbox(bg) → colorkey → overlay graph
// that needs no extra input (the bg is painted from the clip itself), so stream indices never shift.
export const ChromaKeySchema = z
  .object({
    color: ColorToken.describe('Screen colour to remove as a CSS hex string, e.g. "#00FF00" for a green screen.'),
    similarity: z
      .number()
      .min(0.01)
      .max(1)
      .optional()
      .describe('How close a pixel must be to the key colour to be removed, 0.01..1 (default 0.3).'),
    blend: z.number().min(0).max(1).optional().describe('Softness of the keyed edge, 0..1 (default 0.1).'),
    background: ColorToken.optional().describe(
      'Solid colour composited behind the keyed clip (default: the section backgroundColor, else black).'
    ),
  })
  .strict()
  .describe('Background removal: keys out a solid screen colour and composites the clip over a solid colour.');
