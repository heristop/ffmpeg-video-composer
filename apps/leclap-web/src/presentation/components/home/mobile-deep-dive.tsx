import { useEffect, useRef, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useInView } from '@/hooks/useInView';
import { useMediaQuery } from '@/hooks/use-media-query';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { ArrowRight } from '@/presentation/components/icons';
import { Button } from '@/presentation/components/ui';
import { ChapterList, PINNED_QUERY, useActiveChapter } from './scroll-chapters';
import { RenderScreen } from './render-screen';
import { SectionHeading } from './section-heading';

// The mobile deep dive: four chapters of the on-device story scroll past a pinned phone whose screen follows
// them — the real app capture (pick), Alex's real take (shoot), the app's render screen live and scrubbed by
// the scroll (render, render-screen.tsx), and the real on-device render of the take (result); the clips are
// small muted loops under public/videos/home. 9:16 footage fits the screen's width over a
// blurred copy of itself instead of being cropped; app captures fill the screen (see PhoneClip). Only the
// layout on screen is mounted — the pinned phone from `lg`, one phone per chapter below it — so no clip is
// fetched or decoded twice, and a phone only plays while it is in view.

interface PhoneClip {
  key: 'pick' | 'shoot' | 'render' | 'result';
  /** The loop under public/videos/home; null for the live render screen. */
  clip: string | null;
  /**
   * App captures are cut to the screen (460x1000) with a status strip in the app header's own colour baked
   * above the header, clear of the island and the rounded corners; the status bar's ink is drawn over that
   * strip, light or dark. Full-screen footage has none and runs edge to edge.
   */
  statusBar?: 'light' | 'dark';
}

const CLIPS: readonly PhoneClip[] = [
  { key: 'pick', clip: 'mobile-pick', statusBar: 'dark' },
  { key: 'shoot', clip: 'mobile-shoot' },
  { key: 'render', clip: null, statusBar: 'light' },
  { key: 'result', clip: 'mobile-result' },
];

const clipUrl = (clip: string, ext: 'webm' | 'mp4' | 'webp'): string => `/videos/home/${clip}.${ext}`;

const RENDER_CHAPTER = CLIPS.findIndex(({ key }) => key === 'render');

export const MobileDeepDive = () => {
  const { t } = useTranslation('home');
  const { active, register } = useActiveChapter(CLIPS.length);
  const pinned = useMediaQuery(PINNED_QUERY);
  // The pinned phone's render follows its chapter's text down the page (render-screen.tsx).
  const renderText = useRef<HTMLElement | null>(null);
  const registerChapter = (index: number) => {
    const report = register(index);

    if (index !== RENDER_CHAPTER) return report;

    return (node: HTMLElement | null) => {
      report(node);
      renderText.current = node;
    };
  };
  // Clips start loading as the section approaches, not with the page.
  const [nearRef, near] = useInView<HTMLElement>({ rootMargin: '600px 0px' });
  const chapters = CLIPS.map(({ key }) => ({
    key,
    title: t(`mobile.chapters.${key}.title`),
    body: t(`mobile.chapters.${key}.body`),
  }));

  return (
    <section ref={nearRef} id="mobile" className="relative bg-background py-24 text-foreground sm:py-32">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(45%_35%_at_78%_45%,rgba(255,138,174,0.12),transparent_70%)]"
      />
      <SectionHeading eyebrow={t('mobile.eyebrow')} title={t('mobile.title')} subtitle={t('mobile.subtitle')} />

      {/* grid-cols-1 below lg: an implicit `auto` column would grow to its widest unbreakable line. */}
      <div className="relative mx-auto mt-10 grid w-full max-w-6xl grid-cols-1 gap-x-20 px-4 sm:px-6 lg:mt-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <ChapterList
          chapters={chapters}
          active={active}
          register={registerChapter}
          mediaAside
          media={(index) =>
            pinned ? null : (
              <Phone clips={[CLIPS[index]]} active={0} load={near} label={t('mobile.phoneAria')} className="w-52" />
            )
          }
        />
        {pinned && (
          <div>
            {/* The phone is pinned 18vh down, so its width also follows the viewport's height: at 340px it
                stands 713px tall, taller than a laptop window leaves it, and it would stay cut off at the fold
                for all four chapters. 36.5vh + 11px keeps its foot a couple of vh above the fold, and reaches
                340px at a 900px-tall window. */}
            <div className="sticky top-[12vh] py-[6vh]">
              <Phone
                clips={CLIPS}
                active={active}
                load={near}
                label={t('mobile.phoneAria')}
                anchor={renderText}
                className="w-full max-w-[min(340px,calc(36.5vh_+_11px))]"
              />
            </div>
          </div>
        )}
      </div>

      {/* The status reads as a light, not a control: the footer's on-device dot, no outline to press. */}
      <div className="relative mt-12 flex flex-col items-center gap-6 px-4 text-center">
        <p className="inline-flex items-center gap-2.5 text-xs font-semibold uppercase tracking-[0.22em] text-gray-300">
          <span
            aria-hidden="true"
            className="size-2 rounded-full bg-[var(--color-success)] shadow-[0_0_0_3px_color-mix(in_oklch,var(--color-success)_22%,transparent)]"
          />
          {t('mobile.badge')}
        </p>
        <Button asChild size="lg" className="group max-w-full whitespace-normal rounded-full text-center text-balance">
          <Link to="/studio">
            {t('mobile.cta')}
            <ArrowRight className="transition-transform group-hover:translate-x-1" />
          </Link>
        </Button>
      </div>
    </section>
  );
};

/** A phone frame with one screen per clip; only the active screen is visible, and it plays while in view. */
const Phone = ({
  clips,
  active,
  load,
  label,
  anchor = null,
  className,
}: {
  clips: readonly PhoneClip[];
  active: number;
  load: boolean;
  label: string;
  /** What the live render screen follows: the pinned phone's chapter text, or null for the phone itself. */
  anchor?: RefObject<HTMLElement | null> | null;
  className?: string;
}) => {
  const [viewRef, inView] = useInView<HTMLElement>({ once: false, threshold: 0.2, rootMargin: '0px' });

  return (
    <figure
      ref={viewRef}
      aria-label={label}
      className={cn(
        'relative mx-auto rounded-[2.9rem] bg-neutral-950 p-2.5 ring-1 ring-white/12',
        'shadow-[0_40px_100px_-30px_rgba(255,138,174,0.35),inset_0_0_0_1px_rgba(255,255,255,0.04)]',
        className
      )}
    >
      {/* The app captures' own 460:1000, so they fill the screen uncropped. */}
      <div className="relative aspect-[460/1000] w-full overflow-hidden rounded-[2.4rem] bg-black">
        {clips.map((clip, index) =>
          clip.clip === null ? (
            <LiveScreen key={clip.key} visible={index === active} live={inView} load={load} anchor={anchor} />
          ) : (
            <PhoneScreen
              key={clip.key}
              clip={{ ...clip, clip: clip.clip }}
              visible={index === active}
              playing={inView}
              load={load}
            />
          )
        )}
        <span
          aria-hidden="true"
          className="absolute left-1/2 top-2.5 h-5 w-20 -translate-x-1/2 rounded-full bg-black"
        />
      </div>
    </figure>
  );
};

/**
 * The render chapter's screen: the app's render screen, live (render-screen.tsx). It is mounted as the section
 * approaches and runs only while it is the screen showing and its phone is in view; until then the screen's
 * own dark surface holds its place.
 */
const LiveScreen = ({
  visible,
  live,
  load,
  anchor,
}: {
  visible: boolean;
  /** Whether the phone is on screen. */
  live: boolean;
  load: boolean;
  anchor: RefObject<HTMLElement | null> | null;
}) => (
  <div
    aria-hidden={!visible}
    className={cn(
      'absolute inset-0 bg-[#17142B] transition-opacity duration-500',
      visible ? 'opacity-100' : 'opacity-0'
    )}
  >
    {load && <RenderScreen anchor={anchor} live={live && visible} />}
    <StatusBar ink="light" />
  </div>
);

const PhoneScreen = ({
  clip,
  visible,
  playing,
  load,
}: {
  clip: PhoneClip & { clip: string };
  visible: boolean;
  /** Whether the phone is on screen: a visible screen rests while its phone is scrolled away. */
  playing: boolean;
  load: boolean;
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const reduced = useReducedMotion();

  // A screen that becomes the visible one starts from the top of its clip.
  useEffect(() => {
    const video = videoRef.current;

    if (!video || !visible) return;

    video.currentTime = 0;
  }, [visible, load]);

  // The visible screen plays while its phone is in view and resumes where it was; everything else rests.
  // Reduced motion keeps the poster frame.
  useEffect(() => {
    const video = videoRef.current;

    if (!video) return;

    if (!visible || !playing || reduced) {
      video.pause();

      return;
    }

    video.play().catch(() => {});
  }, [visible, playing, reduced, load]);

  return (
    <div
      aria-hidden={!visible}
      className={cn('absolute inset-0 transition-opacity duration-500', visible ? 'opacity-100' : 'opacity-0')}
    >
      {clip.statusBar ? (
        <>
          <ClipVideo clip={clip} load={load} fit="cover" videoRef={videoRef} />
          <StatusBar ink={clip.statusBar} />
        </>
      ) : (
        <>
          <img
            src={clipUrl(clip.clip, 'webp')}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 size-full scale-125 object-cover opacity-55 blur-2xl"
          />
          <ClipVideo clip={clip} load={load} fit="contain" videoRef={videoRef} />
        </>
      )}
      {clip.key === 'shoot' && (
        <span
          aria-hidden="true"
          className="absolute left-1/2 top-11 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1 text-[0.65rem] font-semibold tracking-[0.18em] text-white backdrop-blur-md"
        >
          <span className="size-1.5 animate-pulse rounded-full bg-red-500" />
          REC
        </span>
      )}
    </div>
  );
};

const ClipVideo = ({
  clip,
  load,
  fit,
  videoRef,
}: {
  clip: PhoneClip & { clip: string };
  load: boolean;
  fit: 'cover' | 'contain';
  videoRef: RefObject<HTMLVideoElement | null>;
}) => {
  if (!load) return null;

  return (
    <video
      ref={videoRef}
      muted
      loop
      playsInline
      preload="metadata"
      poster={clipUrl(clip.clip, 'webp')}
      className={cn('absolute inset-0 size-full', fit === 'contain' ? 'object-contain' : 'object-cover')}
    >
      <source src={clipUrl(clip.clip, 'webm')} type="video/webm" />
      <source src={clipUrl(clip.clip, 'mp4')} type="video/mp4" />
    </video>
  );
};

/** The system status bar over a capture's baked strip: clock, signal and battery, in ink that reads on it. */
const StatusBar = ({ ink }: { ink: 'light' | 'dark' }) => (
  <div
    aria-hidden="true"
    className={cn(
      'absolute inset-x-0 top-0 flex h-[6.8%] items-center justify-between px-[9%] pt-[1.2%] text-[0.6rem] font-semibold tabular-nums',
      ink === 'light' ? 'text-white' : 'text-neutral-900'
    )}
  >
    <span>9:41</span>
    <span className="flex items-center gap-1">
      <svg viewBox="0 0 18 12" className="h-2 w-auto" fill="currentColor">
        <rect x="0" y="8" width="3" height="4" rx="1" />
        <rect x="5" y="5" width="3" height="7" rx="1" />
        <rect x="10" y="2" width="3" height="10" rx="1" />
        <rect x="15" y="0" width="3" height="12" rx="1" />
      </svg>
      <svg viewBox="0 0 27 13" className="h-2 w-auto" fill="none" stroke="currentColor">
        <rect x="0.5" y="0.5" width="23" height="12" rx="3.5" opacity="0.5" />
        <rect x="2.5" y="2.5" width="17" height="8" rx="2" fill="currentColor" stroke="none" />
        <path d="M25.5 4.5v4" strokeLinecap="round" opacity="0.5" />
      </svg>
    </span>
  </div>
);
