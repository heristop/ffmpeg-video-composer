// @vitest-environment node
// The notice the builder shows after opening a template link. Rendered to static markup with the real
// English bundle: t() keys are not type-checked, so a missing `link.*` key would otherwise render as
// its raw key path without any test failing.
import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';
import admin from '@/i18n/locales/en/admin.json';
import adminDe from '@/i18n/locales/de/admin.json';
import adminEs from '@/i18n/locales/es/admin.json';
import adminFr from '@/i18n/locales/fr/admin.json';
import adminIt from '@/i18n/locales/it/admin.json';
import { TemplateLinkNotice } from './template-link-notice';

beforeAll(async () => {
  await i18n.init({ lng: 'en', fallbackLng: 'en', ns: ['admin'], defaultNS: 'admin', resources: { en: { admin } } });
});

function render(outcome: Parameters<typeof TemplateLinkNotice>[0]['outcome']): string {
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <TemplateLinkNotice outcome={outcome} onDismiss={() => {}} />
    </I18nextProvider>
  );
}

describe('TemplateLinkNotice', () => {
  it('lists the media to film, upload or pick again, by scene', () => {
    const html = render({
      kind: 'opened',
      rebind: [
        { file: 'take-1.mp4', section: 'demo', reason: 'local_path' },
        { file: 'track.mp3', section: null, reason: 'local_path' },
      ],
    });

    expect(html).toContain('role="status"');
    expect(html).toContain(admin.link.rebindTitle);
    expect(html).toContain(admin.link.rebindBody);
    expect(html).toContain('take-1.mp4 in “demo”');
    expect(html).toContain('track.mp3 (whole video)');
    expect(html).toContain(admin.link.privacy);
    expect(html).toContain(admin.link.dismiss);
    expect(html).not.toMatch(/link\.\w/);
  });

  it('renders nothing when every media file resolved', () => {
    expect(render({ kind: 'opened', rebind: [] })).toBe('');
  });

  it.each(Object.keys(admin.link.errors))('explains a %s link as an alert', (code) => {
    const html = render({ kind: 'failed', code: code as never, details: ['sections.0.type: Invalid option'] });

    expect(html).toContain('role="alert"');
    expect(html).toContain(admin.link.errorTitle);
    expect(html).toContain(admin.link.errors[code as keyof typeof admin.link.errors]);
    expect(html).toContain(admin.link.errorHint);
    expect(html).toContain('sections.0.type: Invalid option');
    expect(html).not.toMatch(/link\.\w/);
  });

  it('has the replace-draft and opening copy in every bundle key it uses', () => {
    for (const key of ['opening', 'replaceTitle', 'replaceBody', 'replaceConfirm', 'replaceCancel'] as const) {
      expect(i18n.t(`link.${key}`)).toBe(admin.link[key]);
      expect(admin.link[key].length).toBeGreaterThan(0);
    }
  });

  it('is translated with the same keys in all five languages', () => {
    const keys = (bundle: typeof admin.link): string[] =>
      [...Object.keys(bundle), ...Object.keys(bundle.errors).map((code) => `errors.${code}`)].sort();

    for (const bundle of [adminFr, adminDe, adminEs, adminIt]) {
      expect(keys(bundle.link)).toEqual(keys(admin.link));
      expect(bundle.link.rebindScene).toContain('{{section}}');
    }
  });
});
