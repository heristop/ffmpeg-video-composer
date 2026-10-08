import { describe, it, expect } from 'vitest';
import { newHtmlLayer, newSection, type EditorSection, type HtmlLayer } from '../templateEditorModel';
import { addElement, canAddElement, listSectionElements, removeElement, reorderElement } from './sectionElements';

function layers(patch: Partial<EditorSection>): HtmlLayer[] | undefined {
  return (patch as { htmlLayers?: HtmlLayer[] }).htmlLayers;
}

describe('html layers as section elements', () => {
  it('can be added to every visual section, not to form or music', () => {
    expect(canAddElement(newSection('video'), 'html')).toBe(true);
    expect(canAddElement(newSection('color'), 'html')).toBe(true);
    expect(canAddElement(newSection('image'), 'html')).toBe(true);
    expect(canAddElement(newSection('form'), 'html')).toBe(false);
    expect(canAddElement(newSection('music'), 'html')).toBe(false);
  });

  it('adds a starter layer and selects it', () => {
    const added = addElement(newSection('color'), 'html');

    expect(added?.ref).toEqual({ kind: 'html', index: 0 });
    expect(layers(added?.patch ?? {})?.[0]).toMatchObject({ width: expect.any(Number), html: expect.any(String) });
  });

  it('lists layers after the animations, previewed by their name or their text', () => {
    const section = {
      ...newSection('color'),
      htmlLayers: [
        { ...newHtmlLayer(), name: 'price_tag' },
        { ...newHtmlLayer(), html: '<p>Just <b>listed</b> in {{ city }}</p>' },
      ],
    } as EditorSection;

    const rows = listSectionElements(section);

    expect(rows.map((row) => [row.labelKey, row.previewText])).toEqual([
      ['element.html', 'price_tag'],
      ['element.html', 'Just listed in #city'],
    ]);
  });

  it('removes and reorders like the other array kinds', () => {
    const first = { ...newHtmlLayer(), name: 'a' };
    const second = { ...newHtmlLayer(), name: 'b' };
    const section = { ...newSection('video'), htmlLayers: [first, second] } as EditorSection;

    expect(layers(removeElement(section, { kind: 'html', index: 0 }))).toEqual([second]);
    expect(layers(reorderElement(section, { kind: 'html', index: 1 }, -1))).toEqual([second, first]);
  });
});
