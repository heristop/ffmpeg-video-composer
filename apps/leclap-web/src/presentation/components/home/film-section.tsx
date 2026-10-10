import { useTranslation } from 'react-i18next';
import { FilmPlayer } from './film-player';
import { filmAsset, filmLang } from './films';
import { SectionHeading } from './section-heading';
import { usePromoOrientation } from './use-promo-orientation';

// The film, right under the hero: the 78-second showcase in a cinema frame — one idea for this viewport,
// the product proving itself with real renders and real captures. Localized cut and captions.
export const FilmSection = () => {
  const { t, i18n } = useTranslation('home');
  // A phone held upright gets the 9:16 cut in a portrait frame.
  const orientation = usePromoOrientation();
  const film = filmAsset('showcase', i18n.resolvedLanguage, orientation);

  return (
    <section id="film" className="relative overflow-hidden bg-background py-24 text-foreground sm:py-32 lg:py-40">
      {/* In the dark, the light falls on the headline from above; the mask fades it in below the section's top
          edge, so the hero's dark foot flows into it instead of meeting a lit band. A lit page needs no
          projector, and a faint pool of lavender on it only shows its gradient bands, so light mode goes
          without. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 hidden h-2/3 bg-[radial-gradient(55%_60%_at_50%_0%,rgba(124,131,253,0.16),transparent_70%)] [mask-image:linear-gradient(to_bottom,transparent,black_14rem)] dark:block"
      />
      <SectionHeading eyebrow={t('film.eyebrow')} title={t('film.title')} subtitle={t('film.subtitle')} />
      <div className="relative mx-auto w-full max-w-6xl px-4 sm:px-6">
        {/* Keyed by the cut, so a language switch or a turned phone starts the new one fresh (muted, from the top). */}
        <FilmPlayer
          key={film.mp4}
          className="mt-12 sm:mt-16"
          film={film}
          shape={orientation}
          title={t('film.name')}
          badge={t('film.badge')}
          captionsLabel={t('film.captions')}
          captionsLang={filmLang(i18n.resolvedLanguage)}
          labels={{
            play: t('film.play'),
            pause: t('film.pause'),
            captions: t('film.captionsToggle'),
          }}
        />
      </div>
    </section>
  );
};
