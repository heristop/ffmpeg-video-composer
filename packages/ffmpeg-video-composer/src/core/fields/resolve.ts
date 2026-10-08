import type { TemplateField } from '../../schemas/fields.schemas';
import { coerceFieldValue, probeValue, type FieldCoercers, type FieldValue } from './coerce';
import { declaredFields, declaresFields, hasEmptyValue } from './declared';
import { settleSlotTypes, type SlotCandidate } from './slot-types';
import { escapeHtml } from '../html/html-entities';

// Typed field resolution: each declared field's value (provided, else its default) is coerced by its type,
// then every `{{ name }}` of a declared field is filled across the descriptor. A placeholder that is the
// whole string takes the typed value (a number lands in a numeric slot as a number); one inside a longer
// string is interpolated as text through `encode`. Placeholders of undeclared names (variables, form fields
// without a declaration, partial variables) are left for the later passes. A whole-string placeholder whose
// slot only takes the other form (a number in a text slot) gets that form (slot-types.ts). Substituted text is
// never re-scanned, and the resolved descriptor no longer carries `global.fields` (the contract is consumed),
// so resolving a resolved descriptor is a no-op. A field value with filtergraph separators is refused in a raw
// filter value (`filters[].values.fontsize`); text belongs in text slots.
//
// Strict (default): a value that fails its type, or a required one that is missing, is an issue and its
// placeholders stay. Probe (`probe: true`, validation without values): such a field gets a stand-in of its
// type instead, so the rest of the template can still be validated; the issue is still reported.

export type FieldIssueCode = 'field_type_mismatch' | 'field_missing_required';

export interface FieldIssue {
  field: string;
  code: FieldIssueCode;
  message: string;
  hint: string;
}

/** One placeholder of a declared field, at a dotted path (`sections.0.options.duration`). */
export interface FieldSubstitution {
  path: string;
  field: string;
  /** The placeholder was the whole string, so the slot received the typed value. */
  whole: boolean;
}

export interface ResolveFieldsOptions {
  probe?: boolean;
  coercers?: FieldCoercers;
  /** How a value is written into a longer string (default String). */
  encode?: (value: FieldValue, field: TemplateField) => string;
}

export interface ResolvedFields<T> {
  descriptor: T;
  values: Record<string, FieldValue>;
  substitutions: FieldSubstitution[];
  issues: FieldIssue[];
}

type Provided = Readonly<Record<string, unknown>> | undefined;
type Path = ReadonlyArray<string | number>;

function owns(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g;
const WHOLE_PLACEHOLDER = /^\{\{\s*(\w+)\s*\}\}$/;

// A value counts as given unless it is missing or blank (whitespace-only text is empty, as in the web form).
function isBlank(raw: unknown): boolean {
  return raw === undefined || (typeof raw === 'string' && raw.trim() === '');
}

function providedValue(field: TemplateField, provided: Provided): { raw: unknown; fromDefault: boolean } {
  const raw = provided && owns(provided, field.name) ? provided[field.name] : undefined;

  return isBlank(raw) ? { raw: field.default, fromDefault: true } : { raw, fromDefault: false };
}

function missingIssue(field: TemplateField): FieldIssue {
  const why = field.required ? 'is required' : `has no default (a ${field.type} field cannot be left empty)`;

  return {
    field: field.name,
    code: 'field_missing_required',
    message: `Field "${field.name}" ${why} and no value was given`,
    hint: `Give "${field.name}" a default, or pass a value (leclap render --set ${field.name}=…, MCP fields).`,
  };
}

function mismatchIssue(field: TemplateField, reason: string, fromDefault: boolean): FieldIssue {
  const source = fromDefault ? 'default' : 'value';

  return {
    field: field.name,
    code: 'field_type_mismatch',
    message: `Field "${field.name}" (${field.type}): the ${source} does not fit — ${reason}`,
    hint: fromDefault
      ? `Change the default of "${field.name}" to a valid ${field.type}.`
      : `Pass a valid ${field.type}.`,
  };
}

interface FieldOutcome {
  value?: FieldValue;
  issue?: FieldIssue;
}

function fallback(field: TemplateField, issue: FieldIssue, probe: boolean): FieldOutcome {
  const stand = probe ? probeValue(field) : null;

  return stand === null ? { issue } : { value: stand, issue };
}

function fieldOutcome(field: TemplateField, provided: Provided, options: ResolveFieldsOptions): FieldOutcome {
  const { raw, fromDefault } = providedValue(field, provided);
  const probe = options.probe ?? false;

  if (raw === undefined) {
    if (!field.required && hasEmptyValue(field)) return { value: '' };

    return fallback(field, missingIssue(field), probe);
  }

  const coerced = coerceFieldValue(field, raw, options.coercers);

  if (coerced.ok) return { value: coerced.value };

  return fallback(field, mismatchIssue(field, coerced.reason, fromDefault), probe);
}

interface Walk {
  declared: ReadonlyMap<string, TemplateField>;
  values: Readonly<Record<string, FieldValue>>;
  encode: (value: FieldValue, field: TemplateField) => string;
  substitutions: FieldSubstitution[];
  candidates: SlotCandidate[];
  unsafe: Map<string, FieldIssue>;
}

// Filtergraph syntax: a value carrying any of these could close the option or the filter and start another.
// Control characters (newlines, NUL…) end an argument just as well.
const FILTERGRAPH_UNSAFE = /[,;:'"[\]\\=\p{Cc}]/u;

function hasFiltergraphSyntax(text: string): boolean {
  return FILTERGRAPH_UNSAFE.test(text);
}
const NUMERIC_TEXT = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;

// `…filters.<n>.values.<key>` with a key other than drawtext's text: forwarded to FFmpeg as it is written.
function isRawFilterValue(path: Path): boolean {
  const at = path.findIndex(
    (key, index) => key === 'values' && typeof path[index - 1] === 'number' && path[index - 2] === 'filters'
  );
  const key = at < 0 ? undefined : path[at + 1];

  return key !== undefined && key !== 'text' && key !== 'textExpr';
}

function unsafeIssue(field: TemplateField, path: Path): FieldIssue {
  return {
    field: field.name,
    code: 'field_type_mismatch',
    message: `Field "${field.name}" (${field.type}): its value cannot go into the raw filter value ${path.join('.')} — it carries filtergraph separators (, ; : ' [ ] = \\)`,
    hint: `Pass a plain value for "${field.name}", or place the field in a text slot (filters[].values.text, titleCard, reveal).`,
  };
}

// The value a placeholder writes at `path`, or null to leave the placeholder (no value, or unsafe there).
function slotValue(name: string, path: Path, walk: Walk): FieldValue | null {
  const field = walk.declared.get(name);

  if (!field || !owns(walk.values, name)) return null;

  const value = walk.values[name];

  if (!isRawFilterValue(path) || !hasFiltergraphSyntax(String(value))) return value;

  if (!walk.unsafe.has(name)) walk.unsafe.set(name, unsafeIssue(field, path));

  return null;
}

function otherForm(value: FieldValue, field: TemplateField): FieldValue | null {
  if (typeof value === 'number') return String(value);

  return field.type === 'enum' && NUMERIC_TEXT.test(value) ? Number(value) : null;
}

function fillWhole(text: string, name: string, path: Path, walk: Walk): unknown {
  walk.substitutions.push({ path: path.join('.'), field: name, whole: true });

  const value = slotValue(name, path, walk);

  if (value === null) return text;

  const alternative = otherForm(value, walk.declared.get(name) as TemplateField);

  if (alternative !== null) walk.candidates.push({ path, alternative });

  return value;
}

// An HTML layer's markup (`inputs[n].html`): a value is text inside HTML, so it is always escaped, never
// placed whole, whatever the field's type.
function isHtmlSlot(path: Path): boolean {
  return path.at(-1) === 'html' && path.at(-3) === 'inputs';
}

function fillString(text: string, path: Path, walk: Walk): unknown {
  const whole = WHOLE_PLACEHOLDER.exec(text);
  const html = isHtmlSlot(path);

  if (whole && !html && walk.declared.has(whole[1])) return fillWhole(text, whole[1], path, walk);

  return text.replace(PLACEHOLDER, (match, name: string) => {
    const field = walk.declared.get(name);

    if (!field) return match;

    walk.substitutions.push({ path: path.join('.'), field: name, whole: false });

    const value = slotValue(name, path, walk);

    if (value === null) return match;

    return html ? escapeHtml(String(value)) : walk.encode(value, field);
  });
}

function isDeclarations(path: Path, key: string): boolean {
  return path.length === 1 && path[0] === 'global' && key === 'fields';
}

function fill(node: unknown, path: Path, walk: Walk): unknown {
  if (typeof node === 'string') return fillString(node, path, walk);

  if (Array.isArray(node)) return node.map((item, index) => fill(item, [...path, index], walk));

  if (node === null || typeof node !== 'object') return node;

  // The declarations are consumed: dropped from the resolved descriptor, never rewritten.
  return Object.fromEntries(
    Object.entries(node)
      .filter(([key]) => !isDeclarations(path, key))
      .map(([key, value]) => [key, fill(value, [...path, key], walk)])
  );
}

export function resolveFields<T>(
  descriptor: T,
  provided?: Provided,
  options: ResolveFieldsOptions = {}
): ResolvedFields<T> {
  if (!declaresFields(descriptor)) return { descriptor, values: {}, substitutions: [], issues: [] };

  const fields = declaredFields((descriptor as { global?: unknown }).global);
  const values: Record<string, FieldValue> = {};
  const issues: FieldIssue[] = [];

  for (const field of fields) {
    const outcome = fieldOutcome(field, provided, options);

    if (outcome.value !== undefined) values[field.name] = outcome.value;

    if (outcome.issue) issues.push(outcome.issue);
  }

  const walk: Walk = {
    declared: new Map(fields.map((field) => [field.name, field])),
    values,
    encode: options.encode ?? ((value) => String(value)),
    substitutions: [],
    candidates: [],
    unsafe: new Map(),
  };
  const filled = fill(descriptor, [], walk);

  settleSlotTypes(filled, walk.candidates);

  return {
    descriptor: filled as T,
    values,
    substitutions: walk.substitutions,
    issues: [...issues, ...walk.unsafe.values()],
  };
}

export class FieldResolutionError extends Error {
  constructor(readonly issues: FieldIssue[]) {
    super(`Template fields: ${issues.map((issue) => issue.message).join('; ')}`);
    this.name = 'FieldResolutionError';
  }
}

/** Strict resolution for a render: the resolved descriptor, or a FieldResolutionError naming every issue. */
export function assertFieldsResolved<T>(descriptor: T, provided?: Provided, options: ResolveFieldsOptions = {}): T {
  const resolved = resolveFields(descriptor, provided, { ...options, probe: false });

  if (resolved.issues.length > 0) throw new FieldResolutionError(resolved.issues);

  return resolved.descriptor;
}
