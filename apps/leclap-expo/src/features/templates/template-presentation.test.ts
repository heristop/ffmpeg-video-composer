import { filterTemplates, templatePresentation, templateColumns } from './template-presentation';
import type { Template } from '@/src/types';

const template: Template = {
  name: 'morning-story.json',
  source: 'sample',
  content: {
    global: { variables: { place: 'Lyon' }, orientation: 'portrait' },
    sections: [
      {
        name: 'intro',
        type: 'text',
        title: { fr: 'Café du matin' },
        description: { fr: 'Une histoire à {{ place }}' },
      },
    ],
  },
};

describe('template discovery', () => {
  it('searches templates without an English translation without crashing', () => {
    expect(filterTemplates([template], 'cafe', 'fr')).toEqual([template]);
  });
  it('matches resolved variables, accents, surrounding spaces and displayed names', () => {
    expect(filterTemplates([template], ' LYON ', 'fr-FR')).toEqual([template]);
    expect(filterTemplates([template], 'morning story', 'en')).toEqual([template]);
    expect(filterTemplates([template], 'missing', 'fr')).toEqual([]);
  });
  it('keeps order and the source array intact for an empty search', () => {
    expect(filterTemplates([template], ' ', 'fr')).toEqual([template]);
    expect(template.name).toBe('morning-story.json');
  });
  it('uses descriptor metadata and region-aware descriptions', () => {
    const withMeta = {
      ...template,
      content: { ...template.content, meta: { name: 'Morning story', description: 'A short film' } },
    };
    expect(templatePresentation(withMeta, 'fr-FR')).toMatchObject({
      title: 'Morning story',
      description: 'Une histoire à Lyon',
      orientation: 'portrait',
    });
  });
  it('falls back to a meaningful name and the engine’s landscape default', () => {
    expect(templatePresentation({ name: 'web-app-promo.json', content: {} }, 'en')).toMatchObject({
      title: 'Web App Promo',
      orientation: 'landscape',
    });
  });
  it('supports tablet grids and one-column layouts for large text', () => {
    expect(templateColumns(375, 1)).toBe(2);
    expect(templateColumns(768, 1)).toBe(3);
    expect(templateColumns(1120, 1)).toBe(4);
    expect(templateColumns(720, 1)).toBe(3);
    expect(templateColumns(375, 1.5)).toBe(1);
    expect(templateColumns(320, 1)).toBe(1);
  });
});
