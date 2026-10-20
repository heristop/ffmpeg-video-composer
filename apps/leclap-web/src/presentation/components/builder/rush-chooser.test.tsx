// @vitest-environment node
// The take gallery: radio semantics, both controls inside the tile, and the poster/length helpers.
import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';
import builder from '@/i18n/locales/en/builder.json';
import { posterTime, RushChooser, takeLength } from './RushChooser';

beforeAll(async () => {
  await i18n.init({
    lng: 'en',
    fallbackLng: 'en',
    ns: ['builder'],
    defaultNS: 'builder',
    resources: { en: { builder } },
  });
});

describe('RushChooser', () => {
  it('offers the takes as one choice, with remove inside each tile', () => {
    const takes = [new File(['a'], 'a.mp4'), new File(['b'], 'b.mp4')];
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <RushChooser rushes={takes} selectedRush={takes[1]} onSelectRush={() => {}} onRemoveRush={() => {}} />
      </I18nextProvider>
    );

    expect(html).toContain('role="radiogroup"');
    expect(html.match(/role="radio"/g)).toHaveLength(2);
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Remove take 2"');
    expect(html).not.toContain('-right-1.5');
  });

  it('has copy for the remove confirmation', () => {
    expect(builder.rush.confirmRemove).toContain('{{number}}');
    expect([builder.rush.keep, builder.rush.confirm]).toEqual(['Keep', 'Remove']);
  });
});

describe('take helpers', () => {
  it('takes the poster a tenth of the way in, at most a second', () => {
    expect(posterTime(4)).toBeCloseTo(0.4);
    expect(posterTime(30)).toBe(1);
    expect(posterTime(Number.NaN)).toBe(0);
  });

  it('formats a take length', () => {
    expect(takeLength(7.4)).toBe('0:07');
    expect(takeLength(72)).toBe('1:12');
  });
});
