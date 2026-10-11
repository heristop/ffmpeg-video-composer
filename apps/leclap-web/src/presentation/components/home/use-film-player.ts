import { useEffect, useRef, useState, type RefObject } from 'react';
import { playWithSound } from '@/lib/landing-sound';
import { useFilmSound } from '@/presentation/components/film-frame';
import type { MediaState } from '@/presentation/components/player/use-media-state';
import { filmPlayback } from './film-playback.logic';

// A landing film's playback and sound policy, as hooks for film-player.tsx: it plays while on screen and rests
// off-screen, with the landing's one sound, and the first time it is heard it starts over.

type SaveDataNavigator = Navigator & { connection?: { saveData?: boolean } };

// Save-Data visitors get the poster and the play button: nothing streams until they ask for it.
const prefersSaveData = (): boolean =>
  (globalThis.navigator as SaveDataNavigator | undefined)?.connection?.saveData === true;

interface FilmPolicy {
  playback: 'ambient' | 'requested';
  startRequested: boolean;
  inView: boolean;
  suspended: boolean;
  reduced: boolean;
  /** Re-runs the policy once the film element mounts. */
  shouldLoad: boolean;
}

/**
 * The film's playback and sound: whether the visitor holds it paused (`held`: their pause, its end, or a requested
 * film still waiting), the landing's sound, and the actions that respect both. On screen it plays with the
 * landing's sound, starting over the first time that sound is on, whether it was switched on here or elsewhere. A
 * browser that refuses the sound leaves the film unheard, for its own button to start over. Under reduced motion it
 * rests off-screen too, but never starts by itself.
 */
export function useFilmPlayer(videoRef: RefObject<HTMLVideoElement | null>, policy: FilmPolicy, media: MediaState) {
  const { muted, volume, toggle, changeVolume, refuse } = useFilmSound(videoRef);
  const [held, setHeld] = useState(() =>
    policy.playback === 'requested' ? !policy.startRequested : prefersSaveData()
  );
  // Whether the film has played with sound yet: the first time it does, it starts from the top.
  const heard = useRef(false);
  const { inView, suspended, reduced, startRequested, shouldLoad } = policy;

  useEffect(() => {
    const video = videoRef.current;
    const next = filmPlayback({ inView, held, suspended, reduced, requested: startRequested, hidden: document.hidden });

    if (!video || next === 'rest') return;

    if (next === 'pause') {
      video.pause();

      return;
    }

    if (!muted && !heard.current) {
      heard.current = true;
      video.currentTime = 0;
    }

    playWithSound(video, !muted, () => {
      heard.current = false;
      refuse();
    });
  }, [videoRef, inView, held, suspended, reduced, shouldLoad, muted, refuse, startRequested]);

  const togglePlay = () => {
    const video = videoRef.current;

    if (!video) return;

    if (media.failed) video.load();

    if (video.paused) {
      setHeld(false);
      playWithSound(video, !muted, refuse);

      return;
    }

    setHeld(true);
    video.pause();
  };

  // The first time the sound comes on from this film's own bar, it starts over inside the click, where every
  // browser allows sound, whether the sound came on through the button or the slider.
  const hearFromTheTop = () => {
    const video = videoRef.current;

    if (!video || heard.current) return;

    heard.current = true;
    video.currentTime = 0;
    setHeld(false);
    video.play().catch(() => {});
  };

  const sound = () => {
    const turningOn = muted;
    toggle();

    if (turningOn) hearFromTheTop();
  };

  const level = (next: number) => {
    const turningOn = muted && next > 0;
    changeVolume(Math.min(1, Math.max(0, next)));

    if (turningOn) hearFromTheTop();
  };

  return {
    muted,
    volume,
    held,
    togglePlay,
    sound,
    level,
    volumeBy: (delta: number) => {
      level((muted ? 0 : volume) + delta);
    },
    ended: () => {
      setHeld(true);
    },
  };
}
