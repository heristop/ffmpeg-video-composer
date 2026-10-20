// @vitest-environment node
// The music shortlist rendered to static markup (the web app has no jsdom): row semantics, the single
// tab stop, the default marker, the preview labels, and the en copy for the count and empty note.
import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';
import admin from '@/i18n/locales/en/admin.json';
import { MUSIC_LIBRARY } from '@/data/mediaCatalog';
import { MusicTrackList } from './music-track-list';

beforeAll(async () => {
  await i18n.init({ lng: 'en', fallbackLng: 'en', ns: ['admin'], defaultNS: 'admin', resources: { en: { admin } } });
});

const noop = () => {};

function render(selectedIds: string[], allowUpload = false) {
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <MusicTrackList
        selectedIds={selectedIds}
        allowUpload={allowUpload}
        onToggle={noop}
        onMakeDefault={noop}
        onClear={noop}
      />
    </I18nextProvider>
  );
}

const [first, second] = MUSIC_LIBRARY;

describe('MusicTrackList', () => {
  it('gives every track a checkbox row reflecting the ticks', () => {
    const html = render([second.id]);

    expect(html.match(/role="checkbox"/g)).toHaveLength(MUSIC_LIBRARY.length);
    expect(html.match(/role="checkbox" aria-checked="true"/g)).toHaveLength(1);
  });

  it('keeps one tab stop for the whole list, on the default track', () => {
    const html = render([second.id]);
    const stops = html.match(/role="checkbox"[^>]*tabindex="0"|tabindex="0"[^>]*role="checkbox"/g) ?? [];

    expect(stops).toHaveLength(1);
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
  });

  it('marks the first ticked track as the default and offers the others the switch', () => {
    const html = render([second.id, first.id]);

    expect(html.match(new RegExp(`>${admin.musicSection.default}<`, 'g'))).toHaveLength(1);
    expect(html).toContain(`aria-label="Make ${first.title} the default"`);
    expect(html).not.toContain(`aria-label="Make ${second.title} the default"`);
  });

  it('labels each cover as a preview toggle', () => {
    const html = render([]);

    expect(html).toContain(`aria-label="Preview ${first.title}"`);
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(MUSIC_LIBRARY.length);
    expect(html).toContain(`title="${admin.musicSection.previewTooltip}"`);
  });

  it('counts the ticks and offers Clear only when something is ticked', () => {
    expect(render([first.id, second.id])).toContain(`2 of ${MUSIC_LIBRARY.length} offered`);
    expect(render([first.id])).toContain(`>${admin.musicSection.clear}<`);
    expect(render([])).not.toContain(`>${admin.musicSection.clear}<`);
  });

  it('explains the empty shortlist with the stand-in track, upload or not', () => {
    expect(render([])).toContain(
      `Nothing ticked. Draft previews borrow ${first.title}, and viewers get no track to pick.`
    );
    expect(render([], true)).toContain('viewers can only upload their own.');
  });

  it('prints the duration beside the artist and describes the keys', () => {
    const html = render([]);

    expect(html).toContain('aria-keyshortcuts="Enter Space D"');
    expect(html).toContain(admin.musicSection.keysHint);
    expect(html).toMatch(/· \d+:\d\d/);
  });
});

describe('music catalog durations', () => {
  it('knows the length of every library track', () => {
    expect(MUSIC_LIBRARY.every((item) => (item.durationSec ?? 0) > 0)).toBe(true);
  });
});

describe('MusicTrackPicker', () => {
  it('offers the tracks as one choice, with radio rows', async () => {
    const { MusicTrackPicker } = await import('./music-track-list');
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <MusicTrackPicker items={[first, second]} selectedId={second.id} onSelect={noop} />
      </I18nextProvider>
    );

    expect(html).toContain('role="radiogroup"');
    expect(html.match(/role="radio"/g)).toHaveLength(2);
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(html).toContain(`aria-label="${admin.musicSection.pickerLabel}"`);
    expect(html).toContain(admin.musicSection.keysHintSingle);
    expect(html).not.toContain(admin.musicSection.default);
    expect(html).toContain(`</kbd> ${admin.musicSection.keyPick}<`);
  });
});

describe('catalog depth in the shortlist', () => {
  it('offers mood and tempo filters and prints a trusted tempo', () => {
    const html = render([]);
    const withBpm = MUSIC_LIBRARY.find((item) => item.bpm !== undefined);

    expect(html).toContain(`aria-label="${admin.musicSection.filterMood}"`);
    expect(html).toContain(`aria-label="${admin.musicSection.filterTempo}"`);
    expect(html).toContain(`>${admin.musicSection.mood.calm}<`);
    expect(html).toContain(`>${admin.musicSection.tempo.slow}<`);
    expect(html).toContain(`${String(withBpm?.bpm)} BPM`);
    expect(admin.musicSection.noMatch).toBeTruthy();
    expect(admin.musicSection.seek).toContain('{{title}}');
  });

  it('carries a 64-bar waveform for every library track', () => {
    expect(MUSIC_LIBRARY.every((item) => item.peaks?.length === 64)).toBe(true);
  });
});
