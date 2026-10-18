// @vitest-environment node
// Static-markup test (the web app has no jsdom/RTL): the section carries the English copy and the
// imported brand; the locale files all define the same keys.
import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';
import ai from '@/i18n/locales/en/ai.json';
import de from '@/i18n/locales/de/ai.json';
import es from '@/i18n/locales/es/ai.json';
import fr from '@/i18n/locales/fr/ai.json';
import itLocale from '@/i18n/locales/it/ai.json';
import { BrandKitSection } from './BrandKitSection';

beforeAll(async () => {
  await i18n.init({ lng: 'en', fallbackLng: 'en', ns: ['ai'], defaultNS: 'ai', resources: { en: { ai } } });
});

const noop = () => {};

function render(attached: string | null): string {
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <BrandKitSection attached={attached} onAttach={noop} onDetach={noop} disabled={false} />
    </I18nextProvider>
  );
}

describe('BrandKitSection', () => {
  it('shows the English label and an Optional summary while no brand is attached', () => {
    const html = render(null);

    expect(html).toContain('Your brand');
    expect(html).toContain('Optional');
  });

  it('carries the English hint in the locale file', () => {
    expect(ai.brand.hint).toContain('Import a brand-kit.json');
  });

  it('shows the imported brand and a remove button', () => {
    const html = render('Acme');

    expect(html).toContain('Brand: Acme');
    expect(html).toContain('Remove brand');
    expect(html).toContain('Import a brand-kit.json');
    expect(html).not.toContain('type="file"');
  });

  it('is translated in every locale', () => {
    for (const locale of [de, es, fr, itLocale]) {
      expect(Object.keys(locale.brand).sort()).toEqual(Object.keys(ai.brand).sort());
    }
  });
});
