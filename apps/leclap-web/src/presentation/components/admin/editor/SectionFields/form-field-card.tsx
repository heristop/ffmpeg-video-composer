// One form field as a collapsible row: the summary (position, label, type, optional mark) is the
// toggle; the body holds the label, the #variable id, the type and its contract, and the move/remove
// actions. Alt+↑/↓ on the summary moves the field. Collapsed bodies are inert, so Tab skips them.
import { useId, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import { Checkbox, Select, SelectItem, SelectTrigger, SelectValue } from '@/presentation/components/ui';
import { NumberField } from '@/presentation/components/ui/NumberField';
import { cn } from '@/lib/utils';
import { EditorSelectContent } from '../editor-select-content';
import type { FormField, FormFieldType } from '../../templateEditorModel';
import { fieldIdProblem, type FieldIdProblem } from './form-fields.logic';

const TYPES: readonly FormFieldType[] = ['text', 'number', 'enum', 'url', 'color', 'time'];
const LENGTH_PRESETS = [20, 40, 80, 160];
const LABEL_CLS = 'mb-1.5 block text-xs font-medium text-muted-foreground';
const HINT_CLS = 'mt-1 text-xs leading-snug text-muted-foreground';
const ERROR_CLS = 'mt-1 text-xs leading-snug text-[var(--color-error)]';

export interface FormFieldCardProps {
  field: FormField;
  position: number;
  count: number;
  open: boolean;
  focusLabel: boolean;
  inputCls: string;
  otherNames: string[];
  usedIn: number[];
  onToggle: () => void;
  onPatch: (patch: Partial<FormField>) => void;
  onLabel: (label: string) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
}

function Hint({ id, children, error = false }: { id?: string; children: ReactNode; error?: boolean }) {
  return (
    <p id={id} className={error ? ERROR_CLS : HINT_CLS}>
      {children}
    </p>
  );
}

function FieldSummary({
  field,
  position,
  open,
  onToggle,
  onKeyDown,
  bodyId,
}: {
  field: FormField;
  position: number;
  open: boolean;
  onToggle: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  bodyId: string;
}) {
  const { t } = useTranslation('admin');
  const label = field.label.trim() || t('form.untitled');

  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={bodyId}
      aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
      title={t('form.reorderHint')}
      onClick={onToggle}
      onKeyDown={onKeyDown}
      className="flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left"
    >
      <span className="grid size-6 shrink-0 place-items-center rounded-[0.3125rem] bg-foreground/[0.06] text-xs font-medium tabular-nums text-muted-foreground">
        {position}
      </span>
      <span className="min-w-0 flex-1 break-words text-sm font-medium text-foreground">{label}</span>
      <span className="shrink-0 rounded-[0.3125rem] bg-foreground/[0.06] px-1.5 py-0.5 text-[0.6875rem] font-medium text-muted-foreground">
        {t(`form.type.${field.type ?? 'text'}`)}
      </span>
      {field.required === false ? (
        <span className="shrink-0 text-[0.6875rem] text-muted-foreground">{t('form.optionalMark')}</span>
      ) : null}
      <ChevronDown
        aria-hidden="true"
        className={cn(
          'size-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-[var(--ease-out-expo)] motion-reduce:transition-none',
          open && 'rotate-180'
        )}
      />
    </button>
  );
}

function IdRow({
  field,
  otherNames,
  usedIn,
  inputCls,
  onPatch,
}: {
  field: FormField;
  otherNames: string[];
  usedIn: number[];
  inputCls: string;
  onPatch: (patch: Partial<FormField>) => void;
}) {
  const { t } = useTranslation('admin');
  const id = useId();
  const problem: FieldIdProblem | null = fieldIdProblem(field.name, otherNames);

  return (
    <div>
      <label htmlFor={id} className={LABEL_CLS}>
        {t('form.fieldId')}
      </label>
      <div className="relative">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-[0.82rem] text-brand-300"
        >
          #
        </span>
        <input
          id={id}
          className={cn(inputCls, 'h-10 pl-6 font-mono text-[0.82rem]')}
          value={field.name}
          aria-invalid={problem !== null}
          aria-describedby={`${id}-hint`}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          onChange={(event) => {
            onPatch({ name: event.target.value });
          }}
        />
      </div>
      {problem ? (
        <Hint id={`${id}-hint`} error>
          {t(`form.idProblem.${problem}`)}
        </Hint>
      ) : (
        <Hint id={`${id}-hint`}>
          {usedIn.length > 0
            ? t('form.usedIn', { list: usedIn.join(', '), count: usedIn.length })
            : t('form.unused', { name: field.name })}
        </Hint>
      )}
    </div>
  );
}

function TypeAndLength({ field, onPatch }: { field: FormField; onPatch: (patch: Partial<FormField>) => void }) {
  const { t } = useTranslation('admin');
  const id = useId();
  const type = field.type ?? 'text';
  const hasLength = type === 'text' || type === 'url';

  return (
    <div className={cn('grid gap-3', hasLength && 'grid-cols-[minmax(0,1fr)_7rem]')}>
      <div className="min-w-0">
        <span id={`${id}-type`} className={LABEL_CLS}>
          {t('form.type.label')}
        </span>
        <Select
          value={type}
          onValueChange={(value) => {
            onPatch({ type: value as FormFieldType });
          }}
        >
          <SelectTrigger aria-labelledby={`${id}-type`}>
            <SelectValue />
          </SelectTrigger>
          <EditorSelectContent>
            {TYPES.map((option) => (
              <SelectItem key={option} value={option}>
                {t(`form.type.${option}`)}
              </SelectItem>
            ))}
          </EditorSelectContent>
        </Select>
      </div>
      {hasLength ? (
        <div>
          <span className={LABEL_CLS}>{t('form.maxLength')}</span>
          <NumberField
            aria-label={t('form.maxLength')}
            value={field.maxLength}
            min={1}
            step={1}
            unit="ch"
            compact
            className="w-full"
            inputCls="h-10"
            onChange={(maxLength) => {
              onPatch({ maxLength });
            }}
          />
        </div>
      ) : null}
      {hasLength ? (
        <div className="col-span-2 -mt-1 flex flex-wrap items-center gap-1.5">
          {LENGTH_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              aria-pressed={field.maxLength === preset}
              onClick={() => {
                onPatch({ maxLength: preset });
              }}
              className={cn(
                'h-7 rounded-[0.3125rem] px-2 text-xs font-medium tabular-nums transition-colors',
                field.maxLength === preset
                  ? 'bg-brand-600 text-white'
                  : 'bg-foreground/[0.06] text-muted-foreground hover:bg-foreground/10 hover:text-foreground'
              )}
            >
              {preset}
            </button>
          ))}
          <span className="text-xs text-muted-foreground">{t('form.maxLengthHint', { count: field.maxLength })}</span>
        </div>
      ) : null}
    </div>
  );
}

function Contract({
  field,
  inputCls,
  onPatch,
}: {
  field: FormField;
  inputCls: string;
  onPatch: (patch: Partial<FormField>) => void;
}) {
  const { t } = useTranslation('admin');
  const id = useId();
  const optional = field.required === false;

  return (
    <div className="grid gap-3">
      {field.type === 'enum' ? (
        <div>
          <label htmlFor={`${id}-options`} className={LABEL_CLS}>
            {t('form.options')}
          </label>
          <textarea
            id={`${id}-options`}
            rows={3}
            className={cn(inputCls, 'min-h-20 py-2')}
            value={(field.options ?? []).join('\n')}
            onChange={(event) => {
              onPatch({ options: event.target.value.split('\n') });
            }}
          />
          <Hint>{t('form.optionsHint')}</Hint>
        </div>
      ) : null}
      <div>
        <label htmlFor={`${id}-default`} className={LABEL_CLS}>
          {t('form.default')}
        </label>
        <input
          id={`${id}-default`}
          className={cn(inputCls, 'h-10')}
          value={field.default ?? ''}
          onChange={(event) => {
            onPatch({ default: event.target.value });
          }}
        />
        <Hint>{optional && (field.default ?? '') === '' ? t('form.optionalEmpty') : t('form.defaultHint')}</Hint>
      </div>
      <div>
        <label htmlFor={`${id}-help`} className={LABEL_CLS}>
          {t('form.help')}
        </label>
        <input
          id={`${id}-help`}
          className={cn(inputCls, 'h-10')}
          value={field.help ?? ''}
          onChange={(event) => {
            onPatch({ help: event.target.value });
          }}
        />
        <Hint>{t('form.helpHint')}</Hint>
      </div>
      <label className="flex w-fit cursor-pointer select-none items-center gap-3 text-sm text-foreground">
        <Checkbox
          checked={!optional}
          onCheckedChange={(checked) => {
            onPatch({ required: checked === true });
          }}
        />
        {t('form.required')}
      </label>
    </div>
  );
}

function Actions({
  position,
  count,
  onMove,
  onRemove,
}: {
  position: number;
  count: number;
  onMove: (to: number) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation('admin');
  const iconButton =
    'grid size-9 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground disabled:pointer-events-none disabled:opacity-35';

  return (
    <div className="flex items-center gap-1 border-t border-divider pt-2">
      <button
        type="button"
        aria-label={t('form.moveUp')}
        title={t('form.moveUpTooltip')}
        disabled={position === 1}
        onClick={() => {
          onMove(position - 2);
        }}
        className={iconButton}
      >
        <ChevronUp className="size-4" />
      </button>
      <button
        type="button"
        aria-label={t('form.moveDown')}
        title={t('form.moveDownTooltip')}
        disabled={position === count}
        onClick={() => {
          onMove(position);
        }}
        className={iconButton}
      >
        <ChevronDown className="size-4" />
      </button>
      <button
        type="button"
        onClick={onRemove}
        className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-[var(--color-error)]/10 hover:text-[var(--color-error)]"
      >
        <Trash2 aria-hidden="true" className="size-3.5" />
        {t('form.removeField')}
      </button>
    </div>
  );
}

export function FormFieldCard({
  field,
  position,
  count,
  open,
  focusLabel,
  inputCls,
  otherNames,
  usedIn,
  onToggle,
  onPatch,
  onLabel,
  onMove,
  onRemove,
}: FormFieldCardProps) {
  const { t } = useTranslation('admin');
  const id = useId();
  const labelEmpty = field.label.trim() === '';

  const onSummaryKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;

    event.preventDefault();
    event.stopPropagation();
    onMove(event.key === 'ArrowUp' ? position - 2 : position);
  };

  return (
    <li
      data-form-field={field.name}
      className={cn(
        'animate-field-in rounded-xl border bg-surface-2/40 transition-colors duration-150 motion-reduce:animate-none',
        open ? 'border-foreground/15' : 'border-foreground/10 hover:border-foreground/20'
      )}
    >
      <FieldSummary
        field={field}
        position={position}
        open={open}
        onToggle={onToggle}
        onKeyDown={onSummaryKey}
        bodyId={`${id}-body`}
      />
      <div
        id={`${id}-body`}
        inert={!open}
        className={cn(
          'grid transition-[grid-template-rows] duration-200 ease-[var(--ease-out-expo)] motion-reduce:transition-none',
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="grid gap-3 px-2.5 pb-2.5 pt-1">
            <div>
              <label htmlFor={`${id}-label`} className={LABEL_CLS}>
                {t('form.fieldLabel')}
              </label>
              <input
                id={`${id}-label`}
                autoFocus={focusLabel}
                className={cn(inputCls, 'h-10')}
                value={field.label}
                aria-invalid={labelEmpty}
                onChange={(event) => {
                  onLabel(event.target.value);
                }}
              />
              {labelEmpty ? <Hint error>{t('form.labelEmpty')}</Hint> : null}
            </div>
            <IdRow field={field} otherNames={otherNames} usedIn={usedIn} inputCls={inputCls} onPatch={onPatch} />
            <TypeAndLength field={field} onPatch={onPatch} />
            <Contract field={field} inputCls={inputCls} onPatch={onPatch} />
            <Actions position={position} count={count} onMove={onMove} onRemove={onRemove} />
          </div>
        </div>
      </div>
    </li>
  );
}
