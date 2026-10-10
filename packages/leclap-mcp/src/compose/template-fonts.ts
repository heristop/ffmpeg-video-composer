import { templateFontErrors, type TemplateDescriptor, type ValidationError } from 'ffmpeg-video-composer';

import type { McpConfig } from '../config.js';

// The fonts a template brings (`global.fonts`) are read from the fonts dir (--fonts-dir) and the media dir
// only, the way compose_video's render reads them: the engine confines each src there by realpath and never
// fetches one. Checked up front so a missing or WOFF2 file fails the call with its path, before any section
// is encoded.

type FontConfig = Pick<McpConfig, 'mediaDir' | 'fontsDir'>;

/** ProjectConfig.fontDirs for a render: the fonts dir when one is configured (the media dir is the assets dir). */
export function fontDirsOf(config: FontConfig): string[] {
  return config.fontsDir ? [config.fontsDir] : [];
}

/**
 * Where a render reads local files: the media dir is its assets dir (its read-only library), and template
 * fonts also resolve in the fonts dir, first.
 */
export function mediaRoots(config: FontConfig): { assetsDir: string; fontDirs: string[] } {
  return { assetsDir: config.mediaDir, fontDirs: fontDirsOf(config) };
}

/** The `global.fonts` entries a render could not read, as validation errors. */
export function templateFontFindings(descriptor: TemplateDescriptor, config: FontConfig): Promise<ValidationError[]> {
  return templateFontErrors(descriptor, { assetsDir: config.mediaDir, fontDirs: fontDirsOf(config) });
}

type ToolError = { isError: true; content: [{ type: 'text'; text: string }] };

/**
 * A resolved descriptor passed on when its fonts can be read, else the tool error naming each one (with
 * the findings as structured content). A resolution that already failed passes through.
 */
export async function withReadableFonts<T extends { ok: true; descriptor: TemplateDescriptor } | ToolError>(
  resolved: T,
  config: FontConfig
): Promise<T | (ToolError & { structuredContent: { valid: false; errors: ValidationError[] } })> {
  if ('isError' in resolved) return resolved;

  const errors = await templateFontFindings(resolved.descriptor, config);

  if (errors.length === 0) return resolved;

  return {
    isError: true,
    content: [{ type: 'text', text: fontErrorsText(errors) }],
    structuredContent: { valid: false, errors },
  };
}

export function fontErrorsText(errors: ValidationError[]): string {
  return `Template fonts cannot be read:\n${errors.map((error) => `- ${error.message}${error.hint ? ` ${error.hint}` : ''}`).join('\n')}`;
}
