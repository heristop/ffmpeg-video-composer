// @vitest-environment node
// The program monitor for a music scene: the default (or stand-in) track with its transport, and the
// line naming what viewers can switch to.
import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';
import admin from '@/i18n/locales/en/admin.json';
import { MUSIC_LIBRARY } from '@/data/mediaCatalog';
import { MusicStagePreview } from './music-stage-preview';

beforeAll(async () => {
  await i18n.init({ lng: 'en', fallbackLng: 'en', ns: ['admin'], defaultNS: 'admin', resources: { en: { admin } } });
});

const render = (allowed: string[], allowUpload = false) =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <MusicStagePreview section={{ kind: 'music', allowed, allowUpload }} />
    </I18nextProvider>
  );

const [a, b, c, d] = MUSIC_LIBRARY;

describe('MusicStagePreview', () => {
  it('shows the default track and names the alternatives', () => {
    const html = render([b.id, a.id, c.id]);

    expect(html).toContain(b.title);
    expect(html).toContain(`>${admin.musicSection.default}<`);
    expect(html).toContain(`Viewers can switch to ${a.title} and ${c.title}.`);
    expect(html).toContain(`aria-label="Preview ${b.title}"`);
  });

  it('counts the alternatives past the second', () => {
    expect(render([a.id, b.id, c.id, d.id, MUSIC_LIBRARY[4].id])).toContain(
      `Viewers can switch to ${b.title}, ${c.title} and 2 more.`
    );
  });

  it('says when viewers get one track, and when they can upload', () => {
    expect(render([a.id])).toContain(admin.monitor.musicOnlyTrack);
    expect(render([a.id], true)).toContain(admin.monitor.musicUploadToo);
  });

  it('labels the stand-in when nothing is ticked', () => {
    const html = render([]);

    expect(html).toContain(admin.monitor.musicStandIn);
    expect(html).toContain(admin.monitor.musicStandInNote);
    expect(html).toContain(a.title);
  });
});
