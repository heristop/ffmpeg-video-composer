// Validation of a descriptor that uses formats (`formats` or `$format` markers): each declared format (or
// the one requested) is resolved (core/formats) and validated as the descriptor it renders, and the
// findings merged, those only some formats raise naming them. On success `data` is the authored,
// partial-expanded descriptor (formats and markers kept), since that is what a render consumes.

import { declaredFormats, resolveFormat, usesFormats } from '@/core/formats/resolve';
import { mergeFormatFindings } from '@/core/formats/findings';
import type { FormatName } from '@/core/formats/marker';
import { expandPartialsSafe } from '@/core/partials';
import type { ValidationError } from './types';

interface Validated {
  success: boolean;
  errors?: ValidationError[];
}

export interface FormatValidationResult {
  success: boolean;
  errors: ValidationError[];
}

/** The formats to validate: the requested one, else every declared one. */
export function formatsToValidate(descriptor: unknown, requested?: string): string[] {
  return requested === undefined ? declaredFormats(descriptor) : [requested];
}

export function validateEachFormat(
  descriptor: unknown,
  requested: string | undefined,
  validate: (resolved: unknown) => Validated
): FormatValidationResult {
  const runs = formatsToValidate(descriptor, requested).map((name) => {
    const { descriptor: resolved, format, issues } = resolveFormat(descriptor, name);
    const result = issues.length > 0 ? { success: false, errors: issues } : validate(resolved);

    return { format, success: result.success, errors: result.errors ?? [] };
  });

  return {
    success: runs.every((run) => run.success),
    errors: mergeFormatFindings(runs.map((run) => [run.format, run.errors] as const)),
  };
}

// Formats patch sections by name after partial expansion, as the render does.
export function expandedForFormats(descriptor: unknown): unknown {
  const expansion = expandPartialsSafe(descriptor);

  return expansion.ok ? expansion.data : descriptor;
}

/**
 * Advisory findings of a descriptor, per format when it uses formats (merged as above), else one run on
 * the descriptor as is. Synchronous and asynchronous collectors alike.
 */
export async function adviseEachFormat<T extends { path: string; code: string; message: string }>(
  descriptor: unknown,
  collect: (resolved: unknown) => T[] | Promise<T[]>
): Promise<T[]> {
  if (!usesFormats(descriptor)) return collect(descriptor);

  const runs = await Promise.all(
    resolvedFormats(descriptor).map(async ([format, resolved]) => [format, await collect(resolved)] as const)
  );

  return mergeFormatFindings(runs);
}

// The formats that resolve cleanly, each with its resolved descriptor. A format that does not resolve is
// left out rather than counted with no findings, so it never makes the others' findings look format-specific.
function resolvedFormats(descriptor: unknown): (readonly [FormatName, unknown])[] {
  const expanded = expandedForFormats(descriptor);

  return declaredFormats(expanded).flatMap((format) => {
    const { descriptor: resolved, issues } = resolveFormat(expanded, format);

    return issues.length > 0 ? [] : [[format, resolved] as const];
  });
}

/** adviseEachFormat for a synchronous collector. */
export function adviseEachFormatSync<T extends { path: string; code: string; message: string }>(
  descriptor: unknown,
  collect: (resolved: unknown) => T[]
): T[] {
  if (!usesFormats(descriptor)) return collect(descriptor);

  return mergeFormatFindings(
    resolvedFormats(descriptor).map(([format, resolved]) => [format, collect(resolved)] as const)
  );
}
