// Rules for the fonts a template brings (`global.fonts`, core/html/template-fonts.ts), read without opening a
// file (the Node entry opens them: html-node/template-fonts-node.ts):
//
// - font_woff2_unsupported: a src that is WOFF2 (Satori reads TrueType, OpenType and WOFF only).
// - font_format: a src that names no font format (neither .ttf, .otf, .woff nor a font data URI).
// - font_too_large: a data URI over the size limit.
// The font_unused advisory (a declared family no HTML layer selects) is in html-advisories.ts.

import {
  TEMPLATE_FONT_MAX_BYTES,
  WOFF2_CONVERT_HINT,
  declaredFontFormat,
  isFontDataUri,
  templateFontSpecs,
  type TemplateFontSpec,
} from '@/core/html/template-fonts';
import type { ValidationError } from './validation/types';

const LIMIT_MB = TEMPLATE_FONT_MAX_BYTES / (1024 * 1024);

function bag(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function srcError(spec: TemplateFontSpec, index: number): ValidationError | null {
  const path = `global.fonts[${index}].src`;
  const format = declaredFontFormat(spec.src);
  const where = isFontDataUri(spec.src) ? 'its data URI' : `"${spec.src}"`;

  if (format === 'woff2') {
    return {
      path,
      code: 'font_woff2_unsupported',
      message: `global.fonts[${index}] (${spec.family}): ${where} is WOFF2, which HTML layers cannot read`,
      hint: `${WOFF2_CONVERT_HINT.charAt(0).toUpperCase()}${WOFF2_CONVERT_HINT.slice(1)}.`,
      ...(!isFontDataUri(spec.src) && { suggestion: spec.src.replace(/\.woff2$/i, '.ttf') }),
      kind: 'judgement',
    };
  }

  if (format === 'unknown') {
    return {
      path,
      code: 'font_format',
      message: `global.fonts[${index}] (${spec.family}): ${where} is not a font file`,
      hint: 'Point src at a .ttf, .otf or .woff file, or a base64 data:font/ttf (or font/otf, font/woff) URI.',
      kind: 'judgement',
    };
  }

  if (isFontDataUri(spec.src) && Math.floor((spec.src.length * 3) / 4) > TEMPLATE_FONT_MAX_BYTES) {
    return {
      path,
      code: 'font_too_large',
      message: `global.fonts[${index}] (${spec.family}): its data URI is over the ${LIMIT_MB} MB limit for a template font`,
      hint: 'Subset the font to the scripts the template uses (e.g. pyftsubset), or point src at the file.',
      kind: 'judgement',
    };
  }

  return null;
}

/** The `global.fonts` errors a descriptor shows without opening any file. */
export function validateTemplateFonts(template: unknown): ValidationError[] {
  return templateFontSpecs(bag(template).global).flatMap((spec, index) => srcError(spec, index) ?? []);
}
