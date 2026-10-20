import { describe, expect, it } from 'vitest';
import { newSection, type EditorSection } from '../../templateEditorModel';
import { fieldIdProblem, followsLabel, moveField, scenesUsing, slugFieldId, uniqueFieldId } from './form-fields.logic';

describe('field ids', () => {
  it('derives a word-character id from the label', () => {
    expect(slugFieldId('Your topic')).toBe('your_topic');
    expect(slugFieldId('Prénom & nom')).toBe('prenom_nom');
    expect(slugFieldId('  ')).toBe('');
  });

  it('keeps ids unique across the template', () => {
    expect(uniqueFieldId('Topic', new Set(['topic', 'topic_2']), 3)).toBe('topic_3');
    expect(uniqueFieldId('', new Set(), 2)).toBe('field_2');
  });

  it('knows when the id still follows its label', () => {
    expect(followsLabel({ name: 'your_topic', label: 'Your topic', maxLength: 40 }, 1)).toBe(true);
    expect(followsLabel({ name: 'field_2', label: 'Anything', maxLength: 40 }, 2)).toBe(true);
    expect(followsLabel({ name: 'form_1_topic', label: 'Topic', maxLength: 40 }, 1)).toBe(false);
  });

  it('flags an empty id, a bad character and a duplicate', () => {
    expect(fieldIdProblem('', [])).toBe('empty');
    expect(fieldIdProblem('my-topic', [])).toBe('chars');
    expect(fieldIdProblem('topic', ['topic'])).toBe('duplicate');
    expect(fieldIdProblem('topic', ['name'])).toBeNull();
  });
});

describe('scenesUsing', () => {
  it('finds the scenes whose text shows the field', () => {
    const color = newSection('color') as Extract<EditorSection, { kind: 'color' }>;
    const sections: EditorSection[] = [
      newSection('form'),
      { ...color, overlays: [] },
      { ...color, titleCard: { headline: { en: 'About {{ topic }}' } } } as EditorSection,
    ];

    expect(scenesUsing(sections, 'topic')).toEqual([3]);
    expect(scenesUsing(sections, 'name')).toEqual([]);
  });
});

describe('moveField', () => {
  it('moves a field and clamps at the ends', () => {
    expect(moveField(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveField(['a', 'b', 'c'], 2, 5)).toEqual(['a', 'b', 'c']);
    expect(moveField(['a', 'b', 'c'], 1, 0)).toEqual(['b', 'a', 'c']);
  });
});
