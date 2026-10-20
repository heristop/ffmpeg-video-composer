// The monitor for a form scene in the studio. The form itself never shows in the video, so instead of a
// placeholder the monitor lists the answers as they will be used: each field's label, what the viewer
// typed so far, and whether a scene shows it.
import { useTranslation } from 'react-i18next';
import type { Template, InputSection } from '@/services/templateService';
import { resolveTranslation } from '@/lib/i18nText';
import { cn } from '@/lib/utils';

interface FormFieldRef {
  name: string;
  label?: Record<string, string>;
}

// The form section's fields, from the template descriptor.
export function formSectionFields(template: Template, section: InputSection): FormFieldRef[] {
  const descriptor = (template.descriptor.sections ?? []).find((candidate) => candidate.name === section.name);
  const fields = (descriptor?.options as { fields?: FormFieldRef[] } | undefined)?.fields;

  return fields ?? [];
}

// Whether any scene of the template shows the field (a {{ name }} token anywhere in a non-form section).
export function shownOnScreen(template: Template, name: string): boolean {
  const token = new RegExp(String.raw`\{\{\s*${name.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)}\s*\}\}`);

  return (template.descriptor.sections ?? []).some(
    (section) => section.type !== 'form' && token.test(JSON.stringify(section))
  );
}

interface FormAnswersPreviewProps {
  template: Template;
  section: InputSection;
  formData: Record<string, string>;
}

export function FormAnswersPreview({ template, section, formData }: FormAnswersPreviewProps) {
  const { t, i18n } = useTranslation('builder');
  const fields = formSectionFields(template, section);

  return (
    <div className="relative z-10 grid h-full w-full place-items-center overflow-auto bg-player-ink p-4 sm:p-6">
      <section aria-label={t('editor.answersTitle')} className="w-full max-w-sm">
        <h3 className="font-display text-base font-semibold text-player-fg">{t('editor.answersTitle')}</h3>
        <p className="mt-0.5 text-xs text-player-fg/60">{t('editor.answersLead')}</p>
        <ul className="mt-4 grid gap-2.5">
          {fields.map((field) => {
            const value = (formData[field.name] ?? '').trim();
            const shown = shownOnScreen(template, field.name);

            return (
              <li key={field.name} className="rounded-lg border border-player-fg/10 px-3 py-2">
                <div className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="min-w-0 break-words text-player-fg/70">
                    {resolveTranslation(field.label, i18n.language) ?? field.name}
                  </span>
                  <span className={cn('shrink-0', shown ? 'text-brand-300' : 'text-player-fg/45')}>
                    {t(shown ? 'editor.answersShown' : 'editor.answersNotShown')}
                  </span>
                </div>
                <p className={cn('mt-0.5 break-words text-sm', value ? 'text-player-fg' : 'text-player-fg/40')}>
                  {value || t('editor.answersEmpty')}
                </p>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
