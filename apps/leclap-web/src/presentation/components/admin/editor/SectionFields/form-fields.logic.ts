// Pure rules behind the form panel: field ids derived from labels, id validation, where an answer is
// used on screen, and reordering.
import type { EditorSection, EditorState, FormField } from '../../templateEditorModel';

// The engine's field-name charset (fields.schemas FIELD_NAME_PATTERN): word characters only.
const FIELD_ID = /^\w+$/;

// "Your topic" -> "your_topic": lower-case ASCII words joined by underscores.
export function slugFieldId(label: string): string {
  return label
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\W+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// A slug free among `taken`: the label's slug, else field_<n>, suffixed _2, _3… when already used.
export function uniqueFieldId(label: string, taken: ReadonlySet<string>, position: number): string {
  const base = slugFieldId(label) || `field_${position}`;

  if (!taken.has(base)) return base;

  let suffix = 2;

  while (taken.has(`${base}_${suffix}`)) suffix += 1;

  return `${base}_${suffix}`;
}

// The id still follows its label (the author never typed one): it equals the label's slug, or the
// default a new field gets.
export function followsLabel(field: FormField, position: number): boolean {
  const slug = slugFieldId(field.label);

  return field.name === `field_${position}` || field.name === slug || field.name.startsWith(`${slug}_`);
}

export type FieldIdProblem = 'empty' | 'chars' | 'duplicate';

export function fieldIdProblem(name: string, others: readonly string[]): FieldIdProblem | null {
  if (name.trim() === '') return 'empty';

  if (!FIELD_ID.test(name)) return 'chars';

  return others.includes(name) ? 'duplicate' : null;
}

// Every form field name in the template, for uniqueness across form scenes.
export function allFieldNames(state: EditorState): string[] {
  return state.sections.flatMap((section) =>
    section.kind === 'form' ? section.fields.map((field) => field.name) : []
  );
}

// The scenes (1-based positions) whose content shows the field: any {{ name }} token in the scene.
export function scenesUsing(sections: EditorSection[], name: string): number[] {
  const token = new RegExp(String.raw`\{\{\s*${name.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)}\s*\}\}`);

  return sections.flatMap((section, index) =>
    section.kind !== 'form' && token.test(JSON.stringify(section)) ? [index + 1] : []
  );
}

// Move the field at `from` to `to`, clamped to the list.
export function moveField<T>(fields: readonly T[], from: number, to: number): T[] {
  const target = Math.max(0, Math.min(fields.length - 1, to));

  if (target === from || from < 0 || from >= fields.length) return [...fields];

  const next = [...fields];
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved);

  return next;
}
