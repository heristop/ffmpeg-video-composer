import { describe, expect, it } from 'vitest';
import { filmPlayback, type FilmPlaybackState } from './film-playback.logic';

const playing: FilmPlaybackState = {
  inView: true,
  held: false,
  suspended: false,
  reduced: false,
  requested: true,
  hidden: false,
};

describe('filmPlayback', () => {
  it('plays a requested film on screen', () => {
    expect(filmPlayback(playing)).toBe('play');
  });

  it('pauses a film the page set aside, so a closing dialog never keeps talking', () => {
    expect(filmPlayback({ ...playing, suspended: true })).toBe('pause');
  });

  it('pauses off screen and once held', () => {
    expect(filmPlayback({ ...playing, inView: false })).toBe('pause');
    expect(filmPlayback({ ...playing, held: true })).toBe('pause');
  });

  it('never starts by itself under reduced motion or in a background tab', () => {
    expect(filmPlayback({ ...playing, reduced: true, requested: false })).toBe('rest');
    expect(filmPlayback({ ...playing, reduced: true })).toBe('play');
    expect(filmPlayback({ ...playing, hidden: true })).toBe('rest');
  });
});
