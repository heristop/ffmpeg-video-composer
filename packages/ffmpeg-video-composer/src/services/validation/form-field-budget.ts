import { declaredFields } from '@/core/fields';
import type { ValidationError } from './types';

// A form field's `maxLength` is its character budget, so a text input needs one. A form field bound to a
// declared non-text field (colour, number, enum, url, media, time) is asked through a typed control and
// the contract checks the value, so it may leave the budget out (the schema has it optional for this).

type Bag = Record<string, unknown>;

function isBag(value: unknown): value is Bag {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function typedNames(descriptor: Bag): Set<string> {
  return new Set(
    declaredFields(descriptor.global)
      .filter((field) => field.type !== 'text')
      .map((field) => field.name)
  );
}

function budgetError(path: string): ValidationError {
  return {
    path,
    message: 'Invalid input: expected number, received undefined',
    code: 'invalid_type',
    hint: 'Give this form field a maxLength (its character budget); only a field bound to a non-text global.fields entry may leave it out.',
  };
}

function sectionErrors(section: unknown, index: number, typed: Set<string>): ValidationError[] {
  const options = isBag(section) && section.type === 'form' && isBag(section.options) ? section.options : undefined;
  const fields = Array.isArray(options?.fields) ? options.fields : [];

  return fields.flatMap((field, at) => {
    if (!isBag(field) || field.maxLength !== undefined) return [];

    if (typeof field.name === 'string' && typed.has(field.name)) return [];

    return [budgetError(`sections.${index}.options.fields.${at}.maxLength`)];
  });
}

/** One finding per form field (of the expanded descriptor) that lacks the maxLength its text input needs. */
export function formFieldBudgetErrors(descriptor: unknown): ValidationError[] {
  if (!isBag(descriptor) || !Array.isArray(descriptor.sections)) return [];

  const typed = typedNames(descriptor);

  return descriptor.sections.flatMap((section, index) => sectionErrors(section, index, typed));
}
