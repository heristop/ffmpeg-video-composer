import { describe, expect, it } from 'vitest';
import { CATALOG_KINDS, searchMotionCatalog, searchTokens } from '@/core/motion/catalog-search';

describe('searchTokens', () => {
  it('lower-cases, drops stopwords and stems plurals and -ing', () => {
    expect(searchTokens('I want the Headlines landing on Beats')).toEqual(['headline', 'land', 'beat']);
  });
});

describe('searchMotionCatalog', () => {
  it('ranks the entry whose name and use match best first', () => {
    const result = searchMotionCatalog('punch word on a beat');

    expect(result.matches[0]).toMatchObject({ kind: 'kinetic', name: 'impact' });
    expect(result.matches[0].matched).toEqual(expect.arrayContaining(['punch', 'beat']));
    expect(result.matches.map((match) => match.score)).toEqual(
      result.matches.map((match) => match.score).toSorted((a, b) => b - a)
    );
  });

  it('finds an entry by its exact name', () => {
    expect(searchMotionCatalog('typewriter').matches[0]).toMatchObject({ kind: 'kinetic', name: 'typewriter' });
    expect(searchMotionCatalog('tiktok').matches[0]).toMatchObject({ kind: 'platform', name: 'tiktok' });
  });

  it('limits the search to one kind', () => {
    const result = searchMotionCatalog('reveal', { kind: 'transition' });

    expect(result.kind).toBe('transition');
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches.every((match) => match.kind === 'transition')).toBe(true);
  });

  it('counts avoidWhen against an entry', () => {
    const calm = searchMotionCatalog('calm instructions', { kind: 'kinetic' });

    expect(calm.matches.map((match) => match.name)).not.toContain('cascade');
  });

  it('returns nothing for a need the catalog does not cover, deterministically', () => {
    expect(searchMotionCatalog('hologram particles xyzzy').matches).toEqual([]);
    expect(searchMotionCatalog('camera push for build up')).toEqual(searchMotionCatalog('camera push for build up'));
  });

  it('covers every kind it advertises', () => {
    for (const kind of CATALOG_KINDS) {
      expect(searchMotionCatalog(kind === 'easing' ? 'spring' : 'a', { kind, limit: 500 }).kind).toBe(kind);
    }

    expect(searchMotionCatalog('product launch', { kind: 'doctrine' }).matches[0]?.name).toBe('product-launch');
  });

  it('searches captions, sound effects, footage, roles, compositing, lower thirds and formats', () => {
    for (const [query, kind] of [
      ['subtitles', 'caption'],
      ['sound effect', 'sfx'],
      ['speed ramp', 'footage'],
      ['motion role', 'role'],
      ['split', 'compositing'],
      ['lower third', 'lower-third'],
      ['portrait', 'format'],
    ] as const) {
      expect(searchMotionCatalog(query, { kind }).matches.length, `${kind}: ${query}`).toBeGreaterThan(0);
    }
  });
});

describe('engine primitives rank above library samples', () => {
  function rank(query: string, name: string): number {
    return searchMotionCatalog(query, { limit: 500 }).matches.findIndex((match) => match.name === name);
  }

  it.each([
    ['a light sweep shining across the card', 'sheen', 'shine_sweep'],
    ['a glint orbiting the product', 'sheen', 'spec_orbit'],
    ['corner brackets around the screen', 'corners', 'corner_brackets'],
    ['a glowing frame border', 'frame', 'glow_border'],
  ])('"%s": %s before the %s sample', (query, primitive, sample) => {
    expect(rank(query, primitive)).toBeGreaterThanOrEqual(0);
    expect(rank(query, primitive)).toBeLessThan(rank(query, sample));
  });

  it('labels a sample match as a sample with its engine replacement', () => {
    const match = searchMotionCatalog('confetti', { kind: 'sample' }).matches[0];

    expect(match).toMatchObject({ kind: 'sample', name: 'confetti' });
    expect(match.entry).toMatchObject({
      note: expect.stringContaining('Sample assets'),
      composeWith: expect.any(String),
    });
    expect(searchMotionCatalog('sheen', { kind: 'fx' }).matches[0]).toMatchObject({ kind: 'fx', name: 'sheen' });
  });
});
