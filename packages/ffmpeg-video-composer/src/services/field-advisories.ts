import { declaredFields, declaresFields, placeholderNames, resolveFields } from '@/core/fields';
import { referenceFinding } from './validation/reference-finding';
import type { ValidationError } from './validation/types';

// Advisories of the typed field contract (core/fields), on the template as authored. Opt-in: only a template
// that declares `global.fields` is checked, so one without keeps the plain undefined_variable advisory.
//   field_undefined         a {{ x }} that names no field, variable, form field nor partial variable
//   field_unused            a declared field nothing references (a form field of that name counts)
//   field_type_mismatch     a default (or a provided value) that does not fit the field's type
//   field_missing_required  a required field, or a non-text one, with neither a value nor a default

type Bag = Record<string, unknown>;

interface Scan {
  /** Every placeholder: its name and where it sits (`sections[0].filters[0].values.text.en`). */
  references: Array<{ name: string; path: string }>;
  /** Names a placeholder may legitimately use besides the declared fields. */
  known: Set<string>;
  /** Form field names (each one binds the declared field of the same name). */
  formFields: Set<string>;
}

function isBag(value: unknown): value is Bag {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collectNames(node: Bag, scan: Scan): void {
  if (isBag(node.variables)) {
    for (const key of Object.keys(node.variables)) scan.known.add(key);
  }

  const options = isBag(node.options) ? node.options : undefined;

  if (node.type !== 'form' || !Array.isArray(options?.fields)) return;

  for (const field of options.fields) {
    if (isBag(field) && typeof field.name === 'string') scan.formFields.add(field.name);
  }
}

function childPath(path: string, key: string | number): string {
  if (typeof key === 'number') return `${path}[${key}]`;

  return path ? `${path}.${key}` : key;
}

function walk(node: unknown, path: string, scan: Scan): void {
  if (typeof node === 'string') {
    for (const name of placeholderNames(node)) scan.references.push({ name, path });

    return;
  }

  if (Array.isArray(node)) {
    for (const [index, item] of node.entries()) walk(item, childPath(path, index), scan);

    return;
  }

  if (!isBag(node)) return;

  collectNames(node, scan);

  for (const [key, value] of Object.entries(node)) {
    if (path === 'global' && key === 'fields') continue;

    walk(value, childPath(path, key), scan);
  }
}

function scanTemplate(template: unknown): Scan {
  const scan: Scan = { references: [], known: new Set(), formFields: new Set() };

  walk(template, '', scan);

  return scan;
}

function undefinedFindings(scan: Scan, declared: Set<string>): ValidationError[] {
  const known = new Set([...declared, ...scan.known, ...scan.formFields]);

  return scan.references
    .filter((reference) => !known.has(reference.name))
    .map((reference) =>
      referenceFinding(reference.path, `{{ ${reference.name} }} names no declared field`, 'field_undefined', {
        name: reference.name,
        known: [...known],
        fix: `declare "${reference.name}" in global.fields`,
      })
    );
}

function unusedFindings(scan: Scan, declared: string[]): ValidationError[] {
  const used = new Set([...scan.references.map((reference) => reference.name), ...scan.formFields]);

  return declared
    .filter((name) => !used.has(name))
    .map((name) => ({
      path: `global.fields.${name}`,
      code: 'field_unused',
      message: `Field "${name}" is declared but never referenced`,
      hint: `Reference it as {{ ${name} }} or remove it from global.fields.`,
      kind: 'judgement' as const,
    }));
}

function valueFindings(template: unknown, values: Readonly<Record<string, unknown>> | undefined): ValidationError[] {
  return resolveFields(template, values, { probe: true }).issues.map((issue) => ({
    path: `global.fields.${issue.field}`,
    code: issue.code,
    message: issue.message,
    hint: issue.hint,
    kind: 'judgement' as const,
  }));
}

export function fieldAdvisories(template: unknown, values?: Readonly<Record<string, unknown>>): ValidationError[] {
  if (!declaresFields(template)) return [];

  const declared = declaredFields((template as { global?: unknown }).global).map((field) => field.name);
  const scan = scanTemplate(template);

  return [
    ...undefinedFindings(scan, new Set(declared)),
    ...unusedFindings(scan, declared),
    ...valueFindings(template, values),
  ];
}

export { declaresFields };

// The template as the advisories should read it: declared fields filled with their defaults (or a stand-in
// of their type), so a `{{ HOLD }}` duration is timed as the number it renders as. Same paths as authored.
export function withFieldDefaults<T>(template: T): T {
  return resolveFields(template, undefined, { probe: true }).descriptor;
}
