import { withEasingHint } from './easing-hint';
import { nearestKey } from './key-aliases';
import { allowedKeysAt, type UnknownKey } from './schema-walk';
import { formatOptions, nearest } from './suggest';
import type { ValidationError } from './types';

// The subset of a zod v4 issue this module reads. Kept structural so it also accepts the issue
// arrays older payloads carried in `error.message`.
export interface SchemaIssue {
  code?: unknown;
  path?: unknown;
  message?: unknown;
  values?: unknown[];
  keys?: string[];
  errors?: SchemaIssue[][];
  options?: unknown[];
  params?: Record<string, unknown>;
}

type Path = (string | number)[];

export type IssueSource = { issues?: unknown; message?: unknown };

// The issue array of a zod error, tolerating payloads that only carry it JSON-encoded in `message`.
export function zodIssues(error: IssueSource): SchemaIssue[] {
  if (Array.isArray(error.issues)) return error.issues as SchemaIssue[];

  if (!error.message || typeof error.message !== 'string') {
    return [{ path: ['zod_error_structure'], message: 'Invalid ZodError structure', code: 'invalid_zod_error' }];
  }

  try {
    const parsed: unknown = JSON.parse(error.message);

    if (Array.isArray(parsed) && parsed.every((entry) => entry !== null && typeof entry === 'object')) {
      return parsed as SchemaIssue[];
    }
  } catch {
    // Not JSON: fall through to the message itself.
  }

  return [{ path: [], message: error.message, code: 'zod_error' }];
}

function issuePath(issue: SchemaIssue): Path {
  return Array.isArray(issue.path) ? (issue.path as Path) : [];
}

// A branch that rejects the value's very shape: a type miss, or an enum branch handed an object.
function isRootTypeMismatch(issue: SchemaIssue, input: unknown): boolean {
  if (issuePath(issue).length > 0) return false;

  return (
    issue.code === 'invalid_type' || (issue.code === 'invalid_value' && input !== null && typeof input === 'object')
  );
}

function isRootEnumMiss(branch: SchemaIssue[]): boolean {
  return branch.length === 1 && branch[0].code === 'invalid_value' && issuePath(branch[0]).length === 0;
}

function enumMessage(values: unknown[]): string {
  return `Invalid option: expected one of ${formatOptions(values)}`;
}

// A failed union reports every branch's issues. Branches whose root type does not even match the
// data ("expected object, received string") are noise; of the rest, enum-only branches merge into one
// enum miss (`"fade" | … | "cut"`) and otherwise the branch with the fewest issues is the best guess
// at what the author meant. Returns undefined when no branch matches the data's type at all.
function bestBranch(branches: SchemaIssue[][], input: unknown): SchemaIssue[] | undefined {
  const viable = branches.filter((branch) => !branch.some((issue) => isRootTypeMismatch(issue, input)));

  if (viable.length === 0) return undefined;

  if (viable.every(isRootEnumMiss)) {
    const values = [...new Set(viable.flatMap((branch) => branch[0].values ?? []))];

    return [{ code: 'invalid_value', path: [], values, message: enumMessage(values) }];
  }

  return viable.reduce((best, branch) => (branch.length < best.length ? branch : best));
}

// Resolve union issues into the leaf issues inside them, with absolute paths.
function flattenIssues(issues: SchemaIssue[], prefix: Path, data: unknown): SchemaIssue[] {
  return issues.flatMap((issue) => {
    const path = [...prefix, ...issuePath(issue)];

    if (issue.code === 'invalid_union' && Array.isArray(issue.options) && issue.errors?.length === 0) {
      // A discriminated union whose discriminator matched no option: an enum miss on that key.
      return [{ code: 'invalid_value', path, values: issue.options, message: enumMessage(issue.options) }];
    }

    const branch = issue.code === 'invalid_union' ? bestBranch(issue.errors ?? [], valueAt(data, path)) : undefined;

    if (branch) return flattenIssues(branch, path, data);

    return prefix.length === 0 ? [issue] : [{ ...issue, path }];
  });
}

/** The value at `path` inside `data`, or undefined when the path leaves the data. */
export function valueAt(data: unknown, path: Path): unknown {
  return path.reduce<unknown>(
    (node, key) => (node !== null && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined),
    data
  );
}

function enumFinding(issue: SchemaIssue, path: string, data: unknown): ValidationError {
  const values = issue.values ?? [];
  const input = valueAt(data, issuePath(issue));
  const strings = values.filter((value): value is string => typeof value === 'string');
  const suggestion = typeof input === 'string' ? nearest(input, strings) : undefined;
  const finding: ValidationError = {
    path,
    message: typeof issue.message === 'string' ? issue.message : enumMessage(values),
    code: 'invalid_value',
    hint: `Use one of: ${formatOptions(values)}.`,
    kind: suggestion === undefined ? 'judgement' : 'format',
  };

  return suggestion === undefined ? finding : { ...finding, suggestion };
}

/**
 * One `unknown_key` finding, with the nearest allowed key as its suggestion when there is one. `holder`
 * is the object carrying the key: when the suggested key is already set there, renaming would overwrite
 * it, so the fix needs the author (`judgement`) rather than being safe to apply.
 */
export function unknownKeyFinding(
  objectPath: string,
  key: string,
  allowed: string[] | undefined,
  holder?: unknown
): ValidationError {
  const suggestion = allowed ? nearestKey(key, allowed) : undefined;
  const where = objectPath ? ` in ${objectPath}` : '';
  const path = objectPath ? `${objectPath}.${key}` : key;

  if (suggestion !== undefined) {
    const taken = holder !== null && typeof holder === 'object' && Object.hasOwn(holder, suggestion);

    return {
      path,
      message: `Unknown key "${key}"${where} — did you mean "${suggestion}"?`,
      code: 'unknown_key',
      hint: taken
        ? `"${suggestion}" is already set: merge "${key}" into it or remove "${key}".`
        : `Rename "${key}" to "${suggestion}".`,
      suggestion,
      kind: taken ? 'judgement' : 'format',
    };
  }

  const listed = allowed ? ` (allowed keys: ${formatOptions(allowed)})` : '';

  return {
    path,
    message: `Unknown key "${key}"${where}`,
    code: 'unknown_key',
    hint: `Remove "${key}"${listed}.`,
    kind: 'judgement',
  };
}

function issueFindings(issue: SchemaIssue, data: unknown, unknownKeys: UnknownKey[]): ValidationError[] {
  const path = Array.isArray(issue.path) ? issue.path.join('.') : 'unknown';

  if (issue.code === 'unrecognized_keys') {
    const holder = valueAt(data, issuePath(issue));

    return (issue.keys ?? []).map((key) => unknownKeyFinding(path, key, allowedKeysAt(unknownKeys, path, key), holder));
  }

  if (issue.code === 'invalid_value') return [enumFinding(issue, path, data)];

  const finding: ValidationError = {
    path,
    message: typeof issue.message === 'string' ? issue.message : 'Unknown validation error',
    code: typeof issue.code === 'string' ? issue.code : 'unknown',
  };

  return [issue.params?.easing === true ? withEasingHint(finding, valueAt(data, issuePath(issue))) : finding];
}

/** Zod issues as findings: unions resolved to their best branch, enum misses and unknown keys suggested. */
export function zodIssueFindings(
  issues: SchemaIssue[],
  data: unknown,
  unknownKeys: UnknownKey[] = []
): ValidationError[] {
  return flattenIssues(issues, [], data).flatMap((issue) => issueFindings(issue, data, unknownKeys));
}

/**
 * The descriptor's top level is an envelope: hosts carry their own fields there (`metadata`, `id`, …)
 * and the engine ignores them. An unknown top-level key is only reported when it is a likely typo of a
 * real one ("section", "globals"); nested objects are always checked in full.
 */
export function withoutHostFields(found: UnknownKey[]): UnknownKey[] {
  return found.filter((entry) => entry.path.length > 0 || nearestKey(entry.key, entry.allowed) !== undefined);
}

/**
 * Drops repeats of the same finding, keeping the first (richest). An unknown key is one finding per path
 * (zod and the schema walk both report it); any other code also needs the same message, so two distinct
 * refinements failing at one path both survive.
 */
export function dedupeFindings(findings: ValidationError[]): ValidationError[] {
  const seen = new Set<string>();

  return findings.filter((finding) => {
    const id =
      finding.code === 'unknown_key'
        ? `${finding.code}\u0000${finding.path}`
        : `${finding.code}\u0000${finding.path}\u0000${finding.message}`;

    if (seen.has(id)) return false;
    seen.add(id);

    return true;
  });
}
