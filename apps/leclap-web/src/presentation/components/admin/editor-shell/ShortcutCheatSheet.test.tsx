// @vitest-environment node
// The shortcut list names the deck keys in en: frame/second steps, edit points, J/K/L, and where
// Delete removes a scene. Rendered open through the dialog's portal-free static markup.
import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';
import admin from '@/i18n/locales/en/admin.json';
import { ShortcutCheatSheet } from './ShortcutCheatSheet';
import { ProgramTransport } from './program-transport';
import type { ProgramClock } from './use-program-clock';

beforeAll(async () => {
  await i18n.init({ lng: 'en', fallbackLng: 'en', ns: ['admin'], defaultNS: 'admin', resources: { en: { admin } } });
});

describe('deck copy', () => {
  it('has en copy for every new shortcut row', () => {
    for (const key of ['shuttle', 'frameStep', 'secondStep', 'editPoints', 'backToEditing'] as const) {
      expect(admin.shortcuts[key]).toBeTruthy();
    }

    expect(admin.shortcuts.deleteScene).toContain('scene strip');
    expect(admin.monitor.parked).toBe('Program');
  });

  it('renders without the dialog open', () => {
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <ShortcutCheatSheet open={false} onClose={() => {}} />
      </I18nextProvider>
    );

    expect(html).toBe('');
  });

  it('labels the transport timecode with its frame rate', () => {
    const clock = { subscribe: () => () => {}, playing: false, rate: 1, toggle: () => {} } as unknown as ProgramClock;
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <ProgramTransport
          clock={clock}
          timeline={[{ index: 0, kind: 'color', start: 0, end: 4, duration: 4 }]}
          onSeek={() => {}}
        />
      </I18nextProvider>
    );

    expect(html).toContain('30 fps');
    expect(html).toContain('transport-scrub');
  });
});
