import {
  SHOWCASE_SAMPLES,
  mediaPath,
  sampleShape,
  type ShowcaseSample,
} from '@/presentation/components/showcase/catalog';
import { filmAsset } from '@/presentation/components/home/films';
import { effectsReelSources } from '@/presentation/components/home/promo-orientation.logic';
import type { EmbedRef, EmbedShape } from './embed.logic';

export interface PlayerSource {
  src: string;
  type: string;
}

export interface PlayerCaptions {
  src: string;
  lang: string;
  label?: string;
}

export interface EmbedMedia {
  sources: PlayerSource[];
  poster: string;
  shape: EmbedShape;
  captions?: PlayerCaptions;
  /** The showcase sample, whose title names the embed. */
  sample?: ShowcaseSample;
}

/** What an embed plays: the same public files the site's own players use. Null for a sample the catalog lacks. */
export function embedMedia(ref: EmbedRef): EmbedMedia | null {
  if (ref.kind === 'sample') {
    const sample = SHOWCASE_SAMPLES.find((candidate) => candidate.id === ref.id);

    if (!sample) return null;

    return {
      sources: [{ src: mediaPath(sample, 'mp4'), type: 'video/mp4' }],
      poster: mediaPath(sample, 'webp'),
      shape: sampleShape(sample),
      sample,
    };
  }

  if (ref.kind === 'film') {
    const film = filmAsset(ref.id, ref.lang);

    return {
      sources: [{ src: film.mp4, type: 'video/mp4' }],
      poster: film.poster,
      captions: { src: film.captions, lang: ref.lang },
      shape: 'landscape',
    };
  }

  const reel = effectsReelSources('landscape');

  return {
    sources: [
      { src: reel.webm, type: 'video/webm' },
      { src: reel.mp4, type: 'video/mp4' },
    ],
    poster: reel.poster,
    shape: 'landscape',
  };
}
