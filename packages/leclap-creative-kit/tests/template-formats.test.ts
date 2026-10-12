import { describe, expect, it } from 'vitest';

import {
  APP_TEMPLATES,
  APP_TEMPLATES_BY_ID,
  appTemplateInFormat,
  findAppTemplate,
  resolveTemplateRef,
  type AppTemplate,
} from '../src/index';

type Bag = Record<string, unknown>;

const presentYourself = (): AppTemplate => {
  const template = APP_TEMPLATES_BY_ID['present-yourself'];

  if (!template) throw new Error('present-yourself is missing from the catalog');

  return template;
};

const section = (template: AppTemplate, name: string): Bag | undefined =>
  (template.descriptor.sections as Bag[] | undefined)?.find((candidate) => candidate.name === name);

describe('one template, several formats', () => {
  it('lists Present Yourself once, rendering landscape and portrait', () => {
    expect(APP_TEMPLATES.filter((template) => template.name.startsWith('Present Yourself'))).toHaveLength(1);
    expect(APP_TEMPLATES_BY_ID['present-yourself-portrait']).toBeUndefined();
    expect(presentYourself().orientation).toBe('landscape');
    expect(presentYourself().formats).toEqual(['landscape', 'portrait']);
  });

  it('lists a single-format template with its own orientation only', () => {
    expect(APP_TEMPLATES_BY_ID['story-reel']?.formats).toEqual(['portrait']);
  });

  it('composes the portrait format: portrait frame, geometry and bumper', () => {
    const portrait = appTemplateInFormat(presentYourself(), 'portrait');

    expect(portrait.id).toBe('present-yourself');
    expect(portrait.name).toBe('Present Yourself');
    expect(portrait.orientation).toBe('portrait');
    expect(portrait.category).toBe('portrait');
    expect(portrait.descriptor.global?.orientation).toBe('portrait');
    expect(portrait.descriptor.formats).toBeUndefined();
    expect(section(portrait, 'intro')).toMatchObject({
      camera: { amount: 0.12 },
      titleCard: { headlineStyle: { fontsize: 76 } },
    });
    expect(section(portrait, 'video_1')?.graphics).toContainEqual(
      expect.objectContaining({ id: 'name-glow', target: { x: 0, y: 1024, w: 720, h: 256 } })
    );
    expect(section(portrait, 'logo_bumper')).toMatchObject({
      options: { videoUrl: expect.stringMatching(/leclap_bumper_portrait\.mp4$/) },
    });
  });

  it('keeps the landscape descriptor as authored', () => {
    const template = presentYourself();

    expect(appTemplateInFormat(template, 'landscape')).toBe(template);
  });

  it('ignores a format the template does not declare', () => {
    const template = presentYourself();

    expect(appTemplateInFormat(template, 'square')).toBe(template);
  });
});

describe('legacy template references', () => {
  it('maps the old portrait id to the merged template in portrait', () => {
    expect(resolveTemplateRef('present-yourself-portrait')).toEqual({ id: 'present-yourself', format: 'portrait' });
  });

  it('maps the old portrait name the same way', () => {
    expect(resolveTemplateRef('Present Yourself (Portrait)')).toEqual({ id: 'present-yourself', format: 'portrait' });
  });

  it('passes any other reference through', () => {
    expect(resolveTemplateRef('story-reel')).toEqual({ id: 'story-reel' });
  });

  it('finds the merged template from the old id, in portrait', () => {
    const template = findAppTemplate('present-yourself-portrait');

    expect(template?.id).toBe('present-yourself');
    expect(template?.orientation).toBe('portrait');
  });

  it('lets an explicit format win over the alias', () => {
    expect(findAppTemplate('present-yourself-portrait', 'landscape')?.orientation).toBe('landscape');
    expect(findAppTemplate('present-yourself', 'portrait')?.orientation).toBe('portrait');
    expect(findAppTemplate('missing')).toBeUndefined();
  });
});
