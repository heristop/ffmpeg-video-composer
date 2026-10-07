// The deep-merge patch a format override applies (core/formats/resolve.ts):
//   - a plain object merges into a plain object key by key; `null` deletes the key;
//   - arrays and scalars replace the base value entirely;
//   - `{ "byId": { "<id>": patch } }` patches the base ARRAY element by element, matched on each element's
//     `id` (kinetic blocks, graphics, drawtext filters); `{ "remove": true }` drops that element;
//   - a `$format` marker replaces the base value (resolved afterwards, like any marker).
// Every problem (an unknown id, byId over a non-array) is reported, never silently ignored.

import { FORMAT_MARKER, isPlainObject, joinPath } from './marker';
import { referenceFinding } from '../../services/validation/reference-finding';
import type { ValidationError } from '../../services/validation/types';

export const BY_ID = 'byId';

export interface PatchContext {
  issues: ValidationError[];
}

function isById(patch: unknown): patch is { byId: Record<string, unknown> } {
  return isPlainObject(patch) && Object.keys(patch).length === 1 && isPlainObject(patch[BY_ID]);
}

function isMarker(patch: unknown): boolean {
  return isPlainObject(patch) && Object.hasOwn(patch, FORMAT_MARKER);
}

/** Whether a section/element patch removes its target. */
export function removes(patch: unknown): boolean {
  return isPlainObject(patch) && patch.remove === true;
}

/** The patch without its `remove` flag (never a field of a section or element). */
export function withoutRemove(patch: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(patch).filter(([key]) => key !== 'remove'));
}

/** A patch naming a target that does not exist (a section, an element id, a format…), with a did-you-mean. */
export function unknownTarget(path: string, kind: string, name: string, known: string[]): ValidationError {
  return referenceFinding(path, `No ${kind} "${name}" to patch`, `format_unknown_${kind.replaceAll(' ', '_')}`, {
    name,
    known,
    fix: `patch an existing ${kind} (${known.join(', ') || 'none'})`,
  });
}

function elementId(element: unknown): string | undefined {
  return isPlainObject(element) && typeof element.id === 'string' ? element.id : undefined;
}

function patchElement(element: unknown, patch: unknown, path: string, ctx: PatchContext): unknown[] {
  if (removes(patch)) return [];

  if (!isPlainObject(patch)) {
    ctx.issues.push({ path, message: 'A byId entry must be an object patch', code: 'format_patch_invalid' });

    return [element];
  }

  return [mergePatch(element, withoutRemove(patch), path, ctx)];
}

function patchById(base: unknown, byId: Record<string, unknown>, path: string, ctx: PatchContext): unknown {
  const byIdPath = joinPath(path, BY_ID);

  if (!Array.isArray(base)) {
    ctx.issues.push({
      path: byIdPath,
      message: '"byId" patches an array of elements with ids, but there is no array here',
      code: 'format_byid_not_array',
      hint: 'Replace the value instead, or point byId at kinetic, graphics or filters.',
    });

    return base;
  }

  const known = base.map(elementId).filter((id): id is string => id !== undefined);

  for (const id of Object.keys(byId).filter((name) => !known.includes(name))) {
    ctx.issues.push(unknownTarget(joinPath(byIdPath, id), 'id', id, known));
  }

  return base.flatMap((element) => {
    const id = elementId(element);

    return id !== undefined && Object.hasOwn(byId, id)
      ? patchElement(element, byId[id], joinPath(byIdPath, id), ctx)
      : [element];
  });
}

/** `base` with `patch` deep-merged over it (see the header for the exact semantics). Never mutates. */
export function mergePatch(base: unknown, patch: unknown, path: string, ctx: PatchContext): unknown {
  if (isById(patch)) return patchById(base, patch.byId, path, ctx);

  if (!isPlainObject(patch) || isMarker(patch)) return structuredClone(patch);

  const merged: Record<string, unknown> = isPlainObject(base) ? { ...base } : {};

  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete merged[key];
      continue;
    }

    merged[key] = mergePatch(merged[key], value, joinPath(path, key), ctx);
  }

  return merged;
}
