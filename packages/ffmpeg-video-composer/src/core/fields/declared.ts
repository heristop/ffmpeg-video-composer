import type { TemplateField } from '../../schemas/fields.schemas';

// `global.fields` as authored (a name → spec map or a `{ name, … }` list) normalised to one named list, in
// declaration order. Tolerant of unvalidated input: entries that are not objects are skipped.

type Bag = Record<string, unknown>;

function isBag(value: unknown): value is Bag {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function declaredFields(global: unknown): TemplateField[] {
  const fields = isBag(global) ? global.fields : undefined;

  if (Array.isArray(fields)) {
    return fields.filter((field): field is TemplateField => isBag(field) && typeof field.name === 'string');
  }

  if (!isBag(fields)) return [];

  return Object.entries(fields)
    .filter((entry): entry is [string, Bag] => isBag(entry[1]))
    .map(([name, spec]) => ({ name, ...spec }) as TemplateField);
}

/** Whether the descriptor declares a field contract at all (the opt-in for typed resolution and advisories). */
export function declaresFields(descriptor: unknown): boolean {
  return isBag(descriptor) && isBag(descriptor.global) && descriptor.global.fields !== undefined;
}

// Only text has a natural empty value; every other type needs a value or a default.
export function hasEmptyValue(field: TemplateField): boolean {
  return field.type === 'text';
}
