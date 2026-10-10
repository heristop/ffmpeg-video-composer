// @vitest-environment node
// Renders the sound-effects panel against the real English bundle (the web app has no jsdom/RTL). t() keys
// are not type-checked, so a missing key would ship as raw text: every key the panel asks for is recorded
// and must exist, and the sfx block must carry the same keys in all five locales.
import type { ReactNode } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';
import { SFX_IDS, SFX_LIBRARY } from 'ffmpeg-video-composer/src/core/audio/sfx-library.ts';
import en from '@/i18n/locales/en/admin.json';
import fr from '@/i18n/locales/fr/admin.json';
import de from '@/i18n/locales/de/admin.json';
import es from '@/i18n/locales/es/admin.json';
import it_ from '@/i18n/locales/it/admin.json';
import { SfxCuesPanel, SfxLibrary } from './sfx-cues-panel';
import { SECTION_SFX_MAX, type SfxCue } from './sfx-cues.logic';

const missing: string[] = [];

beforeAll(async () => {
  await i18n.init({
    lng: 'en',
    fallbackLng: false,
    ns: ['admin'],
    defaultNS: 'admin',
    resources: { en: { admin: en } },
    saveMissing: true,
    missingKeyHandler: (_lngs, _ns, key) => {
      missing.push(key);
    },
  });
});

const noop = () => {};

const cues = [
  { id: 'whoosh', at: 0 },
  { id: 'hit', at: 'cue:drop', volume: 1.5 },
  { sound: { layers: [{ source: 'noise' }] }, at: 2 },
] as SfxCue[];

const render = (node: ReactNode) => renderToStaticMarkup(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>);

const keysOf = (value: unknown, prefix = ''): string[] => {
  if (typeof value !== 'object' || value === null) return [prefix];

  return Object.entries(value).flatMap(([key, child]) => keysOf(child, prefix ? `${prefix}.${key}` : key));
};

describe('SfxCuesPanel', () => {
  it('records a key the bundle lacks (the guard below is live)', () => {
    missing.length = 0;
    i18n.t('sfx.notAKey');

    expect(missing).toEqual(['sfx.notAKey']);
  });

  it('resolves every string from the English bundle', () => {
    missing.length = 0;
    render(<SfxCuesPanel cues={cues} max={SECTION_SFX_MAX} hint={en.sfx.sectionHint} onChange={noop} />);
    render(<SfxCuesPanel cues={undefined} max={SECTION_SFX_MAX} hint={en.sfx.sectionHint} onChange={noop} />);
    render(<SfxLibrary id="library" onPick={noop} />);

    expect(missing).toEqual([]);
  });

  it('names library sounds and composed sounds, previewing only library ones', () => {
    const html = render(<SfxCuesPanel cues={cues} max={SECTION_SFX_MAX} hint="" onChange={noop} />);

    expect(html).toContain('>Whoosh<');
    expect(html).toContain('>Composed sound<');
    expect(html).toContain('aria-label="Preview Whoosh at 50%"');
    expect(html).toContain('aria-label="Preview Hit at 150%"');
    expect(html).not.toContain('Preview Composed sound');
  });

  it('shows the library default until a volume is set, with a reset only then', () => {
    const html = render(<SfxCuesPanel cues={cues} max={SECTION_SFX_MAX} hint="" onChange={noop} />);

    expect(html).toContain(`aria-valuetext="Default · ${SFX_LIBRARY.whoosh.defaultVolume * 100}%"`);
    expect(html).toContain('aria-valuetext="150%"');
    expect(html).toContain('aria-label="Reset Hit to its default volume (70%)"');
    expect(html).not.toContain('Reset Whoosh');
    expect(html).toContain('aria-valuetext="Default · 60%"');
  });

  it('keeps a time reference as text', () => {
    const html = render(<SfxCuesPanel cues={cues} max={SECTION_SFX_MAX} hint="" onChange={noop} />);

    expect(html).toContain('value="cue:drop"');
  });

  it('disables Add sound once the list is full', () => {
    const html = render(<SfxCuesPanel cues={cues.slice(0, 2)} max={2} hint="" onChange={noop} />);

    expect(html).toContain('disabled=""');
    expect(html).toContain('This list is full (2 sounds).');
  });

  it('lists every library sound with its hint', () => {
    const html = render(<SfxLibrary id="library" onPick={noop} />);

    for (const id of SFX_IDS) expect(html).toContain(`Add ${en.sfx.library[id]}`);
    expect(html).toContain(en.sfx.useWhen.riser.replace(/"/g, '&quot;'));
  });
});

describe('sfx locale keys', () => {
  it('covers every library id in English', () => {
    expect(Object.keys(en.sfx.library).sort()).toEqual([...SFX_IDS].sort());
    expect(Object.keys(en.sfx.useWhen).sort()).toEqual([...SFX_IDS].sort());
    expect(en.disclosure.sfx).toBeTruthy();
  });

  it.each([
    ['fr', fr],
    ['de', de],
    ['es', es],
    ['it', it_],
  ])('%s carries the same sfx keys as English', (_lng, bundle) => {
    expect(keysOf(bundle.sfx).sort()).toEqual(keysOf(en.sfx).sort());
    expect(bundle.disclosure.sfx).toBeTruthy();
  });
});
