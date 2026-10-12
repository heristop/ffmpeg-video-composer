import { buildCatalog, findInCatalog } from './catalog';
import { SAMPLE_TEMPLATES } from './sampleTemplates';

type Bag = Record<string, unknown>;

const sectionNamed = (content: { sections?: unknown[] }, name: string): Bag | undefined =>
  (content.sections as Bag[] | undefined)?.find((section) => section.name === name);

// Present Yourself is one template in two formats; on the phone it opens in portrait.
describe('local template catalog', () => {
  it('lists Present Yourself once', () => {
    expect(buildCatalog([]).filter((template) => template.name.startsWith('Present Yourself'))).toHaveLength(1);
  });

  it('opens a template that composes a portrait format in portrait', () => {
    const template = findInCatalog([], 'Present Yourself');

    expect(template?.id).toBe('present-yourself');
    expect(template?.content.global?.orientation).toBe('portrait');
    expect(sectionNamed(template!.content, 'logo_bumper')).toMatchObject({
      options: { videoUrl: expect.stringMatching(/leclap_bumper_portrait\.mp4$/) },
    });
    expect(SAMPLE_TEMPLATES.find((sample) => sample.id === 'present-yourself')?.orientation).toBe('portrait');
  });

  it('leaves a landscape-only template landscape', () => {
    expect(SAMPLE_TEMPLATES.find((sample) => sample.id === 'photo-backdrop')?.orientation).toBe('landscape');
  });

  it('resolves a project saved on the retired portrait variant', () => {
    const template = findInCatalog([], 'Present Yourself (Portrait)');

    expect(template?.name).toBe('Present Yourself');
    expect(template?.content.global?.orientation).toBe('portrait');
  });
});
