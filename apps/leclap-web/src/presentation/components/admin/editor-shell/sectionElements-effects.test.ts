import { describe, expect, it } from 'vitest';
import { newSection, type EditorSection } from '../templateEditorModel';
import { addElement, canAddElement, listSectionElements, removeElement, reorderElement } from './sectionElements';

// A video section carrying one animation and two engine effects (section.graphics).
function withEffects(): EditorSection {
  return {
    ...newSection('video'),
    animations: [{ id: 'a', url: '/assets/animations/confetti.apng' }],
    graphics: [
      { type: 'fx', effect: 'glint', path: 'orbit', at: 0.4 },
      { type: 'flash', at: 1 },
    ],
  } as EditorSection;
}

describe('engine effects as section elements', () => {
  it('lists each graphic after the animations, labelled by its library entry', () => {
    const elements = listSectionElements(withEffects());

    expect(elements.map((element) => element.kind)).toEqual(['animation', 'effect', 'effect']);
    expect(elements[1]).toMatchObject({
      ref: { kind: 'effect', index: 0 },
      labelKey: 'element.effect',
      previewKey: 'animation.library.glint-orbit',
    });
    // A graphic the library does not offer reads as its type.
    expect(elements[2]).toMatchObject({ previewText: 'flash' });
  });

  it('removes and reorders effects, dropping the field when the last one goes', () => {
    const section = withEffects();
    const ref = { kind: 'effect' as const, index: 0 };

    expect(reorderElement(section, ref, 1)).toEqual({
      graphics: [
        { type: 'flash', at: 1 },
        { type: 'fx', effect: 'glint', path: 'orbit', at: 0.4 },
      ],
    });
    expect(removeElement(section, ref)).toEqual({ graphics: [{ type: 'flash', at: 1 }] });
    expect(removeElement({ ...section, graphics: [{ type: 'flash' }] } as EditorSection, ref)).toEqual({
      graphics: undefined,
    });
  });

  it('tells an effect row from an animation-file row', () => {
    const [file, effect] = listSectionElements(withEffects());

    expect(file).toMatchObject({ family: 'file', labelKey: 'element.animation', previewText: 'confetti.apng' });
    expect(effect).toMatchObject({ family: 'effect', labelKey: 'element.effect' });
  });

  it('labels an animation slot with nothing picked yet as "effect or file", with no family', () => {
    const section = { ...newSection('video'), animations: [{ id: 'a', url: '' }] } as EditorSection;
    const [slot] = listSectionElements(section);

    expect(slot.labelKey).toBe('element.animationPending');
    expect(slot.family).toBeUndefined();
  });

  it('never adds a blank effect: "Effect" and "Animation file" both open an empty animation slot', () => {
    const section = withEffects();

    expect(canAddElement(section, 'effect')).toBe(true);
    expect(canAddElement(section, 'animation')).toBe(true);
    for (const kind of ['effect', 'animation'] as const) {
      const added = addElement(section, kind);

      expect(added?.ref).toEqual({ kind: 'animation', index: 1 });
      expect(added?.patch).toEqual({
        animations: [{ id: 'a', url: '/assets/animations/confetti.apng' }, expect.objectContaining({ url: '' })],
      });
    }
    expect(canAddElement(newSection('music'), 'effect')).toBe(false);
  });
});
