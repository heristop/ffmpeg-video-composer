import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { colorTokenName, resolveColorToken } from '@leclap/creative-kit/editor';
import { cn } from '@/lib/utils';
import { normalizeHex, BRAND_SWATCHES } from '@/lib/color';
import { useColorVariables, type ColorVariablesScope } from './color-variables-context';
import { colorDraftFromValue, filterColorDraft, commitColorDraft } from './color-picker.logic';

export interface ColorPickerProps {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  presets?: readonly string[];
  className?: string;
  'aria-label'?: string;
  // Hide the variable-chip row for a field whose stored value can only ever be a solid hex colour
  // (e.g. an engine-generated recipe like the rounded-panel backdrop) — picking a `{{ token }}` there
  // would silently fail to resolve downstream with no feedback. Default false: every other colour
  // field keeps today's chip row unchanged.
  hideVariables?: boolean;
}

// Checkerboard for an unresolvable '{{ token }}' — the classic "no colour here" swatch.
const CHECKER: React.CSSProperties = {
  backgroundImage: 'conic-gradient(#9ca3af 0 25%, #e5e7eb 0 50%, #9ca3af 0 75%, #e5e7eb 0)',
  backgroundSize: '8px 8px',
};

interface VariableChip {
  name: string;
  color: string | null; // resolved hex, or null (checkerboard)
}

// The pickable variable chips: the palette's colorN slots first, then every author variable whose
// value currently resolves to a colour. Non-colour variables (plain text) stay out of colour fields.
function variableChips(scope: ColorVariablesScope): VariableChip[] {
  const slots: VariableChip[] = scope.colorsList.map((c, i) => ({
    name: `color${i + 1}`,
    color: normalizeHex(c),
  }));
  const slotNames = new Set(slots.map((s) => s.name));

  const named = Object.keys(scope.variables)
    .filter((name) => !slotNames.has(name))
    .map((name) => ({ name, color: normalizeHex(resolveColorToken(`{{ ${name} }}`, scope.variables) ?? '') }))
    .filter((chip): chip is VariableChip & { color: string } => chip.color !== null);

  return [...slots, ...named];
}

// The pickable variable chips row: each stores its literal '{{ name }}' token in the field.
const VariableChips = ({
  chips,
  tokenName,
  onPick,
}: {
  chips: VariableChip[];
  tokenName: string | null;
  onPick: (name: string) => void;
}) => {
  const { t } = useTranslation('admin');

  return (
    <div className="flex flex-wrap items-center gap-1" title={t('editor.colorField.hint')}>
      <span className="mr-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-500">
        {t('editor.colorField.variables')}
      </span>
      {chips.map((chip) => {
        const active = tokenName === chip.name;

        return (
          <button
            key={chip.name}
            type="button"
            aria-label={t('editor.colorField.useVariable', { name: chip.name })}
            aria-pressed={active}
            onClick={() => {
              onPick(chip.name);
            }}
            className={cn(
              'tap inline-flex items-center gap-1.5 rounded-md border border-divider bg-surface-2 px-1.5 py-1 font-mono text-[11px] text-gray-600 transition-colors hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 dark:text-gray-300',
              active && 'ring-2 ring-brand-500 ring-offset-1 ring-offset-surface'
            )}
          >
            <span
              aria-hidden
              className="h-3.5 w-3.5 rounded-sm border border-foreground/15"
              style={chip.color ? { backgroundColor: chip.color } : CHECKER}
            />
            #{chip.name}
          </button>
        );
      })}
    </div>
  );
};

// The trigger swatch: the native colour input, painted with the field's RESOLVED colour and
// overlaid with the checkerboard when a '{{ token }}' can't resolve.
const TriggerSwatch = React.forwardRef<
  HTMLInputElement,
  { id?: string; ariaLabel?: string; resolvedHex: string | null; unresolved: boolean; onPick: (hex: string) => void }
>(({ id, ariaLabel, resolvedHex, unresolved, onPick }, ref) => {
  const { t } = useTranslation('admin');

  return (
    <span className="relative shrink-0" title={unresolved ? t('editor.colorField.unresolved') : undefined}>
      <input
        ref={ref}
        id={id}
        type="color"
        aria-label={ariaLabel ?? 'Pick a color'}
        value={resolvedHex ?? '#000000'}
        onChange={(e) => {
          onPick(e.target.value);
        }}
        className="tap h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-divider bg-surface-2 p-1 [&::-webkit-color-swatch]:rounded-md [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-moz-color-swatch]:rounded-md [&::-moz-color-swatch]:border-0"
      />
      {unresolved && <span aria-hidden className="pointer-events-none absolute inset-1 rounded-md" style={CHECKER} />}
    </span>
  );
});
TriggerSwatch.displayName = 'TriggerSwatch';

function useSyncedDraft(value: string) {
  const [state, setState] = React.useState(() => ({ value, draft: colorDraftFromValue(value) }));

  if (state.value !== value) setState({ value, draft: colorDraftFromValue(value) });

  const draft = state.value === value ? state.draft : colorDraftFromValue(value);

  return {
    draft,
    update: (next: string) => {
      setState({ value, draft: next });
    },
    reset: () => {
      setState({ value, draft: colorDraftFromValue(value) });
    },
  };
}

// On-brand color picker: native swatch (OS picker) + validated hex entry + quick-pick swatches.
// Inside an editor shell (ColorVariablesProvider) the field is also variable-aware: the template's
// colour variables appear as pickable chips that store a literal '{{ name }}' token, the swatch
// shows the token's RESOLVED colour (checkerboard when it can't resolve), and typing a variable
// name — or pasting '{{ name }}' — in the text entry commits the token too. `hideVariables` opts a
// field out of the chip row for consumers whose stored value can only ever be a solid hex colour.
// No extra deps — the native <input type="color"> drives the actual picking UI.
const ColorPicker = React.forwardRef<HTMLInputElement, ColorPickerProps>(
  (
    { value, onChange, id, presets = BRAND_SWATCHES, className, 'aria-label': ariaLabel, hideVariables = false },
    ref
  ) => {
    const scope = useColorVariables();
    const { draft, update: updateDraft, reset: resetDraft } = useSyncedDraft(value);

    const chips = variableChips(scope);
    // Typed names accept ANY in-scope variable (even one whose colour isn't set yet) — the swatch
    // then shows the checkerboard until the variable resolves.
    const knownNames = Object.keys(scope.variables);
    const tokenName = colorTokenName(value);
    const resolvedHex = normalizeHex(resolveColorToken(value, scope.variables) ?? value);
    const unresolvedToken = tokenName !== null && resolvedHex === null;

    const commit = (raw: string) => {
      const next = commitColorDraft(raw, knownNames);

      if (next) {
        onChange(next);

        return;
      }

      resetDraft(); // revert an invalid entry
    };

    return (
      <div className={cn('flex flex-col gap-2', className)}>
        <div className="flex items-center gap-2">
          <TriggerSwatch
            ref={ref}
            id={id}
            ariaLabel={ariaLabel}
            resolvedHex={resolvedHex}
            unresolved={unresolvedToken}
            onPick={onChange}
          />
          <div className="relative flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 select-none text-gray-500">
              #
            </span>
            <input
              type="text"
              spellCheck={false}
              maxLength={knownNames.length > 0 ? 32 : 6}
              aria-label={`${ariaLabel ?? 'Color'} hex value`}
              value={draft}
              onChange={(e) => {
                updateDraft(filterColorDraft(e.target.value));
              }}
              onBlur={(e) => {
                commit(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
              }}
              className={cn(
                'field-focus-gradient w-full rounded-lg border border-divider bg-surface-2 py-2 pl-7 pr-3 font-mono text-sm text-foreground transition-colors focus-visible:outline-none',
                // Hex reads canonical in caps; a variable name keeps the author's casing.
                tokenName === null && 'uppercase'
              )}
            />
          </div>
        </div>
        {chips.length > 0 && !hideVariables && (
          <VariableChips
            chips={chips}
            tokenName={tokenName}
            onPick={(name) => {
              onChange(`{{ ${name} }}`);
            }}
          />
        )}
        {presets.length > 0 && (
          // Auto-fill grid so the swatches stretch edge-to-edge in whatever column the picker sits in
          // (no dead space on the right) — each cell stays square via aspect-square. The 1.25rem floor
          // keeps the grid COMPACT: narrow half-columns fit ~6 per row, wide panels ~12, so the palette
          // reads identically everywhere instead of ballooning into rows of four giant tiles.
          <div className="grid grid-cols-[repeat(auto-fill,minmax(1.25rem,1fr))] gap-1">
            {presets.map((c) => {
              const active = normalizeHex(c) === normalizeHex(value);

              return (
                <button
                  key={c}
                  type="button"
                  aria-label={`Select ${c}`}
                  aria-pressed={active}
                  onClick={() => {
                    onChange(c);
                  }}
                  style={{ backgroundColor: c }}
                  className={cn(
                    'tap aspect-square w-full rounded-md border border-foreground/15 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50',
                    active && 'ring-2 ring-brand-500 ring-offset-2 ring-offset-surface'
                  )}
                />
              );
            })}
          </div>
        )}
      </div>
    );
  }
);
ColorPicker.displayName = 'ColorPicker';

export { ColorPicker };
