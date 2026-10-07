import { describe, expect, it } from 'vitest';
import { createRateLimiter, inputBytes, sanitizeDeep, sanitizeText, stringLeaves, unsafeNewUrls } from './guard';

const ORIGIN = 'https://leclap.test';

describe('sanitizeText', () => {
  it('strips control and bidi-override characters, keeps newlines and tabs, NFC-normalizes', () => {
    expect(sanitizeText('a\u0000b\u0007c\nd\te\u202Ef\u2066g\u0085')).toBe('abc\nd\tefg');
    expect(sanitizeText('é')).toBe('é');
  });

  it('sanitizes every string leaf of a JSON value', () => {
    expect(sanitizeDeep({ a: ['x\u202Ey', 2], b: { c: 'z\u0000' }, d: null })).toEqual({
      a: ['xy', 2],
      b: { c: 'z' },
      d: null,
    });
  });
});

describe('limits', () => {
  it('measures input as UTF-8 JSON', () => {
    expect(inputBytes({ a: 'é' })).toBe(new TextEncoder().encode('{"a":"é"}').length);
    expect(inputBytes(undefined)).toBe(2);
  });

  it('rate-limits per kind on a sliding window and says when to retry', () => {
    let now = 0;
    const limiter = createRateLimiter(() => now, {
      read: { limit: 2, windowMs: 1000 },
      edit: { limit: 1, windowMs: 1000 },
      consequential: { limit: 1, windowMs: 1000 },
    });

    expect(limiter.take('read')).toEqual({ ok: true });
    expect(limiter.take('read')).toEqual({ ok: true });
    expect(limiter.take('read')).toEqual({ ok: false, retryAfterMs: 1000 });
    expect(limiter.take('edit')).toEqual({ ok: true });
    now = 400;
    expect(limiter.take('read')).toEqual({ ok: false, retryAfterMs: 600 });
    now = 1000;
    expect(limiter.take('read')).toEqual({ ok: true });
  });
});

describe('URL policy', () => {
  const base = { sections: [{ url: 'media://existing' }, { url: 'data:image/png;base64,SHAPE' }] };

  it('lets existing refs, library ids, bundled paths and same-origin URLs through', () => {
    const candidate = {
      ...base,
      more: [
        'media://existing',
        'data:image/png;base64,SHAPE',
        'logo',
        '/fonts/a.ttf',
        `${ORIGIN}/x.png`,
        'Note: hello',
      ],
    };

    expect(unsafeNewUrls(base, candidate, ORIGIN)).toEqual([]);
  });

  it('refuses new blob/data/javascript/file URLs, invented media keys and foreign origins', () => {
    const candidate = [
      'blob:https://leclap.test/1',
      'data:text/html,hi',
      ['java', 'script:alert(1)'].join(''),
      'file:///etc/passwd',
      'media://minted',
      'https://evil.example/x.png',
    ];

    expect(unsafeNewUrls(base, candidate, ORIGIN)).toHaveLength(6);
  });

  it('collects string leaves', () => {
    expect(stringLeaves({ a: ['x', { b: 'y' }], c: 1 })).toEqual(['x', 'y']);
  });
});
