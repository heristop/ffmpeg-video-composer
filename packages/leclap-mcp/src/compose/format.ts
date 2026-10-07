import { FORMAT_NAMES, expandPartialsSafe, resolveFormat, usesFormats, type FormatName } from 'ffmpeg-video-composer';
import { z } from 'zod';

// compose_video `format`: one story, several formats. The template is resolved to the requested
// format's composition (its `formats` override and `$format` values, after partial expansion) BEFORE
// validation, the descriptor guard and the render, so the guard checks exactly what renders: a format
// patch cannot slip a filter value past the media-dir sandbox.

export const formatArg = z
  .enum(FORMAT_NAMES as [FormatName, ...FormatName[]])
  .optional()
  .describe(
    'Output format to render (landscape | portrait | square): the template composition for that format ' +
      '(its `formats` override and `$format` values). Default: the template orientation.'
  );

type FormatResult<A> = A | { isError: true; content: [{ type: 'text'; text: string }] };

/**
 * The compose request as it renders: refused when its template no longer matches `expectedRevision`,
 * else with the template resolved to the requested format.
 */
export function prepareComposeTemplate<
  A extends { template: Record<string, unknown>; format?: string; expectedRevision?: string },
>(args: A, revisionOf: (template: Record<string, unknown>) => string): FormatResult<A> {
  if (args.expectedRevision && revisionOf(args.template) !== args.expectedRevision) {
    const text = 'revision_conflict: template changed; validate the current JSON first.';

    return { isError: true, content: [{ type: 'text', text }] };
  }

  return applyComposeFormat(args);
}

/** `args` with its template resolved to the requested format; unchanged when neither applies. */
export function applyComposeFormat<A extends { template: Record<string, unknown>; format?: string }>(
  args: A
): FormatResult<A> {
  if (args.format === undefined && !usesFormats(args.template)) return args;

  const expansion = expandPartialsSafe(args.template);
  const expanded = expansion.ok ? expansion.data : args.template;
  const { descriptor, issues } = resolveFormat(expanded as Record<string, unknown>, args.format);

  if (issues.length === 0) return { ...args, template: descriptor };

  const text = `Template format: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`;

  return { isError: true, content: [{ type: 'text', text }] };
}
