import { describe, expect, it } from 'vitest';
import { OPENED_STATE, closeRoute, dialogSample, tileSelector, withSample, withoutSample } from './sample-dialog.logic';

describe('sample dialog', () => {
  it('opens the sample a link names, and nothing for a missing or unknown one', () => {
    expect(dialogSample(new URLSearchParams('sample=html-card'))?.id).toBe('html-card');
    expect(dialogSample(new URLSearchParams(''))).toBeUndefined();
    expect(dialogSample(new URLSearchParams('sample=missing'))).toBeUndefined();
  });

  it('adds and removes the sample while keeping the filters', () => {
    const opened = withSample(new URLSearchParams('category=effects&q=html'), 'html-stats');
    expect(opened.toString()).toBe('category=effects&q=html&sample=html-stats');
    expect(withoutSample(opened).toString()).toBe('category=effects&q=html');
  });

  it('steps back over the entry a card pushed, and replaces a linked URL in place', () => {
    expect(closeRoute(OPENED_STATE)).toBe('back');
    expect(closeRoute(null)).toBe('replace');
    expect(closeRoute(undefined)).toBe('replace');
    expect(closeRoute({ other: true })).toBe('replace');
  });

  it('returns focus to the card the sample was opened from', () => {
    expect(tileSelector('html-card')).toBe('[data-sample-tile="html-card"]');
    expect(tileSelector('a"b')).toBe(String.raw`[data-sample-tile="a\"b"]`);
  });
});
