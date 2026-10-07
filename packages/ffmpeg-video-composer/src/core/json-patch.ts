// JSON Patch (RFC 6902) over JSON Pointers (RFC 6901): add, remove, replace, move, copy and test. Pure and
// platform-neutral; meant for agent-authored edits to a template, so every operation is validated
// (shape, pointer syntax, prototype-polluting segments, depth and size bounds) and the patch is
// all-or-nothing: it runs on a structuredClone and the caller's document is never mutated.

export type JsonPatchOperation =
  | { op: 'add'; path: string; value: unknown }
  | { op: 'remove'; path: string }
  | { op: 'replace'; path: string; value: unknown }
  | { op: 'move'; from: string; path: string }
  | { op: 'copy'; from: string; path: string }
  | { op: 'test'; path: string; value: unknown };

export type JsonPatchErrorCode =
  | 'invalid_patch'
  | 'invalid_operation'
  | 'invalid_pointer'
  | 'unsafe_pointer'
  | 'unsafe_value'
  | 'path_not_found'
  | 'test_failed'
  | 'too_many_operations';

/** A rejected patch: `index` is the failing operation (-1 for the patch as a whole), `path` its target. */
export class JsonPatchError extends Error {
  constructor(
    readonly code: JsonPatchErrorCode,
    readonly index: number,
    readonly path: string,
    detail: string
  ) {
    super(index < 0 ? detail : `operation ${index} (${path || '(root)'}): ${detail}`);
    this.name = 'JsonPatchError';
  }
}

export interface ApplyJsonPatchOptions {
  /** Most operations accepted in one patch (default 1000). */
  maxOps?: number;
}

/** Deepest pointer, and deepest / largest inserted value, a patch may carry. */
export const JSON_PATCH_MAX_DEPTH = 64;
const MAX_VALUE_NODES = 20000;
const DEFAULT_MAX_OPS = 1000;
const RESERVED_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);
const ARRAY_INDEX = /^(0|[1-9]\d*)$/;
const OPS = new Set(['add', 'remove', 'replace', 'move', 'copy', 'test']);
const VALUE_OPS = new Set(['add', 'replace', 'test']);

type Container = Record<string, unknown> | unknown[];
interface Ctx {
  index: number;
  path: string;
}
interface State {
  doc: unknown;
}

function fail(ctx: Ctx, code: JsonPatchErrorCode, detail: string): never {
  throw new JsonPatchError(code, ctx.index, ctx.path, detail);
}

function isContainer(value: unknown): value is Container {
  return value !== null && typeof value === 'object';
}

function unescapeSegment(segment: string, ctx: Ctx): string {
  if (/~(?![01])/.test(segment)) fail(ctx, 'invalid_pointer', `invalid escape in "${segment}" (use ~0 or ~1)`);

  return segment.replaceAll('~1', '/').replaceAll('~0', '~');
}

function pointerTokens(pointer: string, ctx: Ctx): string[] {
  if (pointer === '') return [];

  if (!pointer.startsWith('/')) fail(ctx, 'invalid_pointer', `pointer "${pointer}" must be empty or start with "/"`);
  const tokens = pointer
    .slice(1)
    .split('/')
    .map((segment) => unescapeSegment(segment, ctx));

  if (tokens.length > JSON_PATCH_MAX_DEPTH) fail(ctx, 'invalid_pointer', `pointer deeper than ${JSON_PATCH_MAX_DEPTH}`);
  const reserved = tokens.find((token) => RESERVED_SEGMENTS.has(token));

  if (reserved !== undefined) fail(ctx, 'unsafe_pointer', `reserved segment "${reserved}"`);

  return tokens;
}

/** Split an RFC 6901 pointer into unescaped reference tokens; throws JsonPatchError on bad or unsafe syntax. */
export function parsePointer(pointer: string): string[] {
  return pointerTokens(pointer, { index: -1, path: pointer });
}

function arrayIndex(key: string, length: number, allowEnd: boolean, ctx: Ctx): number {
  if (allowEnd && key === '-') return length;

  if (!ARRAY_INDEX.test(key)) fail(ctx, 'path_not_found', `"${key}" is not an array index`);
  const index = Number(key);

  if (index > (allowEnd ? length : length - 1)) fail(ctx, 'path_not_found', `index ${index} out of bounds (${length})`);

  return index;
}

function child(value: unknown, key: string, ctx: Ctx): unknown {
  if (Array.isArray(value)) return value[arrayIndex(key, value.length, false, ctx)];

  if (isContainer(value) && Object.hasOwn(value, key)) return (value as Record<string, unknown>)[key];

  return fail(ctx, 'path_not_found', `no member "${key}"`);
}

function resolve(doc: unknown, tokens: string[], ctx: Ctx): unknown {
  let current = doc;

  for (const token of tokens) current = child(current, token, ctx);

  return current;
}

function parentOf(doc: unknown, tokens: string[], ctx: Ctx): { container: Container; key: string } {
  const container = resolve(doc, tokens.slice(0, -1), ctx);

  if (!isContainer(container)) fail(ctx, 'path_not_found', 'parent is not an object or array');

  return { container, key: tokens.at(-1) ?? '' };
}

function addAt(state: State, tokens: string[], value: unknown, ctx: Ctx): void {
  if (tokens.length === 0) {
    state.doc = value;

    return;
  }
  const { container, key } = parentOf(state.doc, tokens, ctx);

  if (Array.isArray(container)) {
    container.splice(arrayIndex(key, container.length, true, ctx), 0, value);

    return;
  }
  container[key] = value;
}

function removeAt(state: State, tokens: string[], ctx: Ctx): unknown {
  if (tokens.length === 0) fail(ctx, 'invalid_operation', 'cannot remove the document root');
  const { container, key } = parentOf(state.doc, tokens, ctx);

  if (Array.isArray(container)) return container.splice(arrayIndex(key, container.length, false, ctx), 1)[0];

  if (!Object.hasOwn(container, key)) fail(ctx, 'path_not_found', `no member "${key}"`);
  const removed = container[key];
  delete container[key];

  return removed;
}

function replaceAt(state: State, tokens: string[], value: unknown, ctx: Ctx): void {
  if (tokens.length === 0) {
    state.doc = value;

    return;
  }
  const { container, key } = parentOf(state.doc, tokens, ctx);

  if (Array.isArray(container)) {
    container[arrayIndex(key, container.length, false, ctx)] = value;

    return;
  }

  if (!Object.hasOwn(container, key)) fail(ctx, 'path_not_found', `no member "${key}"`);
  container[key] = value;
}

function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;

  if (!isContainer(a) || !isContainer(b) || Array.isArray(a) !== Array.isArray(b)) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);

  if (keys.length !== Object.keys(right).length) return false;

  return keys.every((key) => Object.hasOwn(right, key) && jsonEqual(left[key], right[key]));
}

// Inserted values obey the same bounds as pointers: no reserved keys, bounded depth and node count.
function checkValue(value: unknown, ctx: Ctx): void {
  const pending = [{ value, depth: 0 }];
  let visited = 0;

  for (let next = pending.pop(); next; next = pending.pop()) {
    if (++visited > MAX_VALUE_NODES || next.depth > JSON_PATCH_MAX_DEPTH) fail(ctx, 'unsafe_value', 'value too large');

    if (!isContainer(next.value)) continue;

    for (const [key, item] of Object.entries(next.value)) {
      if (RESERVED_SEGMENTS.has(key)) fail(ctx, 'unsafe_value', `reserved key "${key}"`);
      pending.push({ value: item, depth: next.depth + 1 });
    }
  }
}

function readOperation(raw: unknown, ctx: Ctx): JsonPatchOperation {
  if (!isContainer(raw) || Array.isArray(raw)) fail(ctx, 'invalid_operation', 'operation must be an object');
  const record = raw;

  if (typeof record.path !== 'string') fail(ctx, 'invalid_operation', '"path" must be a string');
  ctx.path = record.path;
  const op = typeof record.op === 'string' ? record.op : '';

  if (!OPS.has(op)) fail(ctx, 'invalid_operation', `unknown op "${op}"`);

  if ((op === 'move' || op === 'copy') && typeof record.from !== 'string') {
    fail(ctx, 'invalid_operation', `"${op}" needs a string "from"`);
  }

  if (VALUE_OPS.has(op) && !Object.hasOwn(record, 'value')) fail(ctx, 'invalid_operation', `"${op}" needs a "value"`);

  return record as unknown as JsonPatchOperation;
}

function relocate(state: State, operation: { op: 'move' | 'copy'; from: string; path: string }, ctx: Ctx): void {
  const from = pointerTokens(operation.from, ctx);
  const to = pointerTokens(operation.path, ctx);

  if (operation.op === 'move' && operation.path.startsWith(`${operation.from}/`)) {
    fail(ctx, 'invalid_operation', `cannot move "${operation.from}" into its own child`);
  }
  const value = operation.op === 'move' ? removeAt(state, from, ctx) : structuredClone(resolve(state.doc, from, ctx));
  addAt(state, to, value, ctx);
}

function applyOperation(state: State, operation: JsonPatchOperation, ctx: Ctx): void {
  if (operation.op === 'move' || operation.op === 'copy') {
    relocate(state, operation, ctx);

    return;
  }
  const tokens = pointerTokens(operation.path, ctx);

  if (operation.op === 'remove') {
    removeAt(state, tokens, ctx);

    return;
  }
  checkValue(operation.value, ctx);

  if (operation.op === 'test') {
    if (!jsonEqual(resolve(state.doc, tokens, ctx), operation.value)) fail(ctx, 'test_failed', 'value differs');

    return;
  }
  const insert = operation.op === 'add' ? addAt : replaceAt;
  insert(state, tokens, structuredClone(operation.value), ctx);
}

/**
 * Apply an RFC 6902 patch to a JSON document and return the patched copy. Atomic: on the first failing
 * operation it throws a JsonPatchError (with that operation's index and path) and `doc` is untouched.
 */
export function applyJsonPatch<T>(doc: T, operations: readonly unknown[], options: ApplyJsonPatchOptions = {}): T {
  const whole: Ctx = { index: -1, path: '' };

  if (!Array.isArray(operations)) fail(whole, 'invalid_patch', 'a patch must be an array of operations');
  const maxOps = options.maxOps ?? DEFAULT_MAX_OPS;

  if (operations.length > maxOps) fail(whole, 'too_many_operations', `a patch may hold at most ${maxOps} operations`);
  const state: State = { doc: structuredClone(doc) };

  for (const [index, raw] of operations.entries()) {
    const ctx: Ctx = { index, path: '' };
    applyOperation(state, readOperation(raw, ctx), ctx);
  }

  return state.doc as T;
}
