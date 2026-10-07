// Declared fields no form section asks for still need a value: the builder lists them as a "template
// inputs" scene, counted in the progress and pointed at by the next cue, instead of reporting every scene
// done and letting the render fail on the missing value.
import { describe, expect, it } from 'vitest';
import { templateService, type Template } from '@/services/templateService';
import { TEMPLATE_INPUTS_SECTION } from '@/services/template-inputs';
import { hubProgress, nextCue, sectionComplete, type SceneModel } from './sceneStatus';

const template = {
  id: 't',
  descriptor: {
    global: {
      fields: {
        TITLE: { type: 'text', required: true },
        HOLD: { type: 'number', default: 3 },
        CITY: { type: 'text', required: true },
      },
    },
    sections: [
      { name: 'f', type: 'form', options: { fields: [{ name: 'CITY', maxLength: 20, label: { en: 'City' } }] } },
      {
        name: 'card',
        type: 'color_background',
        options: { backgroundColor: '#000000', duration: '{{ HOLD }}' },
        filters: [{ type: 'drawtext', values: { text: { en: '{{ TITLE }} {{ CITY }}' } } }],
      },
    ],
  },
} as unknown as Template;

function model(formData: Record<string, string>): SceneModel {
  return {
    clipsBySection: {},
    rushesBySection: {},
    editsBySection: {},
    formData,
    musicChoice: null,
    backgroundChoice: null,
  };
}

describe('declared fields bound to no form section', () => {
  const sections = templateService.orderedInputSections(template.descriptor);
  const inputs = sections.find((section) => section.name === TEMPLATE_INPUTS_SECTION);

  it('get their own scene, asking only for them', () => {
    expect(inputs?.kind).toBe('form');
    expect(
      templateService.extractFormFieldsForSection(template.descriptor, TEMPLATE_INPUTS_SECTION).map((f) => f.name)
    ).toEqual(['TITLE', 'HOLD']);
  });

  it('keep the progress and the next cue open until the required one is filled', () => {
    const filledForm = model({ CITY: 'Lyon' });

    expect(hubProgress(sections, template, filledForm, false).remaining).toBe(1);
    expect(sections[nextCue(sections, template, filledForm, false).nextSectionIndex]?.name).toBe(
      TEMPLATE_INPUTS_SECTION
    );
    expect(inputs && sectionComplete(template, inputs, filledForm)).toBe(false);

    const done = model({ CITY: 'Lyon', TITLE: 'Launch' });

    expect(hubProgress(sections, template, done, false).remaining).toBe(0);
    expect(nextCue(sections, template, done, false).nextSectionIndex).toBe(-1);
  });

  it('adds no scene when every declared field has a form', () => {
    const bound = {
      ...template.descriptor,
      global: { fields: { CITY: { type: 'text', required: true } } },
    } as unknown as Template['descriptor'];

    expect(templateService.orderedInputSections(bound).map((section) => section.name)).toEqual(['f']);
  });
});
