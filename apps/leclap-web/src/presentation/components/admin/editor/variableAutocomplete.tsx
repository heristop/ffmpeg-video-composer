// The shared `#variable` autocomplete machinery: one hook owning the query/highlight state and the
// keyboard protocol, one presentational suggestion box. Extracted from VariableTextField so the
// canvas inline editors (sugar lines, overlay text) offer the exact same behaviour: typing `#`
// opens the picker, arrows navigate, Enter/Tab splices the `#name` shorthand (converted to the
// canonical `{{ name }}` token at the consumer's store boundary), Escape closes the picker only.
import { useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { findHashQuery, visibleVariableOptions, type HashQuery, type VariableOption } from './variableInsert';

export type { VariableOption } from './variableInsert';

type EditableElement = HTMLInputElement | HTMLTextAreaElement;

interface UseVariableAutocompleteOptions {
  variables: VariableOption[];
  /** The input/textarea the picker reads text + caret from (display space, `#name` shorthand). */
  elementRef: RefObject<EditableElement | null>;
  /** Apply the display text with the picked `#name` spliced in; restore the caret at `caret`. */
  onInsert: (nextText: string, caret: number) => void;
}

export interface VariableAutocomplete {
  /** The open `#query`, or null while the picker is closed. */
  query: HashQuery | null;
  options: VariableOption[];
  highlight: number;
  setHighlight: (index: number) => void;
  /** Re-derive the query from the element's caret (call on change/click/keyup). */
  sync: () => void;
  /** Sync on keyup, skipping the navigation keys the keydown protocol already consumed. */
  syncFromKeyUp: (key: string) => void;
  close: () => void;
  pick: (name: string) => void;
  /**
   * The picker's keydown protocol. Returns true when the event was consumed (arrows/Enter/Tab
   * while options are visible; Escape whenever the picker is open — so a consumer's own Escape
   * handling never also fires on the keypress that closed the picker).
   */
  handleKeyDown: (event: ReactKeyboardEvent) => boolean;
}

export function useVariableAutocomplete({
  variables,
  elementRef,
  onInsert,
}: UseVariableAutocompleteOptions): VariableAutocomplete {
  const [query, setQuery] = useState<HashQuery | null>(null);
  const [highlight, setHighlight] = useState(0);

  const options = query ? visibleVariableOptions(variables, query.query) : [];

  const sync = () => {
    const el = elementRef.current;

    if (!el) return;

    const caret = el.selectionStart ?? el.value.length;
    setQuery(findHashQuery(el.value, caret));
    setHighlight(0);
  };

  const syncFromKeyUp = (key: string) => {
    if (key.startsWith('Arrow') || key === 'Enter' || key === 'Tab' || key === 'Escape') {
      return;
    }

    sync();
  };

  const close = () => {
    setQuery(null);
  };

  const pick = (name: string) => {
    const el = elementRef.current;

    if (!query || !el) {
      return;
    }

    const caret = el.selectionStart ?? el.value.length;
    const inserted = `#${name}`;
    const next = `${el.value.slice(0, query.start)}${inserted}${el.value.slice(caret)}`;
    onInsert(next, query.start + inserted.length);
    setQuery(null);
  };

  // Arrow/enter navigation over a known non-empty option list. Returns true when the key is consumed.
  const navigateOptions = (event: ReactKeyboardEvent): boolean => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight((highlight + 1) % options.length);

      return true;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((highlight - 1 + options.length) % options.length);

      return true;
    }

    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      pick(options[highlight].name);

      return true;
    }

    return false;
  };

  const handleKeyDown = (event: ReactKeyboardEvent): boolean => {
    if (!query) return false;

    if (event.key === 'Escape') {
      event.preventDefault();
      close();

      return true;
    }

    if (options.length === 0) return false;

    return navigateOptions(event);
  };

  return { query, options, highlight, setHighlight, sync, syncFromKeyUp, close, pick, handleKeyDown };
}

interface VariableSuggestionsProps {
  autocomplete: VariableAutocomplete;
  /** Total number of variables in scope — distinguishes "none exist" from "no match". */
  totalCount: number;
}

/**
 * The suggestion box body: the grouped option list, or a "why is this empty" status when `#` is
 * typed with no match. Carries its own surface styling (light + dark) but NO positioning — the
 * host wraps it (VariableTextField: absolute under the field; canvas editors: a fixed portal).
 * Rows pick on mousedown + preventDefault so the editing textarea never blurs.
 */
export const VariableSuggestions = ({ autocomplete, totalCount }: VariableSuggestionsProps) => {
  const { t } = useTranslation('admin');
  const { query, options, highlight } = autocomplete;

  if (!query) return null;

  if (options.length === 0) {
    return (
      <div
        role="status"
        className="rounded-lg border border-foreground/10 bg-surface px-3 py-2 text-xs text-gray-500 shadow-xl dark:text-gray-400"
      >
        {totalCount === 0 ? t('variables.none') : t('variables.noMatch', { query: query.query })}
      </div>
    );
  }

  return (
    <ul
      role="listbox"
      className="max-h-56 overflow-auto rounded-lg border border-foreground/10 bg-surface py-1 shadow-xl"
    >
      {options.map((option, index) => {
        const showHeader = index === 0 || option.scope !== options[index - 1].scope;

        return (
          <li key={`${option.scope}:${option.name}`}>
            {showHeader && (
              <div className="px-3 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
                {option.scope === 'local' ? t('variables.local') : t('variables.global')}
              </div>
            )}
            <button
              type="button"
              role="option"
              aria-selected={index === highlight}
              onMouseDown={(event) => {
                event.preventDefault();
                autocomplete.pick(option.name);
              }}
              onMouseEnter={() => {
                autocomplete.setHighlight(index);
              }}
              className={clsx(
                'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm',
                index === highlight ? 'bg-brand-500/15 text-foreground' : 'text-gray-600 dark:text-gray-300'
              )}
            >
              <span className="font-mono text-brand-600 dark:text-brand-300">#</span>
              {option.name}
            </button>
          </li>
        );
      })}
    </ul>
  );
};

// Sensible bounds for the floating (canvas) popover: wide enough to read names, narrow enough to
// stay a picker.
const FLOATING_MIN_W = 220;
const FLOATING_MARGIN = 8;

/**
 * The suggestion box for hosts whose ancestors clip or transform (the canvas inline editors sit in
 * an overflow-hidden, transformed frame): a body portal positioned under the anchor element with
 * `fixed` coordinates, clamped to the viewport. Measured on every render while open — each
 * keystroke re-renders the host, so the box stays glued to the textarea.
 */
export const FloatingVariableSuggestions = ({
  autocomplete,
  totalCount,
  anchor,
}: VariableSuggestionsProps & { anchor: HTMLElement | null }) => {
  if (!autocomplete.query || !anchor) return null;

  const rect = anchor.getBoundingClientRect();
  const left = Math.max(FLOATING_MARGIN, Math.min(rect.left, window.innerWidth - FLOATING_MIN_W - FLOATING_MARGIN));

  return createPortal(
    <div style={{ position: 'fixed', left, top: rect.bottom + 4, minWidth: FLOATING_MIN_W, zIndex: 60 }}>
      <VariableSuggestions autocomplete={autocomplete} totalCount={totalCount} />
    </div>,
    document.body
  );
};
