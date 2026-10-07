// The Advanced panel's colour block: the template palette (colorsList) followed by the theme's
// "Match a reference" entry point.
import type { EditorState } from '../templateEditorModel';
import { ColorsListEditor } from './colors-list-editor';
import { ThemeReferenceField } from './theme-reference-field';

interface PaletteAndThemeProps {
  state: EditorState;
  patch: (p: Partial<EditorState>) => void;
}

export const PaletteAndTheme = ({ state, patch }: PaletteAndThemeProps) => (
  <>
    <ColorsListEditor state={state} patch={patch} />
    <ThemeReferenceField state={state} patch={patch} />
  </>
);
