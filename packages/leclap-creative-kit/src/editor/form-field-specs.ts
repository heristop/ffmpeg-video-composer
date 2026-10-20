// Form fields and their typed contracts. The engine reads a field's type, default, required flag, help
// and choices from global.fields under the field's name; the builder edits them on the form field. The
// declaration itself rides verbatim in EditorState.motion.fields (motion-passthrough). On load each
// contract is folded onto the form field of that name; on save the form fields' contracts are written
// back over that declaration, in its own shape (a name map or a list), keeping every key the builder
// does not edit (min, max, maxLength, label) and every field no form asks for.
import type { TemplateDescriptor } from 'ffmpeg-video-composer/src/core/types.d.ts';
import { declaredFields } from 'ffmpeg-video-composer/src/core/fields/declared.ts';
import type { FieldsDeclaration, TemplateField } from 'ffmpeg-video-composer/src/schemas/fields.schemas.ts';
import type { EditorSection, EditorState, FormField, FormFieldType } from './model';

const FORM_TYPES: ReadonlySet<string> = new Set(['text', 'number', 'enum', 'url', 'color', 'time']);
const MANAGED = ['type', 'required', 'default', 'description', 'options'] as const;

type Spec = Omit<TemplateField, 'name'>;

function contractOnto(field: FormField, contract: TemplateField | undefined): FormField {
  if (!contract || !FORM_TYPES.has(contract.type)) return field;

  return {
    ...field,
    type: contract.type as FormFieldType,
    ...(contract.required === undefined ? {} : { required: contract.required }),
    ...(contract.default === undefined ? {} : { default: String(contract.default) }),
    ...(contract.description ? { help: contract.description } : {}),
    ...(contract.options ? { options: contract.options } : {}),
  };
}

// The editor sections with each form field's declared contract folded in.
export function bindFieldSpecs(sections: EditorSection[], global: TemplateDescriptor['global']): EditorSection[] {
  const byName = new Map(declaredFields(global).map((field) => [field.name, field]));

  return sections.map((section) => {
    if (section.kind !== 'form') return section;

    return { ...section, fields: section.fields.map((field) => contractOnto(field, byName.get(field.name))) };
  });
}

function hasContract(field: FormField): boolean {
  return (
    field.type !== undefined ||
    field.required !== undefined ||
    (field.default ?? '') !== '' ||
    (field.help ?? '').trim() !== '' ||
    (field.options?.length ?? 0) > 0
  );
}

function typedDefault(type: FormFieldType, value: string): string | number {
  const number = Number(value);

  return type === 'number' && value.trim() !== '' && Number.isFinite(number) ? number : value;
}

// The keys the builder edits, from the form field. A cleared default, help or choice list is absent.
function managedSpec(field: FormField): Spec {
  const type = field.type ?? 'text';
  const value = field.default ?? '';
  const help = (field.help ?? '').trim();
  const options = (field.options ?? []).map((option) => option.trim()).filter((option) => option !== '');

  // A contract makes an empty text field optional by default; keep the field required unless the
  // author said otherwise, so adding a help line never changes what the viewer must fill.
  return {
    type,
    required: field.required ?? true,
    ...(value === '' ? {} : { default: typedDefault(type, value) }),
    ...(help === '' ? {} : { description: help }),
    ...(type === 'enum' && options.length > 0 ? { options } : {}),
  };
}

// The declared spec with the managed keys replaced by the form field's.
function mergeSpec(existing: Spec | undefined, field: FormField): Spec {
  const kept = Object.fromEntries(
    Object.entries(existing ?? {}).filter(([key]) => !(MANAGED as readonly string[]).includes(key))
  );

  return { ...kept, ...managedSpec(field) };
}

function formFieldsWithContracts(state: EditorState): Map<string, FormField> {
  const fields = state.sections.flatMap((section) => (section.kind === 'form' ? section.fields : []));

  return new Map(fields.filter(hasContract).map((field) => [field.name, field]));
}

// Write the contracts into a declaration of either shape.
function writeContracts(declared: FieldsDeclaration | undefined, edited: Map<string, FormField>): FieldsDeclaration {
  if (Array.isArray(declared)) {
    const present = new Set(declared.map((field) => field.name));
    const updated = declared.map((field) => {
      const form = edited.get(field.name);

      return form ? { name: field.name, ...mergeSpec(field, form) } : field;
    });
    const added = [...edited.values()]
      .filter((field) => !present.has(field.name))
      .map((field) => ({ name: field.name, ...mergeSpec(undefined, field) }));

    return [...updated, ...added];
  }

  const record: Record<string, Spec> = { ...declared };

  for (const [name, field] of edited) record[name] = mergeSpec(record[name], field);

  return record;
}

// global.fields for the descriptor: the carried declaration with the form fields' contracts written in.
export function fieldSpecsGlobal(state: EditorState): Pick<NonNullable<TemplateDescriptor['global']>, 'fields'> {
  const declared = state.motion?.fields;
  const edited = formFieldsWithContracts(state);

  if (edited.size === 0) return declared === undefined ? {} : { fields: declared };

  return { fields: writeContracts(declared, edited) };
}
