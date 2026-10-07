import { describe, expect, it } from 'vitest';
import type { VideoTimeline } from 'ffmpeg-video-composer';
import { atValues, formatTimeline, parseAtList, parseZoom } from '../src/snapshot-args';
import { variantLabels } from '../src/commands/compare';
import { formatName } from '../src/commands/snapshot';
import { KNOWN_COMMANDS, rewriteArgv } from '../src/args';

describe('parseAtList', () => {
  it('splits commas, keeps references and turns plain seconds into numbers', () => {
    expect(parseAtList(['1.5,intro.end', ' beat:8 ', '', 'title.end + 0.2'])).toEqual([
      1.5,
      'intro.end',
      'beat:8',
      'title.end + 0.2',
    ]);
  });

  it('reads every repeated --at from raw argv', () => {
    expect(atValues(['x.json', '--at', '1,2', '--at=hook.end'], undefined)).toEqual([1, 2, 'hook.end']);
    expect(atValues(undefined, '3')).toEqual([3]);
  });
});

describe('parseZoom', () => {
  it('reads x,y,w,h and rejects anything else', () => {
    expect(parseZoom('0.25,0.25,0.5,0.5')).toEqual({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 });
    expect(parseZoom(undefined)).toBeUndefined();
    expect(() => parseZoom('1,2,3')).toThrow(/x,y,w,h/);
  });
});

describe('formatName', () => {
  it('accepts the three formats and rejects anything else', () => {
    expect(formatName('portrait')).toBe('portrait');
    expect(() => formatName('vertical')).toThrow(/landscape \| portrait \| square/);
  });
});

describe('variantLabels', () => {
  it('labels each template by file name, numbering duplicates', () => {
    expect(variantLabels(['a/hero.json', 'b/hero.json', 'c/outro.json'])).toEqual(['hero-1', 'hero-2', 'outro']);
  });
});

describe('commands', () => {
  it('routes snapshot, compare and timeline as subcommands', () => {
    expect(rewriteArgv(['snapshot', 'x.json'], KNOWN_COMMANDS)).toEqual(['snapshot', 'x.json']);
    expect(rewriteArgv(['compare', 'a.json', 'b.json'], KNOWN_COMMANDS)[0]).toBe('compare');
    expect(rewriteArgv(['timeline', 'x.json'], KNOWN_COMMANDS)[0]).toBe('timeline');
  });
});

describe('formatTimeline', () => {
  it('prints sections with their events indented beneath', () => {
    const timeline = {
      width: 1280,
      height: 720,
      fps: 30,
      duration: 5,
      approx: false,
      sections: [
        { index: 0, name: 'hook', type: 'color_background', start: 0, end: 5, duration: 5, durationKnown: true },
      ],
      events: [
        { section: 'hook', kind: 'kinetic', element: 'kinetic[0]', id: 'title', start: 0.2, end: 0.9, preset: 'rise' },
      ],
      beats: [],
      cues: [{ section: 'hook', name: 'drop', time: 2 }],
    } as unknown as VideoTimeline;

    expect(formatTimeline(timeline)).toEqual([
      '1280×720 @ 30 fps · 5.00s',
      '0.00s – 5.00s  hook (color_background)',
      '    0.20s – 0.90s  kinetic title rise',
      'cues: drop@2.00s',
    ]);
  });
});
