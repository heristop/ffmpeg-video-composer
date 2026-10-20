// @vitest-environment node
// Each variable row says where its #name shows, or what is wrong with the name.
import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';
import admin from '@/i18n/locales/en/admin.json';
import { newSection, toEditorState, type EditorSection } from '../templateEditorModel';
import { GlobalVariablesEditor } from './GlobalVariablesEditor';

beforeAll(async () => {
  await i18n.init({ lng: 'en', fallbackLng: 'en', ns: ['admin'], defaultNS: 'admin', resources: { en: { admin } } });
});

const color = newSection('color') as Extract<EditorSection, { kind: 'color' }>;

function render(globalVariables: Array<{ name: string; value: string }>) {
  const state = {
    ...toEditorState(null),
    sections: [{ ...color, titleCard: { headline: { en: 'By {{ brand }}' } } } as EditorSection],
    globalVariables,
  };

  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <GlobalVariablesEditor state={state} patch={() => {}} />
    </I18nextProvider>
  );
}

describe('GlobalVariablesEditor notes', () => {
  it('says where a variable shows, or that it is unused', () => {
    const html = render([
      { name: 'brand', value: 'LeClap' },
      { name: 'slogan', value: 'Cut' },
    ]);

    expect(html).toContain('Shown in scene 1.');
    expect(html).toContain('Not used yet. Type #slogan in a text to show it.');
  });

  it('flags a bad character and a duplicate name', () => {
    const html = render([
      { name: 'brand name', value: '' },
      { name: 'brand', value: '' },
      { name: 'brand', value: '' },
    ]);

    expect(html).toContain(admin.editor.variables.problem.chars);
    expect(html).toContain(admin.editor.variables.problem.duplicate);
  });
});
