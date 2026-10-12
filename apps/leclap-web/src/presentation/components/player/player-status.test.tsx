// @vitest-environment node
// The player's stall loader: the header's LeClap mark clapping on a loop over the buffer meter, not Clappy.
import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';
import { en } from '@/i18n/locales/en';
import { PlayerStatus } from './player-status';
import type { MediaState } from './use-media-state';

const MEDIA: MediaState = {
  paused: false,
  waiting: true,
  failed: false,
  started: true,
  current: 4,
  duration: 20,
  buffered: 10,
  width: 1280,
  height: 720,
};

beforeAll(async () => {
  await i18n.init({
    lng: 'en',
    ns: ['player'],
    defaultNS: 'player',
    react: { useSuspense: false },
    resources: { en: { player: en.player } },
  });
});

const render = (media: MediaState): string =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <PlayerStatus media={media} onRetry={() => {}} />
    </I18nextProvider>
  );

describe('PlayerStatus loader', () => {
  it('claps the LeClap mark on a loop while the film stalls', () => {
    const html = render(MEDIA);

    expect(html).toContain('data-player-loader="logo"');
    expect(html).toContain('repeatCount="indefinite"');
  });

  it('keeps the buffer meter at what has loaded', () => {
    expect(render(MEDIA)).toContain('width:50%');
  });

  it('shows nothing while the film plays', () => {
    expect(render({ ...MEDIA, waiting: false })).toBe('');
  });
});
