import { declaresFields, resolveFields, type FieldIssue, type ResolvedFields } from '@/core/fields';
import type { ValidationError } from './types';

// Validation of a template that declares `global.fields` (core/fields): the descriptor is validated as it
// renders, with every declared field filled in, so a number in a numeric slot passes and a value the slot
// rejects fails AT that slot, re-coded as a field finding. With `values` (a render's own inputs) the
// resolution is strict and a missing or ill-typed value is an error; without, missing values are probed
// (getFieldWarnings reports them) so a template can be validated before anyone fills it in. A probed
// descriptor is only ever checked: `data` is then the descriptor as authored (placeholders kept), so whoever
// renders it fills in the render's own values. With `values`, `data` is the resolved descriptor, its field
// contract consumed.

interface Validated {
  success: boolean;
  data?: unknown;
  errors?: ValidationError[];
}

type Values = Readonly<Record<string, unknown>>;

function issueError(issue: FieldIssue): ValidationError {
  return {
    path: `global.fields.${issue.field}`,
    message: issue.message,
    code: issue.code,
    hint: issue.hint,
    kind: 'judgement',
  };
}

// Findings about the template's shape, not about a value: never the field's doing.
const NON_VALUE_CODES = new Set([
  'unknown_key',
  'unrecognized_keys',
  'zod_error',
  'zod_parse',
  'invalid_zod_error',
  'format_error',
  'custom_validation_error',
  'validation_error',
]);

// `sections[0].options.x`, `template.sections[0]…` and `sections.0.options.x` all name the same slot.
function normalisePath(path: string): string {
  return path.replace(/\[(\d+)\]/g, '.$1').replace(/^template\./, '');
}

function covers(errorPath: string, slot: string): boolean {
  const path = normalisePath(errorPath);

  return path === slot || path.startsWith(`${slot}.`);
}

// The declared field whose placeholder filled the slot an error points at, if any.
function fieldOf(error: ValidationError, resolved: ResolvedFields<unknown>): string | undefined {
  if (NON_VALUE_CODES.has(error.code)) return undefined;

  return resolved.substitutions.find((entry) => covers(error.path, entry.path))?.field;
}

function retag(error: ValidationError, resolved: ResolvedFields<unknown>): ValidationError {
  const field = fieldOf(error, resolved);

  if (field === undefined) return error;

  const missing = !Object.prototype.hasOwnProperty.call(resolved.values, field);

  return {
    path: error.path,
    message: `Field "${field}" does not fit this slot: ${error.message}`,
    code: missing ? 'field_missing_required' : 'field_type_mismatch',
    hint: `Give "${field}" a value this slot accepts, or change the field's type.`,
    kind: 'judgement',
  };
}

export function validateWithFields<T extends Validated>(
  data: unknown,
  values: Values | undefined,
  validate: (resolved: unknown) => T
): T {
  if (!declaresFields(data)) return validate(data);

  const strict = values !== undefined;
  const resolved = resolveFields(data, values, { probe: !strict });
  const result = validate(resolved.descriptor);
  const issues = strict ? resolved.issues : [];
  // A field already reported (missing, ill-typed) is not reported again at each slot it left unfilled.
  const reported = new Set(issues.map((issue) => issue.field));
  const slotErrors = (result.errors ?? []).map((error) => retag(error, resolved));
  const errors = [
    ...issues.map(issueError),
    ...slotErrors.filter((error) => !reported.has(fieldOf(error, resolved) ?? '')),
  ];

  const checked = errors.length > 0 ? { ...result, success: false, errors } : result;

  return strict || checked.data === undefined ? checked : { ...checked, data };
}
