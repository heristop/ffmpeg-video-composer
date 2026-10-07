// @vitest-environment node
// Static-markup test for the landing's "See it in action" section: next to the studio call to action it
// links to the showcase, the templates and the docs, each with its translated label.
import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import i18n from 'i18next';
import home from '@/i18n/locales/en/home.json';
import { HomeShowcase } from './HomeShowcase';

beforeAll(async () => {
  await i18n.init({ lng: 'en', fallbackLng: 'en', ns: ['home'], defaultNS: 'home', resources: { en: { home } } });
});

function render(): string {
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <HomeShowcase />
      </MemoryRouter>
    </I18nextProvider>
  );
}

describe('HomeShowcase', () => {
  it('links to the showcase with its label', () => {
    const html = render();

    expect(html).toContain('href="/showcase"');
    expect(html).toContain(home.showcase.viewShowcase);
  });

  it('keeps the templates and docs links next to it', () => {
    const html = render();

    expect(html).toContain('href="/templates"');
    expect(html).toContain('href="/doc"');
  });
});
