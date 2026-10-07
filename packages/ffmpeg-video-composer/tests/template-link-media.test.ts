import { describe, expect, it } from 'vitest';
import { classifyMediaRef, mediaToRebind } from '@/core/template-link/media-refs';

// Built from parts: the lint rule against script URLs is right everywhere but in a test of refusing them.
const SCRIPT_URL = ['javascript', 'alert(1)'].join(':');

describe('classifyMediaRef', () => {
  it.each([
    ['/Users/me/clip.mp4', 'local_path'],
    ['/home/me/clip.mp4', 'local_path'],
    ['~/clips/clip.mp4', 'local_path'],
    ['./clip.mp4', 'local_path'],
    ['../shared/logo.png', 'local_path'],
    [String.raw`C:\Users\me\clip.mp4`, 'local_path'],
    ['file:///Users/me/clip.mp4', 'local_path'],
    ['blob:https://leclap.dev/1234', 'browser_blob'],
    ['media://abc123', 'device_upload'],
    [String.raw`..\shared\clip.mp4`, 'local_path'],
    [String.raw`.\clip.mp4`, 'local_path'],
    ['/Users/{{ user }}/clip.mp4', 'local_path'],
    [SCRIPT_URL, 'unsupported_scheme'],
    [['vbscript', 'msgbox'].join(':'), 'unsupported_scheme'],
    ['ftp://example.com/clip.mp4', 'unsupported_scheme'],
  ])('%s needs re-binding (%s)', (value, reason) => {
    expect(classifyMediaRef(value)).toBe(reason);
  });

  it.each([
    'lofi-study.mp3',
    'Oswald.ttf',
    'animations/confetti.apng',
    'videos/video_2.mp4',
    '/assets/backgrounds/golden-hour.jpg',
    '/musics/lofi-study.mp3',
    '/fonts/Oswald.ttf',
    'https://example.com/clip.mp4',
    'data:image/png;base64,AAAA',
    'library://sunset',
    'HTTPS://example.com/clip.mp4',
    '{{ videoOutro }}',
    'https://cdn.example.com/{{ clip }}.mp4',
    '',
  ])('%s resolves without re-binding', (value) => {
    expect(classifyMediaRef(value)).toBeNull();
  });
});

describe('mediaToRebind', () => {
  it('lists the media fields only the author can read, with JSON Pointers', () => {
    const template = {
      global: {
        music: { name: 'Mine', url: '/Users/me/music/track.mp3' },
        watermark: { url: 'media://logo-key' },
        animations: [{ url: 'animations/confetti.apng' }],
      },
      sections: [
        { name: 'a', type: 'video', options: { videoUrl: '/Users/me/a.mp4' } },
        {
          name: 'b',
          type: 'color_background',
          inputs: [{ name: 'logo', type: 'image', url: 'file:///tmp/logo.png' }],
          filters: [
            { type: 'drawtext', values: { text: '/Users/me is not a media field', fontfile: '/Library/X.ttf' } },
          ],
        },
        {
          name: 'c',
          type: 'effect',
          effect: { id: 'x', version: '1.0.0', props: {}, assets: { clip: '/Users/me/b-roll.mp4' } },
        },
      ],
    };

    expect(mediaToRebind(template)).toEqual([
      { pointer: '/global/music/url', value: '/Users/me/music/track.mp3', reason: 'local_path' },
      { pointer: '/global/watermark/url', value: 'media://logo-key', reason: 'device_upload' },
      { pointer: '/sections/0/options/videoUrl', value: '/Users/me/a.mp4', reason: 'local_path' },
      { pointer: '/sections/1/inputs/0/url', value: 'file:///tmp/logo.png', reason: 'local_path' },
      { pointer: '/sections/1/filters/0/values/fontfile', value: '/Library/X.ttf', reason: 'local_path' },
      { pointer: '/sections/2/effect/assets/clip', value: '/Users/me/b-roll.mp4', reason: 'local_path' },
    ]);
  });

  it('treats a font as media only when it names a file, not a bundled font id', () => {
    const template = {
      global: { overlays: [{ type: 'ticker', font: '/Users/me/fonts/Brand.otf' }] },
      sections: [
        {
          name: 'a',
          type: 'color_background',
          graphics: [
            { type: 'kinetic', font: 'bebas' },
            { type: 'chart', font: 'Oswald.ttf' },
            { type: 'ticker', font: String.raw`C:\Fonts\Brand.woff2` },
            { type: 'kinetic', font: '~/fonts/Brand.ttf' },
          ],
        },
      ],
    };

    expect(mediaToRebind(template)).toEqual([
      { pointer: '/global/overlays/0/font', value: '/Users/me/fonts/Brand.otf', reason: 'local_path' },
      { pointer: '/sections/0/graphics/2/font', value: String.raw`C:\Fonts\Brand.woff2`, reason: 'local_path' },
      { pointer: '/sections/0/graphics/3/font', value: '~/fonts/Brand.ttf', reason: 'local_path' },
    ]);
  });

  it('lists media under a scheme the builder does not load', () => {
    expect(mediaToRebind({ sections: [{ name: 'a', options: { videoUrl: SCRIPT_URL } }] })).toEqual([
      { pointer: '/sections/0/options/videoUrl', value: SCRIPT_URL, reason: 'unsupported_scheme' },
    ]);
  });

  it('is empty for a template whose media all resolve', () => {
    expect(mediaToRebind({ sections: [{ name: 'a', options: { pictureUrl: '/assets/backgrounds/x.jpg' } }] })).toEqual(
      []
    );
    expect(mediaToRebind(null)).toEqual([]);
  });
});
