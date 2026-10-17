import { describe, expect, it } from 'vitest';
import { isHtmlSequence } from '@/editor/html/html-sequence-source';
import { buildHtmlLayerSource, buildLoopFlags } from '@/editor/utils/input-sources';

describe('buildHtmlLayerSource', () => {
  it('holds a still card as a looped image and opens an animated card as its own timed stream', () => {
    expect(
      buildHtmlLayerSource({ type: 'html', url: 'html:0123456789abcdef' }, '/b/panels/html-0123456789abcdef.png')
    ).toBe('-loop 1 -i /b/panels/html-0123456789abcdef.png');
    expect(
      buildHtmlLayerSource({ type: 'html', url: 'html-seq:0123456789abcdef' }, '/b/panels/html-0123456789abcdef.apng')
    ).toBe('-i /b/panels/html-0123456789abcdef.apng');
  });

  it('starts an animated card when its layer appears, not at the section start', () => {
    expect(
      buildHtmlLayerSource(
        { type: 'html', url: 'html-seq:0123456789abcdef', options: { start: 1.5 } },
        '/b/panels/html-0123456789abcdef.apng'
      )
    ).toBe('-itsoffset 1.5 -i /b/panels/html-0123456789abcdef.apng');
  });

  it('reads a numeric-string start and drops one that is not a finite number', () => {
    const apng = '/b/panels/html-0123456789abcdef.apng';
    const source = (start: unknown) =>
      buildHtmlLayerSource(
        { type: 'html', url: 'html-seq:0123456789abcdef', options: { start } as { start?: number } },
        apng
      );

    expect(source('1.5')).toBe(`-itsoffset 1.5 -i ${apng}`);
    expect(source('soon')).toBe(`-i ${apng}`);
    expect(source(Number.POSITIVE_INFINITY)).toBe(`-i ${apng}`);
    expect(source(-2)).toBe(`-i ${apng}`);
    expect(buildLoopFlags({ start: '2' as unknown as number })).toBe('-itsoffset 2 ');
    expect(buildLoopFlags({ start: 'x' as unknown as number })).toBe('');
    expect(buildLoopFlags({ start: Number.POSITIVE_INFINITY })).toBe('');
  });

  it('reads only an html input as a sequence', () => {
    expect(isHtmlSequence({ type: 'html', url: 'html-seq:0123456789abcdef' })).toBe(true);
    expect(isHtmlSequence({ type: 'image', url: 'html-seq:0123456789abcdef' })).toBe(false);
    expect(isHtmlSequence({ type: 'html', url: 'html:0123456789abcdef' })).toBe(false);
  });
});
