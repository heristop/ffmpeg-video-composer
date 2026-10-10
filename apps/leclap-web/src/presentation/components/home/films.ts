import type { PromoOrientation } from './promo-orientation.logic';

// The two LeClap films on the home page, rendered in the private leclap-brand-motion repo (`render-film.ts --film
// <id> --lang <lang>`, plus `--portrait` for the 9:16 cut) and exported for the web under public/videos/films: one
// MP4 per language and cut, each with its poster, and WebVTT captions per language that both cuts share (they run
// on one clock). French visitors get the French cut; every other locale gets the English one. Phones held upright
// get the portrait cut (promo-orientation.logic.ts).
export type FilmId = 'showcase' | 'agentic';
export type FilmLang = 'en' | 'fr';

export interface FilmAsset {
  mp4: string;
  poster: string;
  captions: string;
}

export const filmLang = (language: string | undefined): FilmLang => (language?.startsWith('fr') ? 'fr' : 'en');

const CUT_SUFFIX: Record<PromoOrientation, string> = { landscape: '', portrait: '-portrait' };

export const filmAsset = (
  id: FilmId,
  language: string | undefined,
  orientation: PromoOrientation = 'landscape'
): FilmAsset => {
  const lang = filmLang(language);
  const base = `/videos/films/leclap-${id}${CUT_SUFFIX[orientation]}.${lang}`;

  return { mp4: `${base}.mp4`, poster: `${base}.webp`, captions: `/videos/films/leclap-${id}.${lang}.vtt` };
};
