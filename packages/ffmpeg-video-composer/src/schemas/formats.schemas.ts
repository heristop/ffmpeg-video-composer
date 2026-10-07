import { z } from 'zod';

// `formats`: one story, a separate composition per output orientation. Each entry is a deep-merge patch
// applied over the descriptor when that orientation renders (core/formats). The patch bodies are typed
// loosely here on purpose: a patch is only meaningful once merged, so the validator resolves each declared
// format and validates the merged descriptor itself, with the format named in every finding.

const PatchObjectSchema = z.record(z.string(), z.unknown());

export const FormatOverrideSchema = z
  .object({
    global: PatchObjectSchema.optional().describe(
      'Deep-merge patch over `global` for this format (e.g. { "platform": "tiktok" }). Objects merge key by ' +
        'key, arrays and scalars replace, null deletes a key.'
    ),
    sections: z
      .record(z.string(), PatchObjectSchema)
      .optional()
      .describe(
        'Patches keyed by an existing section name. Each is a deep-merge patch over that section; ' +
          '{ "remove": true } drops the whole section in this format. Arrays (kinetic, graphics, filters) are ' +
          'replaced entirely, or patched element by element with { "byId": { "<id>": { …patch… } } } where ' +
          '{ "remove": true } drops that element. Section names and order cannot change: one story per format.'
      ),
  })
  .strict()
  .describe('One orientation-specific composition: a patch over global and over named sections.');

export const FormatsSchema = z
  .object({
    landscape: FormatOverrideSchema.optional().describe('Applied when rendering 16:9.'),
    portrait: FormatOverrideSchema.optional().describe('Applied when rendering 9:16.'),
    square: FormatOverrideSchema.optional().describe('Applied when rendering 1:1.'),
  })
  .strict()
  .describe(
    'Per-format compositions of the same story: a vertical cut is recomposed, not cropped (fewer ' +
      'simultaneous elements, larger type, stronger vertical hierarchy; square: tighter type, shorter holds). ' +
      'The output orientation is the format: ProjectConfig.format / `leclap render --format` picks one, ' +
      'else global.orientation (or the global.platform default). Any value in the descriptor may also be ' +
      'written { "$format": { "landscape": v, "portrait": v, "square": v, "default": v } } and resolves to ' +
      'the rendering format (else default). Each declared format is validated separately.'
  );

export type FormatOverride = z.infer<typeof FormatOverrideSchema>;
export type TemplateFormats = z.infer<typeof FormatsSchema>;
