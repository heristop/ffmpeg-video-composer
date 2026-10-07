import { useCallback, useEffect, useRef, useState } from 'react';
import { useInView } from '@/hooks/useInView';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { playWithSound, readSound, tellVideo } from '@/lib/landing-sound';
import { FilmScreen, FilmStage, useFilmSound } from '@/presentation/components/film-frame';
import { FilmPlaybackControls, FilmFeedback, type FilmPlayerLabels } from './film-player-controls';
import { useFilmCaptions, useFilmVisibility } from './use-film-captions';
import { OptionalSeekBar, activeSeekLabels, type SeekLabels } from './seek-bar';
import type { FilmAsset } from './films';

interface FilmPlayerProps {
  film: Pick<FilmAsset, 'mp4' | 'poster'> & Partial<Pick<FilmAsset, 'captions'>>;
  /** Accessible name of the film. */
  title: string;
  /** The frame's label pill, e.g. "The film · 1:18". */
  badge?: string;
  /** Label of the captions track, and its language. */
  captionsLabel?: string;
  captionsLang?: string;
  labels: FilmPlayerLabels;
  className?: string;
  /** Landing films play on view; showcase samples wait for a visitor request. */
  playback?: 'ambient' | 'requested';
  startRequested?: boolean;
  /** Show a seek bar along the bottom edge (showcase samples); the landing films keep the plain pill. */
  seekLabels?: SeekLabels;
}

// Nothing streams before the frame nears the viewport, even where the element already exists (reduced motion).
const preloadWhen = (near: boolean): 'metadata' | 'none' => (near ? 'metadata' : 'none');

type SaveDataNavigator = Navigator & { connection?: { saveData?: boolean } };

// Save-Data visitors get the poster and the play button: nothing streams until they ask for it.
const prefersSaveData = (): boolean =>
  (globalThis.navigator as SaveDataNavigator | undefined)?.connection?.saveData === true;

// A film in the page's one video frame (film-frame.tsx), like the in-browser render: it loads as it nears the
// viewport, plays while on screen and rests off-screen. It speaks with the landing's one sound: muted until
// the visitor turns it on, here or anywhere else on the page, its captions carrying the narration meanwhile.
// The first time a film is heard it starts over, so the narration is heard whole, and it no longer loops, so
// the film ends. The glass pill turns the sound on, plays and pauses, and toggles the captions; a visitor's
// pause sticks. Reduced motion: the native controls and captions, and nothing plays by itself.
export const FilmPlayer = ({
  film,
  title,
  badge,
  captionsLabel,
  captionsLang,
  labels,
  className,
  playback = 'ambient',
  startRequested = false,
  seekLabels,
}: FilmPlayerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const reduced = useReducedMotion();
  const [loadRef, shouldLoad] = useInView({ rootMargin: '300px' });
  const [playRef, inView] = useInView({ once: false, threshold: 0.35, rootMargin: '0px' });
  const { muted, volume, toggle, changeVolume, refuse, adopt } = useFilmSound(videoRef);
  const [paused, setPaused] = useState(true);
  const [held, setHeld] = useState(() => (playback === 'requested' ? !startRequested : prefersSaveData()));
  const [waiting, setWaiting] = useState(false);
  const [failed, setFailed] = useState(false);
  // Whether the film has played with sound yet: the first time it does, it starts from the top.
  const heard = useRef(false);
  // Every control exists before the film does, so a keyboard visitor tabbing down the page lands on them
  // instead of skipping the frame (focusing one scrolls the frame near, and the film mounts): the pill from
  // the first render, and under reduced motion the native player itself, which fetches nothing until the
  // frame nears the viewport.
  const mounted = shouldLoad || reduced;
  const { captions, setCaptions, cue } = useFilmCaptions(videoRef, reduced, mounted);
  useFilmVisibility(videoRef, reduced, startRequested);

  const setFrameRef = useCallback(
    (node: HTMLDivElement | null) => {
      loadRef.current = node;
      playRef.current = node;
    },
    [loadRef, playRef]
  );

  // On the landing's sound from the instant it mounts — muted, unless the visitor already turned it on — before
  // the browser weighs autoplay, so the in-view play() goes through. The same state the sound hook applies
  // after every render, so however React orders the two (StrictMode re-attaches refs after effects), they agree.
  const setVideoEl = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;

    if (!node) return;

    const { enabled, volume: level } = readSound();

    tellVideo(node, !enabled, level);
    node.setAttribute('muted', '');
  }, []);

  // On screen it plays with the landing's sound, starting over the first time that sound is on, whether it was
  // switched on here or elsewhere. A browser that refuses the sound leaves the film unheard, for its own
  // button to start over. Under reduced motion the film rests off-screen too, but never starts by itself.
  useEffect(() => {
    const video = videoRef.current;

    if (!video) return;

    if (!inView || held) {
      video.pause();

      return;
    }

    if ((reduced && !startRequested) || document.hidden) return;

    if (!muted && !heard.current) {
      heard.current = true;
      video.currentTime = 0;
    }

    playWithSound(video, !muted, () => {
      heard.current = false;
      refuse();
    });
  }, [inView, held, reduced, shouldLoad, muted, refuse, startRequested]);

  const togglePlay = () => {
    const video = videoRef.current;

    if (!video) return;

    if (failed) {
      video.load();
      setFailed(false);
    }

    if (video.paused) {
      setHeld(false);
      playWithSound(video, !muted, refuse);

      return;
    }

    setHeld(true);
    video.pause();
  };

  // The first time the sound comes on from this film's own pill, it starts over inside the click, where every
  // browser allows sound, whether the sound came on through the button or the slider.
  const hearFromTheTop = () => {
    const video = videoRef.current;

    if (!video || heard.current) return;

    heard.current = true;
    video.currentTime = 0;
    setHeld(false);
    video.play().catch(() => {});
  };

  const control = reduced ? undefined : (
    <FilmPlaybackControls
      labels={labels}
      paused={paused}
      failed={failed}
      muted={muted}
      volume={volume}
      captionsAvailable={Boolean(film.captions)}
      captions={captions}
      onPlay={togglePlay}
      onCaptions={() => {
        setCaptions((shown) => !shown);
      }}
      onSound={() => {
        const turningOn = muted;
        toggle();

        if (turningOn) hearFromTheTop();
      }}
      onVolume={(next) => {
        const turningOn = muted && next > 0;
        changeVolume(next);

        if (turningOn) hearFromTheTop();
      }}
    />
  );

  return (
    <FilmStage frameRef={setFrameRef} className={className}>
      <FilmScreen
        badge={badge}
        control={control}
        controlLabel={title}
        paused={paused}
        raised={activeSeekLabels(seekLabels, reduced, mounted) !== undefined}
      >
        {!mounted && (
          <img
            src={film.poster}
            alt=""
            loading="lazy"
            decoding="async"
            className="absolute inset-0 size-full object-cover"
          />
        )}
        {mounted && (
          <video
            ref={setVideoEl}
            className="absolute inset-0 size-full object-cover"
            poster={film.poster}
            loop={playback === 'ambient' && muted}
            playsInline
            preload={playback === 'requested' ? 'none' : preloadWhen(shouldLoad)}
            controls={reduced}
            aria-label={title}
            onPlay={() => {
              setPaused(false);
            }}
            onPause={() => {
              setPaused(true);
            }}
            onEnded={() => {
              setHeld(true);
              setPaused(true);
            }}
            onWaiting={() => {
              setWaiting(true);
            }}
            onPlaying={() => {
              setWaiting(false);
            }}
            onCanPlay={() => {
              setWaiting(false);
            }}
            onError={() => {
              setFailed(true);
              setWaiting(false);
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
            <source src={film.mp4} type="video/mp4" />
            {film.captions && (
              <track kind="captions" src={film.captions} srcLang={captionsLang} label={captionsLabel} default />
            )}
          </video>
        )}
        <FilmFeedback waiting={waiting} failed={failed} labels={labels} cue={cue} captions={captions && !reduced} />
        <OptionalSeekBar
          videoRef={videoRef}
          mounted={mounted}
          labels={activeSeekLabels(seekLabels, reduced, mounted)}
        />
      </FilmScreen>
    </FilmStage>
  );
};
