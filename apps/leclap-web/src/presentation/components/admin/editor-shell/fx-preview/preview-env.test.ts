import { describe, expect, it } from 'vitest';
import type { Graphic } from 'ffmpeg-video-composer/src/schemas/graphics.schemas.ts';
import { newSection, type EditorSection, type EditorState } from '../../templateEditorModel';
import { initialSectionSelection } from '../useSectionSelection';
import { previewEnvOf, sectionGraphics, sectionSeconds, selectedEffect } from './preview-env';

const graphics = [{ type: 'fx', effect: 'sheen' }] as Graphic[];
const section = { ...newSection('color'), duration: 5, graphics } as EditorSection;

describe('the canvas effect preview context', () => {
  it('reads the template settings the plans depend on', () => {
    const state = {
      orientation: 'portrait',
      sections: [newSection('video'), section],
      motion: { seed: 3, theme: { extends: 'leclap' }, tokens: { energy: 1.4 } },
    } as unknown as EditorState;

    expect(previewEnvOf(state, section, true)).toMatchObject({
      orientation: 'portrait',
      sectionIndex: 1,
      sectionSeconds: 5,
      globalSeed: 3,
      tokens: { energy: 1.4 },
      reduced: true,
    });
  });

  it('previews only a selected engine effect', () => {
    expect(selectedEffect(section, { ...initialSectionSelection, element: { kind: 'effect', index: 0 } })).toBe(0);
    expect(
      selectedEffect(section, { ...initialSectionSelection, element: { kind: 'effect', index: 4 } })
    ).toBeUndefined();
    expect(
      selectedEffect(section, { ...initialSectionSelection, element: { kind: 'text', index: 0 } })
    ).toBeUndefined();
    expect(selectedEffect(section, initialSectionSelection)).toBeUndefined();
  });

  it('falls back on an open length and an empty list', () => {
    expect(sectionSeconds(newSection('form'))).toBe(12);
    expect(sectionGraphics(newSection('form'))).toEqual([]);
    expect(sectionGraphics(section)).toBe(graphics);
  });
});
