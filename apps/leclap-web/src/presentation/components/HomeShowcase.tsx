import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, ChevronRight, Pause, Play } from '@/presentation/components/icons';
import { useInView } from '@/hooks/useInView';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { playWithSound, readSound, tellVideo } from '@/lib/landing-sound';
import { Button } from '@/presentation/components/ui';
import { FilmScreen, FilmStage, FrameButton, SoundControl, useFilmSound } from '@/presentation/components/film-frame';
import { SectionHeading } from '@/presentation/components/home/section-heading';

// The clip is a 19-second highlight reel cut from the effects tour (examples/motion-design/effects-tour.json),
// an actual LeClap render (1280x720) under public/videos/home, over a bundled lo-fi track. It plays as an
// ambient loop to show the product's output up front, with the landing's one sound: muted until the
// visitor turns it on, here or anywhere else on the page. The corner pill turns the sound on and
// pauses it (as on the films, a visitor's pause sticks). Served VP9/WebM first (smaller) with an
// H.264/MP4 fallback for older Safari/iOS. The file is lazy-mounted only as the frame nears the
// viewport, so it never costs an above-the-fold visitor. Reduced-motion users get a paused player
// with native controls.
const VIDEO_SRC_WEBM = '/videos/home/effects-reel.webm';
const VIDEO_SRC_MP4 = '/videos/home/effects-reel.mp4';

export const HomeShowcase = () => {
  const { t } = useTranslation('home');
  const videoRef = useRef<HTMLVideoElement>(null);
  // Two IntersectionObservers on the same frame: one fires early (300px ahead) to start fetching the
  // clip; the other toggles as the frame enters/leaves the viewport (not once) so playback can pause
  // off-screen.
  const [loadRef, shouldLoad] = useInView({ rootMargin: '300px' });
  const [playRef, playInView] = useInView({ once: false, threshold: 0 });
  const setFrameRef = useCallback(
    (node: HTMLDivElement | null) => {
      loadRef.current = node;
      playRef.current = node;
    },
    [loadRef, playRef]
  );
  const reduced = useReducedMotion();
  const { muted, volume, toggle, changeVolume, refuse, adopt } = useFilmSound(videoRef);
  const [paused, setPaused] = useState(true);
  const [held, setHeld] = useState(false);
  // The controls exist before the clip does, so a keyboard visitor tabbing down the page lands on them instead
  // of skipping the frame (focusing one scrolls it near, and the clip mounts): the pill from the first render,
  // and under reduced motion the native player itself, which fetches nothing until the frame nears the viewport.
  const mounted = shouldLoad || reduced;
  // Store the element AND set `muted` as an attribute the instant it mounts, before the browser
  // evaluates autoplay eligibility — otherwise some browsers refuse the scroll-triggered play(). It
  // starts on the landing's sound (muted, unless the visitor already turned it on): the same state the
  // sound hook applies after every render, so they agree however React orders the two.
  const setVideoEl = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;

    if (node) {
      const { enabled, volume: level } = readSound();

      tellVideo(node, !enabled, level);
      node.setAttribute('muted', '');
    }
  }, []);

  // Pause the clip while it's off-screen (and resume on return, with the landing's sound) so it never
  // decodes behind the fold, unless the visitor paused it themselves. Under reduced motion it rests
  // off-screen too, but never starts by itself.
  useEffect(() => {
    const el = videoRef.current;

    if (!el) return;

    if (!playInView || held) {
      el.pause();

      return;
    }

    if (reduced) return;

    playWithSound(el, !muted, refuse);
  }, [playInView, held, reduced, shouldLoad, muted, refuse]);

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
    <section id="showcase" className="relative bg-background py-24 text-foreground sm:py-32">
      <SectionHeading eyebrow={t('showcase.eyebrow')} title={t('showcase.title')} subtitle={t('showcase.subtitle')} />
      <div className="relative mx-auto w-full max-w-6xl px-4 sm:px-6">
        {/* The page's one frame (film-frame.tsx), on its stage: same size and scroll entrance as the films. */}
        <FilmStage frameRef={setFrameRef} className="mt-12 sm:mt-16">
          {/* No corner badge: the reel's own top-left labels name each effect, and a pill there would cover them. */}
          <FilmScreen
            controlLabel={t('showcase.badge')}
            paused={paused}
            control={
              reduced ? undefined : (
                <>
                  <SoundControl
                    muted={muted}
                    volume={volume}
                    playing={!paused}
                    onToggle={toggle}
                    onVolume={changeVolume}
                  />
                  <FrameButton label={paused ? t('showcase.play') : t('showcase.pause')} onClick={togglePlay}>
                    {paused ? <Play /> : <Pause />}
                  </FrameButton>
                </>
              )
            }
          >
            {/* Shimmer placeholder holds the frame until the video is mounted. */}
            {!mounted && (
              <div
                aria-hidden="true"
                className="absolute inset-0 animate-pulse bg-linear-to-br from-brand-500/20 via-secondary-500/10 to-accent-400/15"
              />
            )}

            {mounted && (
              <video
                ref={setVideoEl}
                className="h-full w-full object-cover"
                autoPlay={!reduced}
                loop
                playsInline
                controls={reduced}
                preload={shouldLoad ? 'auto' : 'none'}
                aria-label={t('showcase.videoAria')}
                onLoadedData={(event) => {
                  if (reduced || !playInView || held) return;

                  playWithSound(event.currentTarget, !muted, refuse);
                }}
                onPlay={() => {
                  setPaused(false);
                }}
                onPause={() => {
                  setPaused(true);
                }}
                // Under reduced motion the native controls can turn the sound on or off: every video follows.
                onVolumeChange={
                  reduced
                    ? (event) => {
                        adopt(event.currentTarget);
                      }
                    : undefined
                }
              >
                <source src={VIDEO_SRC_WEBM} type="video/webm" />
                <source src={VIDEO_SRC_MP4} type="video/mp4" />
              </video>
            )}
          </FilmScreen>
        </FilmStage>

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
