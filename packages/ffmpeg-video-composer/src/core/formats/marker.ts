// Responsive values: any descriptor value may be written `{ "$format": { "landscape": v, "portrait": v,
// "square": v, "default": v } }` and resolves to the value of the rendering format (else `default`). The
// marker is a single reserved key, so it never collides with an object-valued field: an object is a marker
// only when `$format` is its one key. Resolution is recursive (a chosen value may hold markers itself).

import type { PlatformOrientation } from '../platforms';
import type { ValidationError } from '../../services/validation/types';

export type FormatName = PlatformOrientation;

export const FORMAT_MARKER = '$format';

/** Every output format, in the order findings and multi-format renders list them. */
export const FORMAT_NAMES: readonly FormatName[] = ['landscape', 'portrait', 'square'];

const MARKER_KEYS: readonly string[] = [...FORMAT_NAMES, 'default'];

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isFormatName(value: unknown): value is FormatName {
  return typeof value === 'string' && (FORMAT_NAMES as readonly string[]).includes(value);
}

/** `parent.key` / `parent[index]`, matching the validator's own path spelling. */
export function joinPath(parent: string, key: string | number): string {
  if (typeof key === 'number') return `${parent}[${key}]`;

  return parent ? `${parent}.${key}` : key;
}

function hasMarkerKey(value: unknown): value is Record<string, unknown> {
  return isPlainObject(value) && Object.hasOwn(value, FORMAT_MARKER);
}

/** Every format a marker anywhere in `value` names explicitly (`default` excluded). */
export function markerFormats(value: unknown, found = new Set<FormatName>()): Set<FormatName> {
  if (Array.isArray(value)) {
    for (const item of value) markerFormats(item, found);

    return found;
  }

  if (!isPlainObject(value)) return found;

  const spec = hasMarkerKey(value) ? value[FORMAT_MARKER] : undefined;

  if (isPlainObject(spec)) {
    for (const key of Object.keys(spec)) if (isFormatName(key)) found.add(key);
  }

  for (const child of Object.values(value)) markerFormats(child, found);

  return found;
}

/** Whether any `$format` marker appears anywhere in `value`. */
export function containsMarker(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsMarker);

  if (!isPlainObject(value)) return false;

  return hasMarkerKey(value) || Object.values(value).some(containsMarker);
}

function markerIssue(path: string, message: string, code: string, hint: string): ValidationError {
  return { path, message, code, hint, kind: 'judgement' };
}

function chooseValue(
  marker: Record<string, unknown>,
  format: FormatName,
  path: string,
  issues: ValidationError[]
): unknown {
  const markerPath = joinPath(path, FORMAT_MARKER);
  const spec = marker[FORMAT_MARKER];

  if (Object.keys(marker).length > 1) {
    issues.push(
      markerIssue(
        path,
        'A "$format" marker must be the only key of its object',
        'format_marker_mixed',
        'Move the other keys inside each format value.'
      )
    );
  }

  if (!isPlainObject(spec)) {
    issues.push(
      markerIssue(
        markerPath,
        '"$format" expects { landscape?, portrait?, square?, default? }',
        'format_marker_invalid',
        'Write { "$format": { "landscape": …, "portrait": … } }.'
      )
    );

    return undefined;
  }

  for (const key of Object.keys(spec).filter((name) => !MARKER_KEYS.includes(name))) {
    issues.push(
      markerIssue(
        joinPath(markerPath, key),
        `Unknown format "${key}" in a "$format" marker`,
        'format_marker_invalid',
        `Use one of ${MARKER_KEYS.join(', ')}.`
      )
    );
  }

  const chosen = Object.hasOwn(spec, format) ? spec[format] : spec.default;

  if (chosen === undefined) {
    issues.push(
      markerIssue(
        markerPath,
        `No value for the ${format} format and no default`,
        'format_value_missing',
        `Add "${format}" or "default" to the marker.`
      )
    );
  }

  return chosen;
}

/**
 * `value` with every `$format` marker replaced by the value for `format`, recursively. Problems (no value
 * for the format, a mixed or malformed marker) are appended to `issues`, the field left undefined.
 */
export function resolveMarkers(value: unknown, format: FormatName, path: string, issues: ValidationError[]): unknown {
  if (Array.isArray(value)) {
    return value.map((item, index) => resolveMarkers(item, format, joinPath(path, index), issues));
  }

  if (!isPlainObject(value)) return value;

  if (hasMarkerKey(value)) return resolveMarkers(chooseValue(value, format, path, issues), format, path, issues);

  const entries = Object.entries(value).map(([key, child]) => [
    key,
    resolveMarkers(child, format, joinPath(path, key), issues),
  ]);

  // A marker with no value for this format leaves its field unset rather than `undefined`.
  return Object.fromEntries(entries.filter(([, child]) => child !== undefined));
}
