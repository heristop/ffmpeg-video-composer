import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  deriveSeed,
  fnv1a32,
  resolveDeterministic,
  resolveSeed,
  seededRandom,
  sha256Hex,
} from '@/core/determinism';
import { ENGINE_VERSION } from '@/core/version';
import pkg from '../package.json' with { type: 'json' };

describe('fnv1a32 / deriveSeed', () => {
  it('matches the reference FNV-1a vectors', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
    expect(fnv1a32('a')).toBe(0xe40c292c);
    expect(fnv1a32('foobar')).toBe(0xbf9cf968);
  });

  it('derives distinct, stable seeds per element path', () => {
    const a = deriveSeed(7, 'sections.intro.filters[0]');
    expect(deriveSeed(7, 'sections.intro.filters[0]')).toBe(a);
    expect(deriveSeed(7, 'sections.intro.filters[1]')).not.toBe(a);
    expect(deriveSeed(8, 'sections.intro.filters[0]')).not.toBe(a);
  });
});

describe('seededRandom', () => {
  it('replays the same stream for the same seed and stays in [0, 1)', () => {
    const first = seededRandom(42);
    const second = seededRandom(42);
    const values = Array.from({ length: 1000 }, () => first());

    expect(values).toEqual(Array.from({ length: 1000 }, () => second()));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
    expect(seededRandom(43)()).not.toBe(values[0]);
  });
});

describe('sha256Hex', () => {
  it('matches the FIPS 180-4 vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('agrees with node:crypto across block boundaries, unicode and raw bytes', () => {
    for (const input of ['x'.repeat(55), 'x'.repeat(56), 'y'.repeat(64), 'z'.repeat(1000), 'héllo 🎬 clap']) {
      expect(sha256Hex(input)).toBe(createHash('sha256').update(input, 'utf8').digest('hex'));
    }

    const bytes = Uint8Array.from({ length: 4099 }, (_, i) => (i * 31) % 256);
    expect(sha256Hex(bytes)).toBe(createHash('sha256').update(bytes).digest('hex'));
  });
});

describe('canonicalJson', () => {
  it('sorts keys at every depth and drops undefined like JSON.stringify', () => {
    expect(canonicalJson({ b: 1, a: { d: [{ z: 1, y: 2 }], c: undefined } })).toBe('{"a":{"d":[{"y":2,"z":1}]},"b":1}');
  });
});

describe('contract switches', () => {
  it('defaults the seed to 0 and ignores invalid seeds', () => {
    expect(resolveSeed(undefined)).toBe(0);
    expect(resolveSeed({ global: { seed: 99 } })).toBe(99);
    expect(resolveSeed({ global: { seed: -1 } })).toBe(0);
    expect(resolveSeed({ global: { seed: 1.5 } })).toBe(0);
  });

  it('turns the deterministic profile on unless the host opts out', () => {
    expect(resolveDeterministic(undefined)).toBe(true);
    expect(resolveDeterministic(false)).toBe(false);
    expect(resolveDeterministic(true)).toBe(true);
  });
});

describe('engine version', () => {
  it('matches package.json, so manifests name the release that rendered them', () => {
    expect(ENGINE_VERSION).toBe(pkg.version);
  });
});
