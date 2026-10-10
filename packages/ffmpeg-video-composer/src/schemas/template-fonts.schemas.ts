import { z } from 'zod';
import { TEMPLATE_FONT_MAX_BYTES, TEMPLATE_FONTS_MAX } from '../core/html/template-fonts';

// A font face the template brings for its HTML layers (core/html/template-fonts.ts). Read locally or from a
// data URI, never fetched: a URL is refused here rather than at render time.
export const TemplateFontSchema = z
  .object({
    family: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[^,;{}"'<>]+$/, 'a font family name cannot contain , ; { } quotes or angle brackets')
      .describe(
        'The CSS family name HTML layers select it by (font-family: "Ubuntu"); it wins over a bundled family of the same name.'
      ),
    src: z
      .string()
      .min(1)
      .refine((src) => !/^[a-z][a-z0-9+.-]*:\/\//i.test(src), {
        message: 'fonts are never fetched: src is a local path or a data: URI, not a URL',
      })
      .describe(
        "The font file: a path relative to the template's font roots (the CLI: the template's directory, then " +
          '--fonts; the MCP server: --fonts-dir) or the assets dir, an absolute path inside one of them, or a ' +
          `base64 data: URI. TrueType (.ttf), OpenType (.otf) or WOFF (.woff), at most ${TEMPLATE_FONT_MAX_BYTES / (1024 * 1024)} MB; ` +
          'WOFF2 is refused (convert it to .ttf first).'
      ),
    weight: z
      .number()
      .int()
      .min(100)
      .max(900)
      .multipleOf(100, { message: 'weight must be a multiple of 100' })
      .optional()
      .describe('The weight this face is used for, 100..900 (default: the weight the file itself declares).'),
    style: z.enum(['normal', 'italic']).optional().describe('The style this face is used for (default normal).'),
  })
  .strict()
  .describe('A font face an HTML layer can select by family.');

export const TemplateFontsSchema = z
  .array(TemplateFontSchema)
  .max(TEMPLATE_FONTS_MAX)
  .describe(
    'Font faces the template brings for its HTML layers ({ family, src, weight?, style? }, one entry per ' +
      'weight/style of a family). An HTML layer selects one with font-family in its css; it wins over a ' +
      'bundled family of the same name. Drawn text (drawtext, kinetic, captions) keeps the font registry. ' +
      'CSS @font-face is not supported: declare the face here.'
  );
