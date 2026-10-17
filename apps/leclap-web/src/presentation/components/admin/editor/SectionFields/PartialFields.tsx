import { useEffect, useId } from 'react';
import { Trash2 } from '@/presentation/components/icons';
import { PlusIcon } from '@/presentation/components/icons/plus';
import { useIconHover } from '@/presentation/components/icons/useIconHover';
import type { AvailablePartial } from '@/services/templatePartialService';
import type { EditorSection } from '../../templateEditorModel';
import { Badge, Select, SelectItem, SelectTrigger, SelectValue } from '@/presentation/components/ui';
import { VariableTextField } from '../VariableTextField';
import { FieldGroupHeader } from '../FieldGroupHeader';
import { partialVariableNames } from '@/lib/partialVariables';
import { EditorSelectContent } from '../editor-select-content';

type PartialSection = Extract<EditorSection, { kind: 'partial' }>;

interface PartialFieldsProps {
  section: PartialSection;
  partials: AvailablePartial[];
  variables: string[];
  onChange: (p: Partial<EditorSection>) => void;
  inputCls: string;
}

export const PartialFields = ({ section, partials, variables, onChange, inputCls }: PartialFieldsProps) => {
  const selected = partials.find((partial) => partial.id === section.ref);
  const id = useId();
  const partialId = `${id}-partial-ref`;
  const prefixId = `${id}-partial-prefix`;
  const { ref: plusRef, hoverProps: plusHoverProps } = useIconHover();

  // When a partial is picked and the author hasn't entered any rows yet, seed the variable NAMES the
  // partial actually exposes so only values remain to fill. Guarded to fire only while empty — once
  // seeded, `section.variables.length > 0` so it never clobbers author edits or loops.
  useEffect(() => {
    if (!selected || section.variables.length > 0) {
      return;
    }

    const names = partialVariableNames(selected);

    if (names.length === 0) {
      return;
    }

    onChange({ variables: names.map((name) => ({ name, value: '' })) });
  }, [section.ref, section.variables.length, selected, onChange]);

  const patchVariable = (index: number, patch: Partial<PartialSection['variables'][number]>): void => {
    onChange({
      variables: section.variables.map((variable, i) => (i === index ? { ...variable, ...patch } : variable)),
    });
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_10rem]">
        <div>
          <label
            htmlFor={partialId}
            className="mb-1 block text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400"
          >
            Partial
          </label>
          <Select
            value={section.ref}
            onValueChange={(ref) => {
              onChange({ ref });
            }}
            disabled={partials.length === 0}
          >
            <SelectTrigger id={partialId} aria-label="Partial">
              <SelectValue placeholder="Select partial" />
            </SelectTrigger>
            <EditorSelectContent>
              {partials.map((partial) => (
                <SelectItem key={partial.id} value={partial.id}>
                  {partial.id}
                </SelectItem>
              ))}
            </EditorSelectContent>
          </Select>
        </div>
        <div>
          <label
            htmlFor={prefixId}
            className="mb-1 block text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400"
          >
            Prefix
          </label>
          <input
            id={prefixId}
            aria-label="Partial prefix"
            className={inputCls}
            value={section.prefix ?? ''}
            onChange={(e) => {
              onChange({ prefix: e.target.value });
            }}
            placeholder="intro_"
          />
        </div>
      </div>

      {selected && (
        <div className="rounded-lg bg-foreground/5 px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={selected.source === 'local' ? 'brand' : 'neutral'}>
              {selected.source === 'local' ? 'Local' : 'Built-in'}
            </Badge>
            <Badge variant="secondary">
              {selected.sections.length} {selected.sections.length === 1 ? 'section' : 'sections'}
            </Badge>
          </div>
          {selected.description && (
            <p className="mt-2 text-xs text-gray-600 dark:text-gray-300">{selected.description}</p>
          )}
        </div>
      )}

      <div>
        <FieldGroupHeader label="Variables" hint="Map each variable name to the value the partial should use." />
        <div className="space-y-2">
          {section.variables.map((variable, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
              <input
                aria-label={`Partial variable ${i + 1} name`}
                className={inputCls}
                value={variable.name}
                onChange={(e) => {
                  patchVariable(i, { name: e.target.value });
                }}
                placeholder="name"
              />
              <VariableTextField
                aria-label={`Partial variable ${i + 1} value`}
                className={inputCls}
                value={variable.value}
                onChange={(value) => {
                  patchVariable(i, { value });
                }}
                variables={variables.map((name) => ({ name, scope: 'global' as const }))}
                placeholder="value"
              />
              <button
                type="button"
                onClick={() => {
                  onChange({ variables: section.variables.filter((_, idx) => idx !== i) });
                }}
                aria-label={`Remove partial variable ${i + 1}`}
                className="tap rounded-lg p-1.5 text-gray-500 transition-colors hover:text-[var(--color-error)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-error)]/40 active:scale-90"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => {
              onChange({ variables: [...section.variables, { name: '', value: '' }] });
            }}
            className="tap inline-flex items-center gap-1.5 rounded-lg bg-foreground/5 px-2.5 py-1.5 text-xs text-gray-600 transition-colors hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 active:scale-[0.97] dark:text-gray-300"
            {...plusHoverProps}
          >
            <PlusIcon ref={plusRef} size={14} /> Add variable
          </button>
        </div>
      </div>
    </div>
  );
};
