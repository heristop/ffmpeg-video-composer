// The `{{ name }}` placeholder syntax shared by fields, variables, form fields and partial variables.
export const PLACEHOLDER_PATTERN = /\{\{\s*(\w+)\s*\}\}/g;

/** Every placeholder name in a string, in order (repeats kept). */
export function placeholderNames(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER_PATTERN)].map((match) => match[1]);
}
