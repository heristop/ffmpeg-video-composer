// @vitest-environment node
// Static-markup tests for the LeClap player: every control carries its translated name in all five languages,
// the speed chip reads the current speed, the poster wears the LeClap title card, and the picture-in-picture
// button names what it will do.
import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';
import { en } from '@/i18n/locales/en';
import { fr } from '@/i18n/locales/fr';
import { de } from '@/i18n/locales/de';
import { es } from '@/i18n/locales/es';
import { it as itLocale } from '@/i18n/locales/it';
import { PlayerPipButton } from './player-pip';
import { VideoPlayer, type VideoPlayerProps } from './video-player';

const LOCALES = { en, fr, de, es, it: itLocale } as const;

beforeAll(async () => {
  await i18n.init({
    lng: 'en',
    fallbackLng: false,
    ns: ['player', 'process'],
    defaultNS: 'player',
    react: { useSuspense: false },
    resources: Object.fromEntries(
      Object.entries(LOCALES).map(([lng, bundle]) => [lng, { player: bundle.player, process: bundle.process }])
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

function renderPip(active: boolean, available = true): string {
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <PlayerPipButton pip={{ available, active, toggle: () => {} }} />
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
    const html = render({});
    const pip = renderPip(false);
    await i18n.changeLanguage('en');

    for (const label of [
      bundle.player.play,
      bundle.player.seek,
      bundle.player.mute,
      bundle.player.fullscreen,
      bundle.player.controls,
    ]) {
      expect(html).toContain(`"${attribute(label)}"`);
    }

    expect(pip).toContain(`"${attribute(bundle.player.pip)}"`);
  });
});

describe('VideoPlayer', () => {
  it('shows the current speed on its chip, and names it', () => {
    const html = render({});

    expect(html).toContain('<span class="block">1×</span>');
    expect(html).toContain('aria-label="Playback speed, 1×"');
  });

  it('wears the LeClap title card on its poster', () => {
    const html = render({ cardTitle: 'Summer launch' });

    expect(html).toContain('Summer launch');
    expect(html).toContain('/favicon.svg');
  });

  it('waits on its poster with the play button', () => {
    expect(render({ poster: '/p.webp' })).toContain('data-player-center');
  });

  it('shows no picture-in-picture button before the browser has said it offers it', () => {
    expect(render({})).not.toContain('data-player-pip');
  });
});

describe('PlayerPipButton', () => {
  it('hides where the browser has no picture-in-picture', () => {
    expect(renderPip(false, false)).toBe('');
  });

  it('offers to leave the window while the video floats in it', () => {
    const html = renderPip(true);

    expect(html).toContain(`"${attribute(en.player.exitPip)}"`);
    expect(html).toContain('aria-pressed="true"');
  });
});
