import { describe, expect, it } from 'vitest';
import { buildHtmlLayerSource, isHtmlSequence } from '@/editor/html/html-sequence-source';

describe('buildHtmlLayerSource', () => {
  it('holds a still card as a looped image and opens an animated card as its own timed stream', () => {
    expect(
      buildHtmlLayerSource({ type: 'html', url: 'html:0123456789abcdef' }, '/b/panels/html-0123456789abcdef.png')
    ).toBe('-loop 1 -i /b/panels/html-0123456789abcdef.png');
    expect(
      buildHtmlLayerSource({ type: 'html', url: 'html-seq:0123456789abcdef' }, '/b/panels/html-0123456789abcdef.apng')
    ).toBe('-i /b/panels/html-0123456789abcdef.apng');
  });

  it('reads only an html input as a sequence', () => {
    expect(isHtmlSequence({ type: 'html', url: 'html-seq:0123456789abcdef' })).toBe(true);
    expect(isHtmlSequence({ type: 'image', url: 'html-seq:0123456789abcdef' })).toBe(false);
    expect(isHtmlSequence({ type: 'html', url: 'html:0123456789abcdef' })).toBe(false);
  });
});
