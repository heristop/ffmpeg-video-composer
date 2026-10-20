import { describe, expect, it } from 'vitest';
import { alternativesSummary, filterTracks, makeDefault, moveIndex, trackKeyAction } from './music-track-list.logic';

describe('makeDefault', () => {
  it('moves the track to the front and keeps the others in order', () => {
    expect(makeDefault(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b']);
  });

  it('leaves the list alone for a track that is not ticked', () => {
    const allowed = ['a', 'b'];

    expect(makeDefault(allowed, 'z')).toBe(allowed);
  });
});

describe('trackKeyAction', () => {
  it('maps Space to preview, D to default, Escape to stop and the arrows to movement', () => {
    expect(trackKeyAction(' ')).toBe('preview');
    expect(trackKeyAction('d')).toBe('makeDefault');
    expect(trackKeyAction('D')).toBe('makeDefault');
    expect(trackKeyAction('Escape')).toBe('stop');
    expect(trackKeyAction('ArrowDown')).toBe('next');
    expect(trackKeyAction('Home')).toBe('first');
  });

  it('leaves Enter to the button, so it ticks the track', () => {
    expect(trackKeyAction('Enter')).toBeNull();
  });
});

describe('moveIndex', () => {
  it('clamps at both ends instead of wrapping', () => {
    expect(moveIndex('next', 4, 5)).toBe(4);
    expect(moveIndex('prev', 0, 5)).toBe(0);
    expect(moveIndex('next', 1, 5)).toBe(2);
    expect(moveIndex('last', 1, 5)).toBe(4);
    expect(moveIndex('first', 3, 5)).toBe(0);
  });
});

describe('alternativesSummary', () => {
  it('names two alternatives and counts the rest', () => {
    expect(alternativesSummary(['a', 'b', 'c', 'd'])).toEqual({ shown: ['a', 'b'], more: 2 });
    expect(alternativesSummary(['a'])).toEqual({ shown: ['a'], more: 0 });
  });
});

describe('filterTracks', () => {
  const tracks = [
    { id: 'a', bpm: 80, moods: ['calm'] },
    { id: 'b', bpm: 128, moods: ['upbeat'] },
    { id: 'c', moods: ['calm', 'jazzy'] },
    { id: 'd', bpm: 100 },
  ];
  const ids = (list: Array<{ id: string }>) => list.map((track) => track.id);

  it('keeps everything with no filter', () => {
    expect(ids(filterTracks(tracks, 'all', 'any'))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('filters by publisher mood', () => {
    expect(ids(filterTracks(tracks, 'calm', 'any'))).toEqual(['a', 'c']);
  });

  it('filters by tempo band and leaves out tracks without a trusted tempo', () => {
    expect(ids(filterTracks(tracks, 'all', 'slow'))).toEqual(['a']);
    expect(ids(filterTracks(tracks, 'all', 'mid'))).toEqual(['d']);
    expect(ids(filterTracks(tracks, 'all', 'fast'))).toEqual(['b']);
    expect(ids(filterTracks(tracks, 'calm', 'fast'))).toEqual([]);
  });
});
