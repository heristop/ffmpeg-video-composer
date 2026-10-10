import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useInView } from '@/hooks/useInView';
import { useMediaQuery } from '@/hooks/use-media-query';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { ArrowRight, Pause, Play } from '@/presentation/components/icons';
import { Button, Reveal } from '@/presentation/components/ui';
import { FilmScreen } from '@/presentation/components/film-frame';
import { FilmPlayer } from './film-player';
import { filmAsset, filmLang } from './films';
import { ChapterList, PINNED_QUERY, useActiveChapter } from './scroll-chapters';
import { SectionHeading } from './section-heading';
import { usePromoOrientation } from './use-promo-orientation';

// The agentic-development deep dive: the loop in four chapters beside a pinned pull request, whose step rail
// follows the chapters while the real evidence plays inside it — a LeClap engine render of before/after
// recordings of the demo shop (examples/agentic-pr-video). Then the 50-second film, and the example itself.
// The PR itself stays in English, like the product artifact it depicts. One card is mounted, pinned from
// `lg` and inline above the first chapter below it, and its evidence plays only while it is in view.

const STEPS = ['implement', 'record', 'render', 'attach'] as const;
const EXAMPLE_URL = 'https://github.com/heristop/leclap/tree/main/examples/agentic-pr-video';

export const AgenticDeepDive = () => {
  const { t, i18n } = useTranslation('home');
  const { active, register } = useActiveChapter(STEPS.length);
  const pinned = useMediaQuery(PINNED_QUERY);
  const [nearRef, near] = useInView<HTMLElement>({ rootMargin: '600px 0px' });
  const lang = filmLang(i18n.resolvedLanguage);
  const orientation = usePromoOrientation();
  const film = filmAsset('agentic', i18n.resolvedLanguage, orientation);
  const chapters = STEPS.map((key) => ({
    key,
    title: t(`agentic.chapters.${key}.title`),
    body: t(`agentic.chapters.${key}.body`),
  }));
  const card = (
    <PullRequestCard
      steps={STEPS.map((key) => t(`agentic.steps.${key}`))}
      active={active}
      load={near}
      lang={lang}
      label={t('agentic.cardAria')}
      labels={{ play: t('agentic.evidencePlay'), pause: t('agentic.evidencePause') }}
    />
  );

  return (
    <section ref={nearRef} id="agentic" className="relative bg-background py-24 text-foreground sm:py-32">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(45%_35%_at_22%_40%,rgba(124,131,253,0.14),transparent_70%)]"
      />
      <SectionHeading eyebrow={t('agentic.eyebrow')} title={t('agentic.title')} subtitle={t('agentic.subtitle')} />

      {/* grid-cols-1 below lg: the card's single-line captions would otherwise widen an implicit `auto`
          column past the viewport. The pinned card follows the chapters in the DOM too, so the reading
          order matches the screen: story on the left, the pull request beside it. */}
      <div className="relative mx-auto mt-10 grid w-full max-w-6xl grid-cols-1 gap-x-16 px-4 sm:px-6 lg:mt-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <ChapterList
          chapters={chapters}
          active={active}
          register={register}
          media={(index) => (index === 0 && !pinned ? card : null)}
        />
        {pinned && (
          <div>
            {/* The card pins 24vh down while that leaves room for all of it (about 31.5rem, attachment line
                included); a shorter window lifts it just enough to keep its foot, and the evidence's play
                button, above the fold, never higher than just under the header. */}
            <div className="sticky top-[max(calc(4.5rem_-_8vh),min(16vh,calc(92vh_-_31.5rem)))] py-[8vh]">{card}</div>
          </div>
        )}
      </div>

      <div className="relative mx-auto mt-16 w-full max-w-6xl px-4 sm:mt-24 sm:px-6">
        <Reveal className="text-center ease-[var(--ease-out-expo)]">
          <h3 className="font-display text-3xl font-bold uppercase tracking-[-0.01em] text-balance sm:text-4xl">
            {t('agentic.filmTitle')}
          </h3>
        </Reveal>
        <FilmPlayer
          key={film.mp4}
          className="mt-8"
          film={film}
          shape={orientation}
          title={t('agentic.filmName')}
          badge={t('agentic.filmBadge')}
          captionsLabel={t('film.captions')}
          captionsLang={lang}
          labels={{
            play: t('film.play'),
            pause: t('film.pause'),
            captions: t('film.captionsToggle'),
          }}
        />
        {/* The loop is open source: the runnable example, and the MCP recipe to wire it into an agent. */}
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Button
            asChild
            size="lg"
            className="group max-w-full whitespace-normal rounded-full text-center text-balance"
          >
            <a href={EXAMPLE_URL} target="_blank" rel="noopener noreferrer">
              {t('agentic.cta')}
              <ArrowRight className="transition-transform group-hover:translate-x-1" />
            </a>
          </Button>
          <Button
            asChild
            variant="outline"
            size="lg"
            className="max-w-full whitespace-normal rounded-full border-foreground/20 text-center text-balance dark:border-divider"
          >
            <Link to="/doc/mcp">{t('agentic.ctaSecondary')}</Link>
          </Button>
        </div>
      </div>
    </section>
  );
};

/**
 * The pull request, with its step rail and the evidence playing where a reviewer would press play. The
 * attachment line under it is the evidence's transport: its glyph plays and pauses the clip, and a visitor's
 * pause sticks until they press it again. Under reduced motion nothing starts until they do. The card takes
 * the page's theme, as a code host renders a pull request in either, while the evidence stays a dark screen.
 */
const PullRequestCard = ({
  steps,
  active,
  load,
  lang,
  label,
  labels,
}: {
  steps: readonly string[];
  active: number;
  load: boolean;
  lang: 'en' | 'fr';
  label: string;
  labels: { play: string; pause: string };
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const reduced = useReducedMotion();
  const [viewRef, inView] = useInView<HTMLElement>({ once: false, threshold: 0.2, rootMargin: '0px' });
  const [paused, setPaused] = useState(true);
  const [held, setHeld] = useState(false);
  const clip = lang === 'fr' ? 'agentic-evidence.fr' : 'agentic-evidence';

  // The evidence plays while the card is on screen and rests once it is scrolled away. Under reduced
  // motion it rests off-screen too, but never starts by itself.
  useEffect(() => {
    const video = videoRef.current;

    if (!video) return;

    if (!inView || held) {
      video.pause();

      return;
    }

    if (reduced) return;

    video.play().catch(() => {});
  }, [load, inView, held, reduced]);

  // Reduced motion switched on mid-visit stills whatever is playing.
  useEffect(() => {
    if (reduced) videoRef.current?.pause();
  }, [reduced]);

  const togglePlay = () => {
    const video = videoRef.current;

    if (!video) return;

    if (video.paused) {
      setHeld(false);
      video.play().catch(() => {});

      return;
    }

    setHeld(true);
    video.pause();
  };

  return (
    <figure
      ref={viewRef}
      aria-label={label}
      className="overflow-hidden rounded-[1.5rem] bg-surface-2/90 ring-1 ring-foreground/10 shadow-[0_40px_110px_-35px_rgba(124,131,253,0.4)] backdrop-blur-xl dark:bg-neutral-950/85 dark:ring-white/10 dark:shadow-[0_40px_110px_-35px_rgba(124,131,253,0.5)]"
    >
      <div className="border-b border-foreground/10 px-5 py-4 sm:px-6 dark:border-white/10">
        <p className="font-mono text-xs text-gray-500">kiln-co / shop · pull request #482</p>
        <p className="mt-2 font-display text-xl font-bold leading-tight sm:text-2xl">
          fix(product): make Add to cart obvious
        </p>
        <span className="mt-3 inline-flex rounded-full bg-emerald-500/12 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-600/25 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/30">
          Ready for review
        </span>
      </div>
      <ol className="grid grid-cols-4 gap-2 px-5 pt-4 sm:px-6" aria-hidden="true">
        {steps.map((step, index) => (
          <li key={step} className="min-w-0">
            {/* The rail fills like a playhead: each step's gradient wipes in from the left as its chapter
                is reached, and wipes back out on the way up. A gradient can't be colour-transitioned, so
                the fill is a scaled layer over the groove rather than a background swap. */}
            <span className="relative block h-1 overflow-hidden rounded-full bg-foreground/10">
              <span
                className={cn(
                  'brand-gradient absolute inset-0 origin-left transition-transform duration-500 ease-[var(--ease-out-expo)]',
                  index <= active ? 'scale-x-100' : 'scale-x-0'
                )}
              />
            </span>
            {/* Hyphenated rather than truncated: a quarter of a phone-wide card is narrower than the longest
                localized step ("Implementieren"), which would otherwise end in an ellipsis. */}
            <span
              className={cn(
                'mt-2 block hyphens-auto text-[0.6rem] font-semibold uppercase tracking-[0.06em] wrap-break-word transition-colors duration-500 sm:text-[0.65rem] sm:tracking-[0.14em]',
                index === active ? 'text-foreground' : 'text-gray-500'
              )}
            >
              {step}
            </span>
          </li>
        ))}
      </ol>
      <div className="p-4 sm:p-5">
        {/* The page's one video frame, without a label: the shop's own header sits in that corner. */}
        <FilmScreen paused={paused}>
          {load && (
            <video
              ref={videoRef}
              muted
              loop
              playsInline
              preload="metadata"
              poster={`/videos/home/${clip}.webp`}
              className="absolute inset-0 size-full object-cover"
              onPlay={() => {
                setPaused(false);
              }}
              onPause={() => {
                setPaused(true);
              }}
            >
              <source src={`/videos/home/${clip}.webm`} type="video/webm" />
              <source src={`/videos/home/${clip}.mp4`} type="video/mp4" />
            </video>
          )}
        </FilmScreen>
        <p className="mt-3 flex min-w-0 items-center gap-1.5 font-mono text-[0.7rem] text-gray-500">
          {/* 24 px glyph, 44 px hit area; the extra reach sits in the gap above, clear of the video. */}
          <button
            type="button"
            onClick={togglePlay}
            disabled={!load}
            aria-label={paused ? labels.play : labels.pause}
            className="tap relative -ml-1 grid size-6 shrink-0 place-items-center rounded-full text-gray-400 before:absolute before:-inset-2.5 before:content-[''] hover:text-foreground [&_svg]:size-3.5"
          >
            {paused ? <Play /> : <Pause />}
          </button>
          <span className="truncate">pr-evidence.mp4 — rendered by LeClap from before-after.json</span>
        </p>
      </div>
    </figure>
  );
};
