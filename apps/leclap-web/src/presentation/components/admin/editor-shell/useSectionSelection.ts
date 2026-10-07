import { useCallback, useEffect, useReducer } from 'react';

// Which element inside the current section is selected. `kind` covers every element a section
// canvas can surface (background color layers, text/image overlays, animations, engine effects (the
// section's `graphics`), and the structured
// text sugar) so a single selection state drives the inspector for all of them. The sugar kinds
// (caption/titleCard/lowerThird) are per-section singletons — their index is always 0.
export interface ElementRef {
  kind: 'text' | 'layer' | 'image' | 'animation' | 'effect' | 'caption' | 'titleCard' | 'lowerThird';
  index: number;
}

// The selection a section's canvas and inspector share: at most one element, optionally being
// inline-edited (the canvas textarea). `editing` is only meaningful while an element is selected.
export interface SectionSelectionState {
  element: ElementRef | null;
  editing: boolean;
}

export type SectionSelectionAction =
  | { type: 'selectText'; index: number }
  | { type: 'selectElement'; ref: ElementRef }
  | { type: 'clear' }
  | { type: 'beginEdit' }
  | { type: 'endEdit' };

export const initialSectionSelection: SectionSelectionState = { element: null, editing: false };

// Pure transitions. selectText replaces the selection and drops any inline edit; beginEdit only
// arms editing when an element is already selected; clear/endEdit reset their slice.
export const sectionSelectionReducer = (
  state: SectionSelectionState,
  action: SectionSelectionAction
): SectionSelectionState => {
  if (action.type === 'selectText') {
    return { element: { kind: 'text', index: action.index }, editing: false };
  }

  if (action.type === 'selectElement') {
    return { element: action.ref, editing: false };
  }

  if (action.type === 'clear') {
    return initialSectionSelection;
  }

  if (action.type === 'beginEdit') {
    if (!state.element) return state;

    return { ...state, editing: true };
  }

  return { ...state, editing: false };
};

// The shared selection for the section keyed by `sectionKey` (its index in the shell). Switching
// sections resets the selection so a stale overlay index never bleeds across scenes.
export const useSectionSelection = (sectionKey: string) => {
  const [state, dispatch] = useReducer(sectionSelectionReducer, initialSectionSelection);

  useEffect(() => {
    dispatch({ type: 'clear' });
  }, [sectionKey]);

  const selectText = useCallback((index: number | null) => {
    if (index === null) {
      dispatch({ type: 'clear' });

      return;
    }
    dispatch({ type: 'selectText', index });
  }, []);

  const selectElement = useCallback((ref: ElementRef | null) => {
    if (ref === null) {
      dispatch({ type: 'clear' });

      return;
    }
    dispatch({ type: 'selectElement', ref });
  }, []);

  const clear = useCallback(() => {
    dispatch({ type: 'clear' });
  }, []);

  const beginEdit = useCallback(() => {
    dispatch({ type: 'beginEdit' });
  }, []);

  const endEdit = useCallback(() => {
    dispatch({ type: 'endEdit' });
  }, []);

  return { state, selectText, selectElement, clear, beginEdit, endEdit };
};
