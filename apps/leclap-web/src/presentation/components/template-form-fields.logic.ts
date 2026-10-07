// The builder form's typed fields: a form field named like a declared `global.fields` entry is bound to it
// (the contract owns the type, default and range; the form field keeps its label and character budget), and
// declared fields no form asks for are offered too. Pure, so the rules are testable without React.
import { coerceFieldValue, declaredFields } from '@/core/fields';
import type { TemplateField } from 'ffmpeg-video-composer/src/schemas/fields.schemas.ts';
import type { TemplateDescriptor } from '@/core/types';

export interface FormFieldModel {
  name: string;
  label: Record<string, string>;
  maxLength?: number;
  type?: string;
  /** The declared field this input fills, when the template declares one of that name. */
  contract?: TemplateField;
}

export type FieldControl = 'text' | 'textarea' | 'color' | 'number' | 'select' | 'url';

export type FieldProblem =
  | { kind: 'required' }
  | { kind: 'maxChars'; max: number }
  | { kind: 'invalid'; reason: string };

function contracts(descriptor: TemplateDescriptor): Map<string, TemplateField> {
  return new Map(declaredFields(descriptor.global).map((field) => [field.name, field]));
}

export function bindFieldContracts<T extends FormFieldModel>(
  fields: T[],
  descriptor: TemplateDescriptor
): Array<T & Pick<FormFieldModel, 'contract'>> {
  const declared = contracts(descriptor);

  return fields.map((field) => {
    const contract = declared.get(field.name);

    return contract ? { ...field, contract } : field;
  });
}

export function unboundDeclaredFields(descriptor: TemplateDescriptor, formFields: FormFieldModel[]): FormFieldModel[] {
  const asked = new Set(formFields.map((field) => field.name));

  return declaredFields(descriptor.global)
    .filter((field) => !asked.has(field.name))
    .map((field) => ({
      name: field.name,
      label: field.label ?? { en: field.name },
      maxLength: field.maxLength,
      contract: field,
    }));
}

const CONTROL_BY_TYPE: Partial<Record<TemplateField['type'], FieldControl>> = {
  color: 'color',
  number: 'number',
  time: 'text',
  enum: 'select',
  url: 'url',
  media: 'url',
};

export function fieldControl(field: FormFieldModel): FieldControl {
  const typed = field.contract ? CONTROL_BY_TYPE[field.contract.type] : undefined;

  if (typed) return typed;

  if ((field.maxLength ?? 0) > 50 || field.name.includes('description')) return 'textarea';

  return 'text';
}

// Empty is fine when the template has something to fall back on: a default, or an optional text field.
function mayStayEmpty(contract: TemplateField | undefined): boolean {
  if (!contract) return false;

  if (contract.default !== undefined) return true;

  return contract.type === 'text' && contract.required !== true;
}

export function fieldProblem(field: FormFieldModel, value: string): FieldProblem | null {
  const budget = field.maxLength ?? field.contract?.maxLength;

  if (budget !== undefined && value.length > budget) return { kind: 'maxChars', max: budget };

  if (value.trim() === '') return mayStayEmpty(field.contract) ? null : { kind: 'required' };

  if (!field.contract) return null;

  const coerced = coerceFieldValue(field.contract, value);

  return coerced.ok ? null : { kind: 'invalid', reason: coerced.reason };
}

export function fieldSatisfied(field: FormFieldModel, value: string): boolean {
  return fieldProblem(field, value) === null;
}
