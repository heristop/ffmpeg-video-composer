// What an HTML layer's live preview needs from the template, React-free: the theme its `$color.*` /
// `$font.*` tokens resolve against, a value for each `{{ placeholder }}` (a field's default, a variable's
// value, a form field's label as a sample) and the names the inspector offers as insertable chips.
import type { EditorState } from '../../templateEditorModel';

export type HtmlFieldSource = 'field' | 'variable' | 'form';

export interface HtmlPreviewEnv {
  /** The descriptor `global` the engine reads (its theme). */
  global: { theme?: unknown };
  values: Record<string, string>;
  fields: { name: string; source: HtmlFieldSource }[];
}

type Declared = NonNullable<NonNullable<EditorState['motion']>['fields']>;

function declaredFields(fields: Declared | undefined): [string, string][] {
  if (!fields) return [];

  const entries = Array.isArray(fields)
    ? fields.map((field) => [field.name, field.default] as const)
    : Object.entries(fields).map(([name, field]) => [name, field.default] as const);

  return entries.map(([name, value]) => [name, value === undefined ? '' : String(value)]);
}

function formFields(state: EditorState): [string, string][] {
  return state.sections.flatMap((section) =>
    section.kind === 'form' ? section.fields.map((field): [string, string] => [field.name, field.label]) : []
  );
}

export function htmlPreviewEnv(state: EditorState): HtmlPreviewEnv {
  const groups: [HtmlFieldSource, [string, string][]][] = [
    ['field', declaredFields(state.motion?.fields)],
    ['variable', state.globalVariables.map((variable): [string, string] => [variable.name.trim(), variable.value])],
    ['form', formFields(state)],
  ];
  const values: Record<string, string> = {};
  const fields: HtmlPreviewEnv['fields'] = [];

  for (const [source, entries] of groups) {
    for (const [name, value] of entries) {
      if (name === '' || Object.hasOwn(values, name)) continue;

      values[name] = value;
      fields.push({ name, source });
    }
  }

  const theme = state.motion?.theme;

  return { global: theme === undefined ? {} : { theme }, values, fields };
}
