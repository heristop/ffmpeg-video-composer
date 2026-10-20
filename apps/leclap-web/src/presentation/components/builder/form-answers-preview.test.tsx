// @vitest-environment node
// The studio monitor for a form scene lists the answers and whether a scene shows each one.
import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';
import builder from '@/i18n/locales/en/builder.json';
import type { Template, InputSection } from '@/services/templateService';
import { FormAnswersPreview, shownOnScreen } from './form-answers-preview';

beforeAll(async () => {
  await i18n.init({
    lng: 'en',
    fallbackLng: 'en',
    ns: ['builder'],
    defaultNS: 'builder',
    resources: { en: { builder } },
  });
});

const template = {
  descriptor: {
    sections: [
      {
        name: 'form_0',
        type: 'form',
        options: {
          fields: [
            { name: 'topic', label: { en: 'Topic' } },
            { name: 'note', label: { en: 'Note' } },
          ],
        },
      },
      {
        name: 'card',
        type: 'color_background',
        filters: [{ type: 'drawtext', values: { text: { en: 'On {{ topic }}' } } }],
      },
    ],
  },
} as unknown as Template;
const section: InputSection = { name: 'form_0', kind: 'form', clipIndex: -1 };

describe('FormAnswersPreview', () => {
  it('lists each answer, empty or filled, and whether it is on screen', () => {
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <FormAnswersPreview template={template} section={section} formData={{ topic: 'Launch' }} />
      </I18nextProvider>
    );

    expect(html).toContain(builder.editor.answersTitle);
    expect(html).toContain(builder.editor.answersLead);
    expect(html).toContain('Launch');
    expect(html).toContain(builder.editor.answersEmpty);
    expect(html).toContain(builder.editor.answersShown);
    expect(html).toContain(builder.editor.answersNotShown);
  });

  it('finds a field shown by a scene', () => {
    expect(shownOnScreen(template, 'topic')).toBe(true);
    expect(shownOnScreen(template, 'note')).toBe(false);
  });
});

describe('studio create button copy', () => {
  it('says what is missing while the video cannot be made yet', () => {
    expect(builder.hub.createBlocked).toBe('Fill every scene first ({{done}} of {{total}} ready)');
  });
});
