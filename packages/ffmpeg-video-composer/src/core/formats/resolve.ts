// One story, several formats: resolves a descriptor for ONE output format, before any other pass
// (after partial expansion; before theme, motion tokens and time references). In order:
//   1. every `$format` marker of the authored descriptor resolves to the format's value;
//   2. `formats[format]` is deep-merged over `global` and over the sections it names (core/formats/merge.ts);
//   3. markers the patch itself carried resolve; `formats` is dropped; `global.orientation` becomes the format.
// A descriptor with neither `formats` nor a marker is returned untouched (same object), so templates that
// do not use formats lower to byte-identical filtergraphs.

import { effectiveOrientation } from '../platforms';
import {
  FORMAT_NAMES,
  containsMarker,
  isFormatName,
  isPlainObject,
  joinPath,
  markerFormats,
  resolveMarkers,
  type FormatName,
} from './marker';
import { mergePatch, removes, unknownTarget, withoutRemove, type PatchContext } from './merge';
import type { ValidationError } from '../../services/validation/types';

type Loose = Record<string, unknown>;

const OVERRIDE_KEYS = ['global', 'sections'];

export interface FormatResolution<T> {
  descriptor: T;
  format: FormatName;
  issues: ValidationError[];
}

/** Whether the descriptor declares `formats` or writes any `$format` marker. */
export function usesFormats(descriptor: unknown): boolean {
  return isPlainObject(descriptor) && (descriptor.formats !== undefined || containsMarker(descriptor));
}

/** The format a descriptor renders when none is requested: global.orientation, the platform's, else landscape. */
export function baseFormat(descriptor: unknown): FormatName {
  const global = isPlainObject(descriptor) && isPlainObject(descriptor.global) ? descriptor.global : undefined;
  const orientation = effectiveOrientation({
    orientation: typeof global?.orientation === 'string' ? global.orientation : undefined,
    platform: typeof global?.platform === 'string' ? global.platform : undefined,
  });

  return isFormatName(orientation) ? orientation : 'landscape';
}

/** The formats a descriptor declares: its base format, every `formats` key and every format a marker names. */
export function declaredFormats(descriptor: unknown): FormatName[] {
  const formats = isPlainObject(descriptor) && isPlainObject(descriptor.formats) ? descriptor.formats : {};
  const named = markerFormats(descriptor);

  return FORMAT_NAMES.filter(
    (name) => name === baseFormat(descriptor) || Object.hasOwn(formats, name) || named.has(name)
  );
}

function shapeIssue(path: string, message: string, hint: string): ValidationError {
  return { path, message, code: 'format_override_invalid', hint, kind: 'judgement' };
}

/** The override for `format`, after checking the `formats` block's own shape. */
function overrideFor(formats: unknown, format: FormatName, issues: ValidationError[]): Loose | undefined {
  if (formats === undefined) return undefined;

  if (!isPlainObject(formats)) {
    issues.push(shapeIssue('formats', '"formats" must be an object keyed by format', 'Use { "portrait": { … } }.'));

    return undefined;
  }

  for (const key of Object.keys(formats).filter((name) => !isFormatName(name) && !name.startsWith('_'))) {
    issues.push(unknownTarget(joinPath('formats', key), 'format', key, [...FORMAT_NAMES]));
  }

  const override = formats[format];

  if (override === undefined) return undefined;

  if (!isPlainObject(override)) {
    issues.push(
      shapeIssue(`formats.${format}`, 'A format override must be an object', 'Use { "global": …, "sections": … }.')
    );

    return undefined;
  }

  for (const key of Object.keys(override).filter((name) => !OVERRIDE_KEYS.includes(name) && !name.startsWith('_'))) {
    issues.push(unknownTarget(`formats.${format}.${key}`, 'override key', key, OVERRIDE_KEYS));
  }

  return override;
}

function sectionName(section: unknown): string | undefined {
  return isPlainObject(section) && typeof section.name === 'string' ? section.name : undefined;
}

function patchSections(sections: unknown, patches: unknown, path: string, ctx: PatchContext): unknown {
  if (!isPlainObject(patches) || !Array.isArray(sections)) {
    if (patches !== undefined) {
      ctx.issues.push(shapeIssue(path, '"sections" must map section names to patches', 'Use { "<name>": { … } }.'));
    }

    return sections;
  }

  const known = sections.map(sectionName).filter((name): name is string => name !== undefined);

  for (const name of Object.keys(patches).filter((key) => !known.includes(key))) {
    ctx.issues.push(unknownTarget(joinPath(path, name), 'section', name, known));
  }

  return sections.flatMap((section) => {
    const name = sectionName(section);
    const patch = name !== undefined && Object.hasOwn(patches, name) ? patches[name] : undefined;

    if (patch === undefined || name === undefined) return [section];

    if (removes(patch)) return [];

    return isPlainObject(patch) ? [mergePatch(section, withoutRemove(patch), joinPath(path, name), ctx)] : [section];
  });
}

/** `descriptor` with one format override applied (global patch + section patches). */
export function applyOverride(
  descriptor: Loose,
  override: Loose,
  format: FormatName,
  issues: ValidationError[]
): Loose {
  const ctx: PatchContext = { issues };
  const path = `formats.${format}`;
  const patched: Loose = { ...descriptor };

  if (override.global !== undefined) {
    patched.global = mergePatch(descriptor.global, override.global, `${path}.global`, ctx);
  }

  if (override.sections !== undefined) {
    patched.sections = patchSections(descriptor.sections, override.sections, `${path}.sections`, ctx);
  }

  return patched;
}

function withFormatOrientation<T>(descriptor: T, format: FormatName): T {
  const loose = descriptor as Loose;
  const global = isPlainObject(loose.global) ? loose.global : {};

  return { ...loose, global: { ...global, orientation: format } } as T;
}

/**
 * The descriptor as it renders in `requested` (default: its base format). Untouched when it uses no
 * formats and no format is requested; orientation-only when it uses none but one is requested.
 */
export function resolveFormat<T>(descriptor: T, requested?: string): FormatResolution<T> {
  const issues: ValidationError[] = [];
  const format = isFormatName(requested) ? requested : baseFormat(descriptor);

  if (requested !== undefined && !isFormatName(requested)) {
    issues.push(shapeIssue('format', `Unknown format "${requested}"`, `Use one of ${FORMAT_NAMES.join(', ')}.`));
  }

  if (!usesFormats(descriptor)) {
    return {
      descriptor: requested === undefined ? descriptor : withFormatOrientation(descriptor, format),
      format,
      issues,
    };
  }

  const { formats, ...authored } = descriptor as Loose;
  const base = resolveMarkers(authored, format, '', issues) as Loose;
  const override = overrideFor(formats, format, issues);
  const merged = override ? applyOverride(base, override, format, issues) : base;
  const resolved = resolveMarkers(merged, format, `formats.${format}`, issues);

  return { descriptor: withFormatOrientation(resolved as T, format), format, issues };
}

/** resolveFormat for a build: a problem fails the build here, naming the field. */
export function resolveBuildFormat<T>(descriptor: T, format?: string): T {
  const { descriptor: resolved, issues } = resolveFormat(descriptor, format);

  if (issues.length > 0) {
    throw new Error(`Formats: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`);
  }

  return resolved;
}
