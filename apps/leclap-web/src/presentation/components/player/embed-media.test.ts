import { describe, expect, it } from 'vitest';
import { embedMedia } from './embed-media';

describe('embedMedia', () => {
  it('plays a showcase sample from its public preview, in the shape it was made', () => {
    expect(embedMedia({ kind: 'sample', id: 'story-reel' })).toEqual({
      sources: [{ src: '/videos/showcase/story-reel.mp4', type: 'video/mp4' }],
      poster: '/videos/showcase/story-reel.webp',
      shape: 'portrait',
      sample: expect.objectContaining({ id: 'story-reel' }),
    });
  });

  it('refuses a sample the catalog does not have', () => {
    expect(embedMedia({ kind: 'sample', id: 'nope' })).toBeNull();
  });

  it('plays a film in its language, with its captions', () => {
    expect(embedMedia({ kind: 'film', id: 'agentic', lang: 'fr' })).toEqual({
      sources: [{ src: '/videos/films/leclap-agentic.fr.mp4', type: 'video/mp4' }],
      poster: '/videos/films/leclap-agentic.fr.webp',
      captions: { src: '/videos/films/leclap-agentic.fr.vtt', lang: 'fr' },
      shape: 'landscape',
    });
  });

  it('plays the effects reel, WebM first', () => {
    expect(embedMedia({ kind: 'reel', id: 'effects' })).toEqual({
      sources: [
        { src: '/videos/home/effects-reel.webm', type: 'video/webm' },
        { src: '/videos/home/effects-reel.mp4', type: 'video/mp4' },
      ],
      poster: '/videos/home/effects-reel.webp',
      shape: 'landscape',
    });
  });
});
