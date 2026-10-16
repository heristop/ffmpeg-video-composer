// Import a brand-kit.json written by `leclap brand` or the MCP tool extract_brand: check its shape, then
// build the binding brand rules (theme, name, fonts). The builder can't fetch websites (CORS), so the kit
// comes in as a file; its logo stays out of the rules, the user adds it through the watermark upload.
// The file is untrusted and its text reaches an AI prompt, so its size, list lengths and font names are capped.
import { z } from 'zod';

/** A real kit is a few KB; past this the file is refused before it is read. */
export const MAX_BRAND_KIT_BYTES = 512 * 1024;
const MAX_LIST = 200;
const MAX_FONT_NAME = 80;

const fontName = z.string().transform((name) => name.slice(0, MAX_FONT_NAME));

const BrandKitFile = z.object({
  url: z.url({ protocol: /^https?$/ }),
  name: z.string().nullable(),
  colors: z
    .array(
      z.object({
        hex: z.string().regex(/^#[0-9a-f]{6}$/i),
        weight: z.number().nonnegative(),
        source: z.enum(['theme-color', 'custom-property', 'declaration']),
      })
    )
    .max(MAX_LIST),
  fonts: z.object({
    display: fontName.nullable(),
    body: fontName.nullable(),
    mono: fontName.nullable(),
    families: z.array(fontName).max(MAX_LIST),
  }),
  logo: z.unknown().nullable(),
});

const NOT_A_KIT = 'This isn’t a brand-kit.json (make one with `leclap brand <url>`).';
const TOO_LARGE = 'This file is too large to be a brand-kit.json.';

export async function importBrandKit(text: string): Promise<{ name: string; rules: string }> {
  if (text.length > MAX_BRAND_KIT_BYTES) throw new Error(TOO_LARGE);

  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(NOT_A_KIT);
  }

  const result = BrandKitFile.safeParse(parsed);

  if (!result.success) throw new Error(NOT_A_KIT);

  const { brandPromptRules, brandTheme, sanitizeBrandName } =
    await import('ffmpeg-video-composer/src/core/brand/index.ts');
  const kit = { ...result.data, logo: null };

  return {
    name: sanitizeBrandName(kit.name) ?? new URL(kit.url).hostname,
    rules: brandPromptRules(kit, brandTheme(kit)),
  };
}
