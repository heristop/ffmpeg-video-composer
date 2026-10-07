import { describe, expect, it } from 'vitest';
import { ffmpegAtLeast, ffmpegCompat, ffmpegOlderThan, parseFFmpegVersion } from '@/core/ffmpeg-version';

describe('parseFFmpegVersion', () => {
  it.each([
    ['9.0.2', { major: 9, minor: 0 }],
    ['9.0.2-https://www.martin-riedl.de', { major: 9, minor: 0 }],
    ['8.1.1', { major: 8, minor: 1 }],
    ['n7.1', { major: 7, minor: 1 }],
    ['6.1.1-3ubuntu5', { major: 6, minor: 1 }],
    ['6.0', { major: 6, minor: 0 }],
    ['7.1.1-essentials_build-www.gyan.dev', { major: 7, minor: 1 }],
  ])('reads %s', (version, expected) => {
    expect(parseFFmpegVersion(version)).toEqual(expected);
  });

  it.each([['N-127141-g361174e5ea'], ['unknown'], [''], [null], [undefined]])('has no number for %s', (version) => {
    expect(parseFFmpegVersion(version)).toBeNull();
  });
});

describe('ffmpegAtLeast / ffmpegOlderThan', () => {
  it('compares a known version both ways', () => {
    expect(ffmpegAtLeast('9.0.2', 7, 1)).toBe(true);
    expect(ffmpegAtLeast('7.0.2', 7, 1)).toBe(false);
    expect(ffmpegOlderThan('6.1.1', 7, 0)).toBe(true);
    expect(ffmpegOlderThan('7.0', 7, 0)).toBe(false);
    expect(ffmpegOlderThan('9.0.2', 7, 0)).toBe(false);
  });

  it('answers false both ways for an unknown version', () => {
    expect(ffmpegAtLeast('N-127141-g361174e5ea', 7, 1)).toBe(false);
    expect(ffmpegOlderThan('N-127141-g361174e5ea', 7, 0)).toBe(false);
    expect(ffmpegOlderThan(null, 7, 0)).toBe(false);
  });
});

describe('ffmpegCompat', () => {
  // FFmpeg 9 dropped -filter_script / -filter_complex_script; `-/option file` reads any option's value from a
  // file since 7.0. FFmpeg 6 (the ffmpeg-static binary) only knows the script options.
  it.each(['9.0.2', '8.1.1', 'n7.0', '7.1'])('loads option files with -/option on %s', (version) => {
    expect(ffmpegCompat(version).optionFiles).toBe('slash');
  });

  it.each(['6.0', '6.1.1-3ubuntu5', '5.1.2'])('keeps the script options on %s', (version) => {
    expect(ffmpegCompat(version).optionFiles).toBe('script');
  });

  // A git snapshot (`N-…`) postdates every numbered release, so it gets the modern syntax.
  it.each(['N-127141-g361174e5ea', null])('assumes a current build for %s', (version) => {
    expect(ffmpegCompat(version).optionFiles).toBe('slash');
  });

  // FFmpeg 9's -shortest ends a stream-copied concat-demuxer video ~0.1s early when the concat's audio
  // is mixed, so the music pass must not read the segment list directly there.
  it.each(['9.0.2', '10.0', 'N-127141-g361174e5ea'])('flags the -shortest concat trim on %s', (version) => {
    expect(ffmpegCompat(version).shortestKeepsConcatVideo).toBe(false);
  });

  // Unknown (null) is the on-device engine (FFmpeg 8.0) and the WASM core: their historical behaviour.
  it.each(['8.1.1', '8.0', '6.0', null, 'unknown'])('keeps the concat fold on %s', (version) => {
    expect(ffmpegCompat(version).shortestKeepsConcatVideo).toBe(true);
  });
});
