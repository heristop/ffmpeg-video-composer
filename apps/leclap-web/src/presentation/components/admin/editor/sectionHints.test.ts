import { describe, it, expect } from 'vitest';
import type { TFunction } from 'i18next';
import { captureSummary, sfxSummary } from './sectionHints';

const t = ((key: string, options?: { count?: number }) => {
  if (key === 'capture.summaryModes') return `${options?.count} modes`;

  return key;
}) as TFunction<'admin'>;

describe('captureSummary', () => {
  it('reads Default when nothing is customized', () => {
    expect(captureSummary(t, undefined, undefined)).toBe('summaryChip.default');
  });

  it('names the default mode when set', () => {
    expect(captureSummary(t, 'screen', undefined)).toBe('capture.mode.screen');
  });

  it('counts a restricted allowed set', () => {
    expect(captureSummary(t, undefined, ['front', 'upload'])).toBe('2 modes');
  });

  it('joins mode and restriction', () => {
    expect(captureSummary(t, 'upload', ['back', 'upload'])).toBe('capture.mode.upload · 2 modes');
  });
});

describe('sfxSummary', () => {
  const tc = ((key: string, options?: { count?: number }) =>
    key === 'sfx.count' ? `${options?.count} sounds` : key) as TFunction<'admin'>;

  it('reads None with no cues', () => {
    expect(sfxSummary(tc, undefined)).toBe('summaryChip.none');
    expect(sfxSummary(tc, [])).toBe('summaryChip.none');
  });

  it('counts the cues', () => {
    expect(sfxSummary(tc, [{}, {}])).toBe('2 sounds');
  });
});
