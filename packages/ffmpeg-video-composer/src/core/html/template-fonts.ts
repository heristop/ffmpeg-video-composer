// Fonts a template brings for its HTML layers (`global.fonts`): `{ family, src, weight?, style? }`, where `src`
// is a file the host resolves (relative to its font roots or the assets dir, never fetched over the network) or
// a `data:` URI. Satori and HarfBuzz read TrueType/OpenType only, so a WOFF file is unpacked to its sfnt here
// (the engine's own pure-JS inflate, on every host); WOFF2 is refused, with the command that converts it. Same bytes, same face:
// a loaded face is named by the hash of its sfnt, which is what names the layers drawn with it.

/** The largest font file a template may bring, in bytes (a full CJK face is bigger; brand Latin faces are far smaller). */
export const TEMPLATE_FONT_MAX_BYTES = 8 * 1024 * 1024;

/** The most faces `global.fonts` may declare. */
export const TEMPLATE_FONTS_MAX = 16;

export type TemplateFontFormat = 'ttf' | 'otf' | 'woff' | 'woff2';

export type TemplateFontErrorCode =
  | 'font_not_found'
  | 'font_unreadable'
  | 'font_format'
  | 'font_woff2_unsupported'
  | 'font_too_large';

export interface TemplateFontSpec {
  family: string;
  src: string;
  weight?: number;
  style?: 'normal' | 'italic';
}

/** A declared face as layout needs it: which family it serves, and the file name the rasteriser loads. */
export interface CustomFontFace {
  family: string;
  file: string;
  weight?: number;
  style?: 'normal' | 'italic';
}

/** A declared face loaded: its sfnt bytes, named `template-<hash>.ttf`. */
export interface TemplateFontFace extends CustomFontFace {
  data: Uint8Array;
}

export class TemplateFontError extends Error {
  readonly code: TemplateFontErrorCode;

  constructor(code: TemplateFontErrorCode, message: string) {
    super(message);
    this.name = 'TemplateFontError';
    this.code = code;
  }
}

/** The command that turns a WOFF2 file into a TrueType one Satori can read. */
export const WOFF2_CONVERT_HINT =
  'convert it to TrueType first, e.g. `fonttools ttLib.woff2 decompress Brand.woff2` (pip install fonttools ' +
  'brotli) or `woff2_decompress Brand.woff2`, and point src at the .ttf';

export const FONT_DATA_URI = /^data:([\w.+/-]*)(;[\w-]+=[\w.-]+)*;base64,/i;

/** The four bytes at `at` as an OpenType tag. */
export function fontTag(bytes: Uint8Array, at = 0): string {
  return bytes.byteLength < at + 4 ? '' : String.fromCodePoint(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
}

/** The container a font file is in, from its first bytes; null when it is not a font. */
export function fontFormatOf(bytes: Uint8Array): TemplateFontFormat | null {
  const signature = fontTag(bytes);

  if (signature === '\0\u0001\0\0' || signature === 'true') return 'ttf';

  if (signature === 'OTTO') return 'otf';

  if (signature === 'wOFF') return 'woff';

  if (signature === 'wOF2') return 'woff2';

  return null;
}

const MIME_FORMATS: Readonly<Partial<Record<string, TemplateFontFormat>>> = {
  'font/ttf': 'ttf',
  'font/sfnt': 'ttf',
  'application/x-font-ttf': 'ttf',
  'application/font-sfnt': 'ttf',
  'font/otf': 'otf',
  'application/x-font-opentype': 'otf',
  'font/woff': 'woff',
  'application/font-woff': 'woff',
  'font/woff2': 'woff2',
  'application/font-woff2': 'woff2',
};

/**
 * What a `src` says it holds, read without opening it: the extension of a path, the media type of a data
 * URI (`application/octet-stream` and an empty type say nothing: the bytes decide). `unknown` is neither a
 * font extension nor a font media type.
 */
export function declaredFontFormat(src: string): TemplateFontFormat | 'unknown' | null {
  if (isFontDataUri(src)) return dataUriFormat(src);

  const extension = /\.([a-z0-9]+)$/i.exec(src.split(/[?#]/)[0])?.[1].toLowerCase() ?? '';

  return FONT_EXTENSIONS.has(extension) ? (extension as TemplateFontFormat) : 'unknown';
}

const FONT_EXTENSIONS: ReadonlySet<string> = new Set(['ttf', 'otf', 'woff', 'woff2']);

function dataUriFormat(src: string): TemplateFontFormat | 'unknown' | null {
  const data = FONT_DATA_URI.exec(src);

  if (!data) return 'unknown';

  const mime = data[1].toLowerCase();

  if (mime === '' || mime === 'application/octet-stream') return null;

  return MIME_FORMATS[mime] ?? 'unknown';
}

/** Whether `src` is inline (`data:`) rather than a file the host resolves. */
export function isFontDataUri(src: string): boolean {
  return src.toLowerCase().startsWith('data:');
}

function bag(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** The well-formed `global.fonts` entries of a descriptor's global (the schema reports the rest). */
export function templateFontSpecs(global: unknown): TemplateFontSpec[] {
  const fonts = bag(global).fonts;

  if (!Array.isArray(fonts)) return [];

  return fonts.flatMap((entry): TemplateFontSpec[] => {
    const font = bag(entry);

    if (typeof font.family !== 'string' || typeof font.src !== 'string') return [];

    return [
      {
        family: font.family.trim(),
        src: font.src,
        ...(typeof font.weight === 'number' && { weight: font.weight }),
        ...((font.style === 'normal' || font.style === 'italic') && { style: font.style }),
      },
    ];
  });
}

/** The declared faces with a stand-in file each: enough to lay a layer out (which family wins), not to draw it. */
export function declaredFontFaces(specs: readonly TemplateFontSpec[]): CustomFontFace[] {
  return specs.map((spec, index) => ({
    family: spec.family,
    file: `global.fonts[${index}]`,
    ...(spec.weight !== undefined && { weight: spec.weight }),
    ...(spec.style !== undefined && { style: spec.style }),
  }));
}
