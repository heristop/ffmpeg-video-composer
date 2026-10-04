import { expect, it } from 'vitest';
import { buildDescriptor, toEditorState } from '../src/editor/templateEditorModel';

it('preserves a creative brief when an editor changes the template name', () => {
  const state = toEditorState({
    id: 'promo',
    name: 'Promo',
    description: '',
    orientation: 'landscape',
    descriptor: { meta: { creativeDirection: 'Editorial launch; keep the product interaction visible.' } },
  });
  state.name = 'Revised promo';
  expect(buildDescriptor(state).meta).toMatchObject({
    name: 'Revised promo',
    creativeDirection: 'Editorial launch; keep the product interaction visible.',
  });
});
