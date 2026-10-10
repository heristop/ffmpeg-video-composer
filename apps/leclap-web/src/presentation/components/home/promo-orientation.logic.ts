// Which cut of the landing's promo videos (the two films and the effects reel) a screen gets. Each has a
// landscape cut and a 9:16 portrait one, laid out for a phone held upright: on such a screen the portrait cut
// fills the column at full height instead of playing as a 16:9 strip. Tablets and anything wider keep the
// landscape cut, and a phone turned sideways goes back to it.
export type PromoOrientation = 'landscape' | 'portrait';

/** Phone-width screens held upright. */
export const PORTRAIT_PROMO_QUERY = '(orientation: portrait) and (max-width: 767px)';

export const promoOrientation = (portraitMatches: boolean): PromoOrientation =>
  portraitMatches ? 'portrait' : 'landscape';

export interface ReelSources {
  webm: string;
  mp4: string;
  poster: string;
}

/**
 * The effects reel: a highlight cut of the effects tour (built by examples/motion-design/effects-reel.sh), served
 * VP9/WebM first with an H.264/MP4 fallback for older Safari/iOS.
 */
export const effectsReelSources = (orientation: PromoOrientation): ReelSources => {
  const base = orientation === 'portrait' ? '/videos/home/effects-reel-portrait' : '/videos/home/effects-reel';

  return { webm: `${base}.webm`, mp4: `${base}.mp4`, poster: `${base}.webp` };
};
