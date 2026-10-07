// @vitest-environment node
// Static-markup test for the landing phone's live render screen (chapter 03): it opens on the app's render
// screen at 0%, in the visitor's language, with the finished state laid out beside it, and stays decorative.
// The t() keys are not type-checked, so this also guards the new `mobile.screen` strings.
import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';
import home from '@/i18n/locales/en/home.json';
import process from '@/i18n/locales/en/process.json';
import { RenderScreen } from './render-screen';

beforeAll(async () => {
  await i18n.init({
    lng: 'en',
    fallbackLng: 'en',
    ns: ['home', 'process'],
    defaultNS: 'home',
    resources: { en: { home, process } },
  });
});

const render = (): string =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <RenderScreen anchor={null} live={false} />
    </I18nextProvider>
  );

describe('RenderScreen', () => {
  it('opens on the app render screen at 0%, preparing the scenes', () => {
    const html = render();

    expect(html).toContain(home.mobile.screen.title);
    expect(html).toContain('0%');
    expect(html).toContain(home.mobile.screen.preparing);
    expect(html).toContain(home.mobile.screen.private);
    expect(html).toContain(home.mobile.screen.cancel);
    expect(html).toContain('scaleX(0)');
  });

  it('lays the finished state out alongside, ready to crossfade in', () => {
    const html = render();

    expect(html).toContain(home.mobile.screen.readyTitle);
    expect(html).toContain(home.mobile.screen.share);
    expect(html).not.toContain('data-done');
  });

  it('keeps the whole screen out of the accessibility tree: the chapter text says what it shows', () => {
    expect(render()).toMatch(/^<div aria-hidden="true"/);
  });

  it('marks the parts the scroll drives', () => {
    const html = render();

    for (const part of ['percent', 'stage', 'bar']) expect(html).toContain(`data-scrub="${part}"`);
  });
});
