// @vitest-environment node
// Static-markup tests for the LeClap player: every control carries its translated name in all five languages,
// the speed button reads the current speed, and the embed code is offered only for a video with a public address.
import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from 'i18next';
import { en } from '@/i18n/locales/en';
import { fr } from '@/i18n/locales/fr';
import { de } from '@/i18n/locales/de';
import { es } from '@/i18n/locales/es';
import { it as itLocale } from '@/i18n/locales/it';
import { EmbedPage } from '@/presentation/pages/embed';
import { VideoPlayer, type VideoPlayerProps } from './video-player';

const LOCALES = { en, fr, de, es, it: itLocale } as const;
const sample = { ref: { kind: 'sample', id: 'effects-tour' }, title: 'Effects tour', shape: 'landscape' } as const;

beforeAll(async () => {
  await i18n.init({
    lng: 'en',
    fallbackLng: false,
    ns: ['player', 'home', 'process', 'seo'],
    defaultNS: 'player',
    react: { useSuspense: false },
    resources: Object.fromEntries(
      Object.entries(LOCALES).map(([lng, bundle]) => [
        lng,
        { player: bundle.player, home: bundle.home, process: bundle.process, seo: bundle.seo },
      ])
    ),
  });
});

function render(props: Partial<VideoPlayerProps>): string {
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <VideoPlayer title="Demo" src="/videos/showcase/effects-tour.mp4" {...props} />
    </I18nextProvider>
  );
}

const attribute = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll("'", '&#x27;');

describe('player locales', () => {
  it('has the same keys in every language', () => {
    const keys = Object.keys(en.player).toSorted();

    for (const bundle of Object.values(LOCALES)) {
      expect(Object.keys(bundle.player).toSorted()).toEqual(keys);
    }
  });

  it.each(Object.entries(LOCALES))('names every control in %s', async (lng, bundle) => {
    await i18n.changeLanguage(lng);
    const html = render({ embed: sample, captions: { src: '/c.vtt', lang: 'en' } });
    await i18n.changeLanguage('en');

    for (const label of [
      bundle.player.play,
      bundle.player.seek,
      bundle.player.mute,
      bundle.player.captions,
      bundle.player.more,
      bundle.player.fullscreen,
      bundle.player.controls,
    ]) {
      expect(html).toContain(`"${attribute(label)}"`);
    }
  });
});

describe('VideoPlayer', () => {
  it('shows the current speed on its button', () => {
    expect(render({})).toContain('>1×</button>');
  });

  it('offers the embed code for a video the site serves', () => {
    expect(render({ embed: sample })).toContain('data-player-more');
  });

  it('never offers it for a local render', () => {
    expect(render({ src: 'blob:https://leclap.dev/123', embed: sample })).not.toContain('data-player-more');
    expect(render({})).not.toContain('data-player-more');
  });

  it('offers captions only where the video has them', () => {
    expect(render({})).not.toContain(`"${en.player.captions}"`);
  });

  it('waits on its poster with the play button', () => {
    expect(render({ poster: '/p.webp' })).toContain('data-player-center');
  });
});

function renderEmbed(path: string): string {
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/embed/:kind/:id" element={<EmbedPage />} />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>
  );
}

describe('EmbedPage', () => {
  it('plays a showcase sample alone, with a way back to LeClap', () => {
    const html = renderEmbed('/embed/sample/effects-tour');

    expect(html).toContain('/videos/showcase/effects-tour.mp4');
    expect(html).toContain('https://leclap.dev/showcase?sample=effects-tour');
    expect(html).toContain(en.player.watchOn);
    expect(html).not.toContain('<header');
  });

  it('plays a film in its language, with its captions', () => {
    const html = renderEmbed('/embed/film/agentic?lang=fr');

    expect(html).toContain('/videos/films/leclap-agentic.fr.mp4');
    expect(html).toContain('/videos/films/leclap-agentic.fr.vtt');
  });

  it('says so for a video it cannot play', () => {
    expect(renderEmbed('/embed/sample/nope')).toContain(en.player.notFound);
    expect(renderEmbed('/embed/render/abc')).toContain(en.player.notFound);
  });
});
