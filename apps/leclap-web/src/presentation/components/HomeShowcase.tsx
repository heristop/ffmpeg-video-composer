import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, ChevronRight } from '@/presentation/components/icons';
import { Button } from '@/presentation/components/ui';
import { SectionHeading } from '@/presentation/components/home/section-heading';
import { FilmPlayer } from '@/presentation/components/home/film-player';
import { effectsReelSources } from '@/presentation/components/home/promo-orientation.logic';
import { usePromoOrientation } from '@/presentation/components/home/use-promo-orientation';

// The clip is a highlight reel cut from the effects tour (examples/motion-design/effects-tour.json, cut by
// examples/motion-design/effects-reel.sh), an actual LeClap render under public/videos/home, over a bundled lo-fi
// track; a phone held upright gets its 9:16 cut in a portrait frame (promo-orientation.logic.ts). It plays in the
// landing's film player (film-player.tsx) as an ambient loop to show the product's output up front, with the
// landing's one sound: muted until the visitor turns it on, here or anywhere else on the page, and a visitor's
// pause sticks. Served VP9/WebM first (smaller) with an H.264/MP4 fallback for older Safari/iOS. The file is
// lazy-mounted only as the frame nears the viewport, so it never costs an above-the-fold visitor. Under reduced
// motion nothing plays by itself.
export const HomeShowcase = () => {
  const { t } = useTranslation('home');
  const orientation = usePromoOrientation();
  const reel = effectsReelSources(orientation);

  return (
    <section id="showcase" className="relative bg-background py-24 text-foreground sm:py-32">
      <SectionHeading eyebrow={t('showcase.eyebrow')} title={t('showcase.title')} subtitle={t('showcase.subtitle')} />
      <div className="relative mx-auto w-full max-w-6xl px-4 sm:px-6">
        {/* The page's one frame (film-frame.tsx), on its stage: same size and scroll entrance as the films. No corner
            badge: the reel's own top-left labels name each effect, and a pill there would cover them. Keyed by the
            cut: a turned phone loads the other file instead of cropping this one. */}
        <FilmPlayer
          key={reel.mp4}
          className="mt-12 sm:mt-16"
          film={reel}
          shape={orientation}
          loop
          title={t('showcase.videoAria')}
          labels={{ play: t('showcase.play'), pause: t('showcase.pause') }}
        />

        {/* CTA cluster: the one filled primary, then the three ways to look around as lavender text links with a
            chevron (the brand's link colour), so the render keeps a single call to action. On
            phones the links share a row under it. */}
        <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center sm:gap-5">
          <Button
            asChild
            size="lg"
            className="group max-w-full whitespace-normal rounded-full text-center text-balance"
          >
            <Link to="/studio">
              {t('showcase.cta')}
              <ArrowRight className="transition-transform group-hover:translate-x-1" />
            </Link>
          </Button>
          <div className="flex flex-wrap justify-center gap-x-2">
            <Button asChild variant="link" className="group gap-1 px-3 [&_svg]:size-4">
              <Link to="/showcase">
                {t('showcase.viewShowcase')}
                <ChevronRight className="transition-transform group-hover:translate-x-0.5" />
              </Link>
            </Button>
            <Button asChild variant="link" className="group gap-1 px-3 [&_svg]:size-4">
              <Link to="/templates">
                {t('showcase.browseTemplates')}
                <ChevronRight className="transition-transform group-hover:translate-x-0.5" />
              </Link>
            </Button>
            <Button asChild variant="link" className="group gap-1 px-3 [&_svg]:size-4">
              <Link to="/doc">
                {t('showcase.readDocs')}
                <ChevronRight className="transition-transform group-hover:translate-x-0.5" />
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
};
