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

it('carries pinned transcript records through an edit', () => {
  const resolved = {
    transcripts: { talk: { from: 'talk', engine: 'ios-speech', language: 'en', at: '2026-10-07T10:00:00.000Z' } },
  };
  const state = toEditorState({
    id: 'talk',
    name: 'Talk',
    description: '',
    orientation: 'portrait',
    descriptor: { meta: { resolved } },
  });

  expect(buildDescriptor(state).meta).toMatchObject({ resolved });
});
