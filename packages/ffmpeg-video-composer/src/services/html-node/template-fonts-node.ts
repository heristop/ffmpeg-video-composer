// Node only: opens the files `global.fonts` declares, the way a render reads them (FilesystemNodeAdapter's
// readTemplateFont: the font dirs, then the assets dir, nothing else, never the network), and reports each one
// a render would fail on: font_not_found, font_unreadable, font_format, font_woff2_unsupported, font_too_large.
// Exported from the Node entry for `leclap validate` and the MCP server's validate_template.

import { declaredFontFormat, templateFontSpecs } from '@/core/html/template-fonts';
import { checkTemplateFonts } from '@/core/html/template-font-load';
import FilesystemNodeAdapter from '../../platform/filesystem/FilesystemNodeAdapter';
import type AbstractLogger from '../../platform/logging/AbstractLogger';
import type { ValidationError } from '../validation/types';

export interface TemplateFontCheckOptions {
  /** The assets dir a render reads (ProjectConfig.assetsDir). */
  assetsDir?: string;
  /** The font dirs a render reads first (ProjectConfig.fontDirs). */
  fontDirs?: string[];
}

const SILENT_LOGGER: AbstractLogger = { debug() {}, info() {}, warn() {}, error() {} };

const HINTS: Readonly<Record<string, string>> = {
  font_not_found:
    'Put the file next to the template or in a font dir (leclap --fonts <dir>, the MCP server --fonts-dir), or embed it as a data: URI.',
  font_unreadable: 'Check the file is a complete, readable font file.',
  font_format: 'Point src at a TrueType (.ttf), OpenType (.otf) or WOFF (.woff) file.',
  font_woff2_unsupported: 'Convert it to TrueType first and point src at the .ttf.',
  font_too_large: 'Subset the font to the scripts the template uses (e.g. pyftsubset).',
};

/** The `global.fonts` entries whose file a render could not use, as validation errors. */
export async function templateFontErrors(
  descriptor: unknown,
  options: TemplateFontCheckOptions = {}
): Promise<ValidationError[]> {
  const global =
    descriptor !== null && typeof descriptor === 'object' ? (descriptor as { global?: unknown }).global : undefined;
  const specs = templateFontSpecs(global);

  if (specs.length === 0) return [];

  const filesystem = new FilesystemNodeAdapter(SILENT_LOGGER);

  if (options.assetsDir) filesystem.setAssetsDir(options.assetsDir);

  filesystem.setFontDirs(options.fontDirs ?? []);

  const failures = await checkTemplateFonts(specs, (src) => filesystem.readTemplateFont(src));

  // A src whose name alone is wrong (.woff2, not a font) is already reported by the descriptor rules.
  return failures
    .filter(({ index }) => {
      const format = declaredFontFormat(specs[index].src);

      return format !== 'woff2' && format !== 'unknown';
    })
    .map(({ index, error }) => ({
      path: `global.fonts[${index}].src`,
      code: error.code,
      message: error.message,
      hint: HINTS[error.code],
      kind: 'judgement' as const,
    }));
}
