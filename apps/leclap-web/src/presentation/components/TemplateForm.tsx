/// <reference types="vite/client" />
import { useState, useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  Type,
  Hash,
  Check,
  Clock,
  Image as ImageIcon,
  Link,
  List,
  Palette,
  type LucideIcon,
} from '@/presentation/components/icons';
import { FileTextIcon } from '@/presentation/components/icons/file-text';
import { UserIcon } from '@/presentation/components/icons/user';
import clsx from 'clsx';
import { templateService, type Template } from '@/services/templateService';
import { resolveTranslation } from '@/lib/i18nText';
import { FieldInput } from './template-form-input';
import {
  bindFieldContracts,
  fieldControl,
  fieldProblem,
  unboundDeclaredFields,
  type FormFieldModel,
} from './template-form-fields.logic';
import type { TemplateField } from 'ffmpeg-video-composer/src/schemas/fields.schemas.ts';

type FormField = FormFieldModel;

interface TemplateFormProps {
  template: Template;
  onFormDataChange: (formData: Record<string, string>) => void;
  formData: Record<string, string>;
  // When set, render only THIS form section's fields (the per-section wizard step). Omit for the
  // legacy all-fields-at-once form, which also lists the declared fields no form section asks for.
  // When scoped, the generic header is hidden (the step supplies one).
  sectionName?: string;
}

// A typed field shows its type's icon; a plain text field keeps the name-based one.
const ICON_BY_TYPE: Partial<Record<TemplateField['type'], LucideIcon>> = {
  color: Palette,
  number: Hash,
  time: Clock,
  enum: List,
  url: Link,
  media: ImageIcon,
};

const getFieldIcon = (field: FormField) => {
  const typed = field.contract ? ICON_BY_TYPE[field.contract.type] : undefined;

  if (typed) return typed;

  if (field.name.includes('name')) return UserIcon;

  if (field.name.includes('keyword')) return Hash;

  return Type;
};

const getFieldPlaceholder = (field: FormField, label: string, t: TFunction<'templates'>): string => {
  const name = field.name.toLowerCase();

  if (name.includes('firstname')) return t('form.placeholder.firstName');

  if (name.includes('lastname')) return t('form.placeholder.lastName');

  if (name.includes('job')) return t('form.placeholder.job');

  if (name.includes('keyword')) return t('form.placeholder.keyword');

  if (name.includes('description')) return t('form.placeholder.description');

  return t('form.placeholder.generic', { label: label.toLowerCase() });
};

// What the line under a field says: a value that does not fit always shows; "required" only once the
// viewer has touched the field, so an untouched form does not open in red.
const fieldErrorMessage = (
  field: FormField,
  value: string,
  touched: boolean,
  t: TFunction<'templates'>
): string | null => {
  const problem = fieldProblem(field, value);

  if (problem === null) return null;

  if (problem.kind === 'maxChars') return t('form.status.maxChars', { count: problem.max });

  if (problem.kind === 'invalid') return t('form.status.invalidValue', { reason: problem.reason });

  return touched ? t('form.status.fieldRequired') : null;
};

interface FieldStatusProps {
  hasError: boolean;
  errorMessage: string | undefined;
  errorId: string;
  value: string;
  charCount: number;
  maxChars: number | null;
}

// The line under a field says only what the field itself doesn't: an error when there is one, a quiet
// check once it's filled, and the character budget. "Required field" under every empty input (with the
// asterisk already on its label) and a "Form complete!" banner below them (with the scene's own check
// and the titlebar meter already counting) were the same fact said three times.
const FieldStatus = ({ hasError, errorMessage, errorId, value, charCount, maxChars }: FieldStatusProps) => {
  const { t } = useTranslation('templates');
  // Red over the last tenth of the budget (at least the last character), whatever its size.
  const nearLimit = maxChars !== null && charCount > 0 && maxChars - charCount < Math.max(1, Math.ceil(maxChars / 10));
  const filled = value.trim() !== '';

  return (
    <div className="flex min-h-5 items-center justify-between gap-3">
      {hasError && (
        <span id={errorId} className="text-sm text-[var(--color-error)]">
          {errorMessage}
        </span>
      )}
      {!hasError && filled && (
        <span role="img" aria-label={t('form.status.completed')} className="inline-flex text-success-foreground">
          <Check className="size-4" aria-hidden="true" />
        </span>
      )}
      {!hasError && !filled && <span />}

      {maxChars !== null && (
        <span className={clsx('text-xs tabular-nums', nearLimit ? 'text-[var(--color-error)]' : 'text-gray-500')}>
          {t('form.status.counter', { count: charCount, max: maxChars })}
        </span>
      )}
    </div>
  );
};

interface FormFieldItemProps {
  field: FormField;
  index: number;
  formData: Record<string, string>;
  touched: boolean;
  onFieldChange: (fieldName: string, value: string) => void;
}

const FormFieldItem = ({ field, index, formData, touched, onFieldChange }: FormFieldItemProps) => {
  const { t, i18n } = useTranslation('templates');
  const fieldId = useId();
  const errorId = useId();
  const IconComponent = getFieldIcon(field);
  // The author's label in the viewer's language, when the template carries one.
  const label = resolveTranslation(field.label, i18n.language) ?? field.name;
  const placeholder = getFieldPlaceholder(field, label, t);
  const value = formData[field.name] || '';
  const errorMessage = fieldErrorMessage(field, value, touched, t);
  const hasError = errorMessage !== null;
  // The character budget only means something under a text input; typed controls check the value instead.
  const control = fieldControl(field);
  const maxChars = control === 'text' || control === 'textarea' ? (field.maxLength ?? null) : null;
  // A field the template can fill on its own (a default, an optional text) is not marked as required.
  const required = fieldProblem(field, '') !== null;

  return (
    <div className="space-y-2 fade-in" style={{ animationDelay: `${index * 100}ms` }}>
      {/* The character budget lives in the counter under the field, not repeated beside the label. */}
      <label
        htmlFor={fieldId}
        className="flex items-center space-x-2 text-sm font-medium text-gray-700 dark:text-gray-300"
      >
        <IconComponent className="w-4 h-4 text-brand-600 dark:text-brand-300" />
        <span>{label}</span>
        {required && (
          <span className="text-brand-600 dark:text-brand-300" aria-label={t('form.status.requiredMark')}>
            *
          </span>
        )}
      </label>

      <FieldInput
        field={field}
        value={value}
        hasError={hasError}
        placeholder={placeholder}
        fieldId={fieldId}
        errorId={errorId}
        onChange={(val) => {
          onFieldChange(field.name, val);
        }}
      />

      <FieldStatus
        hasError={hasError}
        errorMessage={errorMessage ?? undefined}
        errorId={errorId}
        value={value}
        charCount={value.length}
        maxChars={maxChars}
      />
    </div>
  );
};

const FormHeader = () => {
  const { t } = useTranslation('templates');

  return (
    <div className="text-center">
      <div className="brand-gradient rise-in p-3 rounded-2xl inline-block mb-4 shadow-lg shadow-brand-500/25">
        <FileTextIcon size={24} className="text-white" />
      </div>
      <h3 className="text-xl font-bold text-foreground mb-2 font-display">{t('form.header.title')}</h3>
      <p className="text-sm text-gray-500 dark:text-gray-400">{t('form.header.subtitle')}</p>
    </div>
  );
};

// The fields to ask for: the form section's own (or every form section's), each bound to the declared
// `global.fields` entry of its name; the all-fields form also lists declared fields no form asks for.
const formFieldsFor = (template: Template, sectionName: string | undefined): FormField[] => {
  if (sectionName) {
    return bindFieldContracts(
      templateService.extractFormFieldsForSection(template.descriptor, sectionName),
      template.descriptor
    );
  }

  const asked = bindFieldContracts(templateService.extractFormFields(template.descriptor), template.descriptor);

  return [...asked, ...unboundDeclaredFields(template.descriptor, asked)];
};

export const TemplateForm = ({ template, onFormDataChange, formData, sectionName }: TemplateFormProps) => {
  const { t } = useTranslation('templates');
  const fields = formFieldsFor(template, sectionName);
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set());

  const handleFieldChange = (fieldName: string, value: string) => {
    setTouched((previous) => new Set(previous).add(fieldName));
    onFormDataChange({ ...formData, [fieldName]: value });
  };

  if (fields.length === 0) {
    return (
      <div className="fade-in p-6 bg-brand-500/[0.06] border border-brand-500/30 dark:bg-brand-500/10 rounded-xl">
        <div className="flex items-center space-x-3">
          <div className="brand-gradient p-2 rounded-lg shadow-lg shadow-brand-500/20">
            <FileTextIcon size={20} className="text-white" />
          </div>
          <div>
            <h4 className="font-semibold text-brand-700 dark:text-brand-200">{t('form.noForm.title')}</h4>
            <p className="text-sm text-gray-600 dark:text-gray-300">{t('form.noForm.message')}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {!sectionName && <FormHeader />}

      <div className="space-y-5">
        {fields.map((field, index) => (
          <FormFieldItem
            key={field.name}
            field={field}
            index={index}
            formData={formData}
            touched={touched.has(field.name)}
            onFieldChange={handleFieldChange}
          />
        ))}
      </div>
    </div>
  );
};
