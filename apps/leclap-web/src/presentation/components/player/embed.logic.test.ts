import { describe, expect, it } from 'vitest';
import { embedAvailable, embedPath, embedSnippet, parseEmbed } from './embed.logic';

describe('embedPath', () => {
  it('addresses a showcase sample by its id', () => {
    expect(embedPath({ kind: 'sample', id: 'effects-tour' })).toBe('/embed/sample/effects-tour');
  });

  it('addresses a film by its id and language', () => {
    expect(embedPath({ kind: 'film', id: 'agentic', lang: 'fr' })).toBe('/embed/film/agentic?lang=fr');
  });

  it('addresses the effects reel', () => {
    expect(embedPath({ kind: 'reel', id: 'effects' })).toBe('/embed/reel/effects');
  });

  it('encodes ids that are not url-safe', () => {
    expect(embedPath({ kind: 'sample', id: 'a b' })).toBe('/embed/sample/a%20b');
  });
});

describe('parseEmbed', () => {
  it('reads a sample, a film and the reel back', () => {
    expect(parseEmbed('sample', 'effects-tour', '')).toEqual({ kind: 'sample', id: 'effects-tour' });
    expect(parseEmbed('film', 'showcase', '?lang=fr')).toEqual({ kind: 'film', id: 'showcase', lang: 'fr' });
    expect(parseEmbed('reel', 'effects', '')).toEqual({ kind: 'reel', id: 'effects' });
  });

  it('defaults a film to English', () => {
    expect(parseEmbed('film', 'agentic', '?lang=de')).toEqual({ kind: 'film', id: 'agentic', lang: 'en' });
  });

  it('refuses unknown kinds, films and reels', () => {
    expect(parseEmbed('render', 'x', '')).toBeNull();
    expect(parseEmbed('film', 'teaser', '')).toBeNull();
    expect(parseEmbed('reel', 'other', '')).toBeNull();
    expect(parseEmbed(undefined, 'x', '')).toBeNull();
    expect(parseEmbed('sample', undefined, '')).toBeNull();
  });
});

describe('embedSnippet', () => {
  it('writes a responsive, chromeless iframe for the video', () => {
    const snippet = embedSnippet({
      origin: 'https://leclap.dev',
      ref: { kind: 'sample', id: 'effects-tour' },
      title: 'Effects tour',
      shape: 'landscape',
    });

    expect(snippet).toBe(
      '<iframe src="https://leclap.dev/embed/sample/effects-tour" title="Effects tour" width="640" height="360" ' +
        'style="width:100%;height:auto;aspect-ratio:16/9;border:0" ' +
        'allow="autoplay; fullscreen; picture-in-picture" allowfullscreen loading="lazy"></iframe>'
    );
  });

  it('sizes a portrait or square video to its shape', () => {
    const portrait = embedSnippet({
      origin: 'https://leclap.dev',
      ref: { kind: 'sample', id: 'story-reel' },
      title: 'Story',
      shape: 'portrait',
    });

    expect(portrait).toContain('width="360" height="640"');
    expect(portrait).toContain('aspect-ratio:9/16');
    expect(
      embedSnippet({ origin: 'https://leclap.dev', ref: { kind: 'reel', id: 'effects' }, title: 'R', shape: 'square' })
    ).toContain('aspect-ratio:1/1');
  });

  it('escapes the title', () => {
    const snippet = embedSnippet({
      origin: 'https://leclap.dev',
      ref: { kind: 'sample', id: 'x' },
      title: 'Say "hi" & <wave>',
      shape: 'landscape',
    });

    expect(snippet).toContain('title="Say &quot;hi&quot; &amp; &lt;wave&gt;"');
  });
});

describe('embedAvailable', () => {
  const ref = { kind: 'sample', id: 'effects-tour' } as const;

  it('offers embedding for a video with a public address', () => {
    expect(embedAvailable('/videos/showcase/effects-tour.mp4', ref)).toBe(true);
  });

  it('hides it for a local render, which only lives in this browser', () => {
    expect(embedAvailable('blob:https://leclap.dev/1234', ref)).toBe(false);
    expect(embedAvailable('data:video/mp4;base64,AAAA', ref)).toBe(false);
  });

  it('hides it for a video that has no embed address', () => {
    expect(embedAvailable('/videos/showcase/effects-tour.mp4', undefined)).toBe(false);
  });
});
