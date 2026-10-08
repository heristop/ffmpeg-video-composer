import { describe, expect, it } from 'vitest';
import { toEditorState, type EditorState } from '../../templateEditorModel';
import { htmlPreviewEnv } from './html-layer-env';

function state(patch: Partial<EditorState>): EditorState {
  return { ...toEditorState(null), ...patch };
}

describe('htmlPreviewEnv', () => {
  it('fills placeholders from field defaults, variables and form fields (their label as a sample)', () => {
    const env = htmlPreviewEnv(
      state({
        motion: { theme: 'leclap', fields: { address: { type: 'text', default: '12 rue des Lilas' } } },
        globalVariables: [
          { name: 'city', value: 'Lyon' },
          { name: ' ', value: 'ignored' },
        ],
        sections: [{ kind: 'form', fields: [{ name: 'agent', label: 'Agent name', maxLength: 40 }] }],
      })
    );

    expect(env.global).toEqual({ theme: 'leclap' });
    expect(env.values).toEqual({ address: '12 rue des Lilas', city: 'Lyon', agent: 'Agent name' });
    expect(env.fields).toEqual([
      { name: 'address', source: 'field' },
      { name: 'city', source: 'variable' },
      { name: 'agent', source: 'form' },
    ]);
  });

  it('reads fields declared as a list too', () => {
    const env = htmlPreviewEnv(state({ motion: { fields: [{ name: 'price', type: 'text', default: '420 000 €' }] } }));

    expect(env.values).toEqual({ price: '420 000 €' });
  });

  it('has no theme without one', () => {
    expect(htmlPreviewEnv(state({})).global).toEqual({});
  });
});
