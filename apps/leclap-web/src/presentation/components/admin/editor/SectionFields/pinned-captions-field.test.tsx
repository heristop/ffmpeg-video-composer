// @vitest-environment node
import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import en from '@/i18n/locales/en/admin.json';
import fr from '@/i18n/locales/fr/admin.json';
import de from '@/i18n/locales/de/admin.json';
import es from '@/i18n/locales/es/admin.json';
import it_ from '@/i18n/locales/it/admin.json';
import { PINNED_CAPTION_KEYS, PinnedCaptionsField } from './pinned-captions-field';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../SectionDisclosure', () => ({ SectionDisclosure: ({ children }: { children: ReactNode }) => children }));

const words = [
  { text: 'Captions', start: 0.2, end: 0.7, confidence: 0.9 },
  { text: 'write', start: 0.7, end: 1, confidence: 0.4 },
];

describe('PinnedCaptionsField', () => {
  it('lists the pinned words as editable inputs, flagging the unsure ones', () => {
    const html = renderToStaticMarkup(<PinnedCaptionsField subtitles={{ words }} onChange={vi.fn()} />);

    expect(html).toContain('value="Captions"');
    expect(html).toContain('value="write"');
    expect(html.match(/data-unsure="true"/g)).toHaveLength(1);
  });

  it('remounts a word input when its text changes outside the field (undo), so it shows the new text', () => {
    function inputKeys(subtitles: { words: typeof words }): unknown[] {
      const tree = PinnedCaptionsField({ subtitles, onChange: vi.fn() }) as ReactElement<{ children: ReactNode[] }>;
      const list = tree.props.children[1] as ReactElement<{ children: ReactElement[] }>;

      return list.props.children.map((input) => input.key);
    }

    const before = inputKeys({ words });
    const after = inputKeys({ words: [{ ...words[0], text: 'Caption' }, words[1]] });

    expect(after[0]).not.toBe(before[0]);
    expect(after[1]).toBe(before[1]);
  });

  it('renders nothing without pinned words', () => {
    expect(renderToStaticMarkup(<PinnedCaptionsField subtitles={undefined} onChange={vi.fn()} />)).toBe('');
    expect(renderToStaticMarkup(<PinnedCaptionsField subtitles={{ transcribe: {} }} onChange={vi.fn()} />)).toBe('');
  });

  it.each([
    ['en', en],
    ['fr', fr],
    ['de', de],
    ['es', es],
    ['it', it_],
  ])('has every string in %s', (_locale, strings) => {
    const captions = (strings as { pinnedCaptions?: Record<string, string> }).pinnedCaptions ?? {};

    for (const key of PINNED_CAPTION_KEYS) expect(captions[key], key).toBeTruthy();
  });
});
