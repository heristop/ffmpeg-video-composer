// Locale-aware helpers for the author-supplied title/description strings carried by template
// sections as per-locale Translation maps ({ en: '…', fr: '…' }). Display sites must resolve to the
// viewer's current language instead of hard-coding English.

// Pick the string for `locale`, falling back to English, then to the first non-empty translation
// present. Single-locale templates (the common case) are unaffected.
export function resolveTranslation(
  translation: Record<string, string | undefined> | undefined,
  locale: string
): string | undefined {
  if (!translation) {
    return undefined;
  }

  return [translation[locale], translation[locale.split('-')[0]], translation.en, ...Object.values(translation)].find(
    Boolean
  );
}

// Replace `{{ name }}` placeholders in a description with their resolved values. Mirrors the core's
// VariableManager: array values join with ', ', and unknown tokens (no matching key) are left as-is.
export function resolveVariables(text: string, vars: Record<string, string | string[]>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) => {
    if (!Object.hasOwn(vars, name)) {
      return match;
    }

    const value = vars[name];

    return Array.isArray(value) ? value.join(', ') : value;
  });
}

// Build the variable map used to resolve `{{ tokens }}` in a section description, from a template's
// global variables, its colorsList (expanded to 1-indexed `color1..colorN`), and the user's form
// answers. Form answers win over global defaults for the same key.
export function buildDescriptionVars(
  variables: Record<string, string | string[]> | undefined,
  colorsList: string[] | undefined,
  formData?: Record<string, unknown>
): Record<string, string | string[]> {
  const vars: Record<string, string | string[]> = { ...variables };

  for (const [i, color] of (colorsList ?? []).entries()) {
    vars[`color${i + 1}`] = color;
  }

  for (const [key, value] of Object.entries(formData ?? {})) {
    if (Array.isArray(value)) {
      vars[key] = value.map(stringifyAnswer);

      continue;
    }

    vars[key] = stringifyAnswer(value);
  }

  return vars;
}

// Coerce a single form answer to a display string. Primitives stringify directly; null/undefined
// and non-primitive objects render empty rather than "[object Object]".
function stringifyAnswer(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return '';
}
