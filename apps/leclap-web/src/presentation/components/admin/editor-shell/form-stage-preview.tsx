// The program monitor for a form scene. A form puts nothing on screen: viewers fill it in before the
// render. So the monitor shows the form as they will see it (labels, required marks, defaults as
// placeholders, help lines, character budgets) and, under it, where each answer lands in the video.
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { EditorSection, FormField } from '../templateEditorModel';
import { scenesUsing } from '../editor/SectionFields/form-fields.logic';

type FormSection = Extract<EditorSection, { kind: 'form' }>;

function RequiredMark({ optional }: { optional: boolean }) {
  const { t } = useTranslation('admin');

  if (optional) {
    return <span className="ml-1.5 text-xs font-normal text-muted-foreground">{t('form.optionalMark')}</span>;
  }

  return (
    <span aria-label={t('monitor.formRequired')} className="ml-0.5 text-[var(--color-error)]">
      *
    </span>
  );
}

// The input as the viewer meets it: the default (or a sample) as placeholder, a chevron on a choice,
// the character budget on text.
function InputMock({ field }: { field: FormField }) {
  const { t } = useTranslation('admin');
  const type = field.type ?? 'text';
  const value = field.default ?? '';
  const counted = type === 'text' || type === 'url';

  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex h-10 items-center justify-between gap-3 rounded-lg border border-divider bg-surface-inset px-3 text-sm',
        value === '' ? 'text-muted-foreground/60' : 'text-muted-foreground'
      )}
    >
      <span className="min-w-0 truncate">{value || t(`monitor.formSample.${type}`)}</span>
      {type === 'enum' ? <ChevronDown className="size-4 shrink-0" /> : null}
      {counted ? <span className="shrink-0 text-xs tabular-nums">0/{field.maxLength}</span> : null}
    </span>
  );
}

function FieldMock({ field }: { field: FormField }) {
  const { t } = useTranslation('admin');

  return (
    <li className="grid gap-1.5">
      <span className="text-sm font-medium text-foreground">
        {field.label.trim() || t('form.untitled')}
        <RequiredMark optional={field.required === false} />
      </span>
      <InputMock field={field} />
      {field.help?.trim() ? <span className="text-xs text-muted-foreground">{field.help}</span> : null}
    </li>
  );
}

function AnswerRow({ field, sections }: { field: FormField; sections: EditorSection[] }) {
  const { t } = useTranslation('admin');
  const scenes = scenesUsing(sections, field.name);

  return (
    <li className="flex items-baseline justify-between gap-3 text-xs">
      <span className="min-w-0 truncate font-mono text-brand-300">#{field.name}</span>
      <span className={cn('shrink-0 tabular-nums', scenes.length > 0 ? 'text-foreground/80' : 'text-muted-foreground')}>
        {scenes.length > 0
          ? t('monitor.formScenes', { list: scenes.join(', '), count: scenes.length })
          : t('monitor.formNowhere')}
      </span>
    </li>
  );
}

export function FormStagePreview({ section, sections }: { section: FormSection; sections: EditorSection[] }) {
  const { t } = useTranslation('admin');

  return (
    <div className="grid h-full place-items-center overflow-auto p-4 sm:p-6">
      <section
        aria-label={t('monitor.formRegion')}
        className="w-full max-w-md rounded-xl border border-divider bg-surface shadow-[var(--shadow-md)]"
      >
        <div className="border-b border-divider px-5 py-4">
          <h3 className="font-display text-lg font-semibold text-foreground">{t('monitor.formTitle')}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('monitor.formLead')}</p>
        </div>
        {section.fields.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">{t('monitor.formEmpty')}</p>
        ) : (
          <ul className="grid gap-4 px-5 py-4">
            {section.fields.map((field, index) => (
              <FieldMock key={`${String(index)}:${field.name}`} field={field} />
            ))}
          </ul>
        )}
        {section.fields.length > 0 ? (
          <div className="border-t border-divider px-5 py-3">
            <h4 className="mb-2 text-xs font-medium text-muted-foreground">{t('monitor.formAnswers')}</h4>
            <ul className="grid gap-1.5">
              {section.fields.map((field, index) => (
                <AnswerRow key={`${String(index)}:${field.name}`} field={field} sections={sections} />
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </div>
  );
}
