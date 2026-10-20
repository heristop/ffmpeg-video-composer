// Field block for a form section: the fields as a numbered list of collapsible rows (one open at a time),
// then Add field. A new field opens with its label focused; its #variable id follows the label until the
// author types one. Removing a field offers Undo in place.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Info } from '@/presentation/components/icons';
import { PlusIcon } from '@/presentation/components/icons/plus';
import { useIconHover } from '@/presentation/components/icons/useIconHover';
import type { EditorSection, FormField } from '../../templateEditorModel';
import { FormFieldCard } from './form-field-card';
import { followsLabel, moveField, scenesUsing, uniqueFieldId } from './form-fields.logic';

type FormSection = Extract<EditorSection, { kind: 'form' }>;

interface FormFieldsProps {
  section: FormSection;
  onChange: (p: Partial<EditorSection>) => void;
  inputCls: string;
  // The template's scenes, to show where each answer is used.
  sections?: EditorSection[];
  // Every variable name in the template, so a new id never collides with one.
  variables?: string[];
}

const UNDO_MS = 6000;

interface Removed {
  field: FormField;
  index: number;
}

function UndoBar({ removed, onUndo }: { removed: Removed; onUndo: () => void }) {
  const { t } = useTranslation('admin');

  return (
    <div
      role="status"
      className="animate-field-in flex items-center justify-between gap-3 rounded-lg bg-foreground/[0.06] px-3 py-2 text-xs text-muted-foreground motion-reduce:animate-none"
    >
      <span className="min-w-0 break-words">
        {t('form.removed', { label: removed.field.label || t('form.untitled') })}
      </span>
      <button type="button" onClick={onUndo} className="shrink-0 font-semibold text-brand-300 hover:underline">
        {t('form.undo')}
      </button>
    </div>
  );
}

function useRemoved() {
  const [removed, setRemoved] = useState<Removed | null>(null);

  useEffect(() => {
    const timer = removed
      ? setTimeout(() => {
          setRemoved(null);
        }, UNDO_MS)
      : undefined;

    return () => {
      clearTimeout(timer);
    };
  }, [removed]);

  return [removed, setRemoved] as const;
}

export function FormFields({ section, onChange, inputCls, sections = [], variables = [] }: FormFieldsProps) {
  const { t } = useTranslation('admin');
  const { ref: plusRef, hoverProps: plusHoverProps } = useIconHover();
  const [open, setOpen] = useState<number | null>(section.fields.length === 1 ? 0 : null);
  const [added, setAdded] = useState<number | null>(null);
  const [removed, setRemoved] = useRemoved();
  const fields = section.fields;
  const names = (except: number) => [
    ...variables.filter((name) => name !== fields[except]?.name),
    ...fields.filter((_, index) => index !== except).map((field) => field.name),
  ];

  const setFields = (next: FormField[]) => {
    onChange({ fields: next });
  };
  const patch = (index: number, value: Partial<FormField>) => {
    setFields(fields.map((field, i) => (i === index ? { ...field, ...value } : field)));
  };
  const relabel = (index: number, label: string) => {
    const field = fields[index];
    const name = followsLabel(field, index + 1) ? uniqueFieldId(label, new Set(names(index)), index + 1) : field.name;
    patch(index, { label, name });
  };
  const add = () => {
    const position = fields.length + 1;
    setFields([...fields, { name: uniqueFieldId('', new Set(names(-1)), position), label: '', maxLength: 40 }]);
    setOpen(fields.length);
    setAdded(fields.length);
  };
  const remove = (index: number) => {
    setRemoved({ field: fields[index], index });
    setFields(fields.filter((_, i) => i !== index));
    setOpen(null);
  };
  const move = (from: number, to: number) => {
    setFields(moveField(fields, from, to));
    setOpen(Math.max(0, Math.min(fields.length - 1, to)));
  };

  return (
    <div className="space-y-3">
      <p className="text-sm leading-relaxed text-muted-foreground">{t('form.intro')}</p>
      {fields.length === 0 ? (
        <p className="flex gap-2 rounded-md bg-foreground/[0.04] px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span>{t('form.empty')}</span>
        </p>
      ) : (
        <ol aria-label={t('form.listLabel')} className="grid gap-2">
          {fields.map((field, index) => (
            <FormFieldCard
              key={`${String(index)}:${field.name}`}
              field={field}
              position={index + 1}
              count={fields.length}
              open={open === index}
              focusLabel={added === index}
              inputCls={inputCls}
              otherNames={names(index)}
              usedIn={scenesUsing(sections, field.name)}
              onToggle={() => {
                setOpen(open === index ? null : index);
              }}
              onPatch={(value) => {
                patch(index, value);
              }}
              onLabel={(label) => {
                relabel(index, label);
              }}
              onMove={(to) => {
                move(index, to);
              }}
              onRemove={() => {
                remove(index);
              }}
            />
          ))}
        </ol>
      )}
      {removed ? (
        <UndoBar
          removed={removed}
          onUndo={() => {
            const next = [...fields];
            next.splice(removed.index, 0, removed.field);
            setFields(next);
            setOpen(removed.index);
            setRemoved(null);
          }}
        />
      ) : null}
      <button
        type="button"
        onClick={add}
        className="tap inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-foreground/20 px-3 text-sm font-medium text-muted-foreground transition-colors hover:border-brand-500/50 hover:bg-brand-500/5 hover:text-brand-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 motion-reduce:transition-none"
        {...plusHoverProps}
      >
        <PlusIcon ref={plusRef} size={14} />
        {t('form.addField')}
      </button>
    </div>
  );
}
