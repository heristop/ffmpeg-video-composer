import { useEffect, useState, type RefObject } from 'react';
import { fullscreenPlan, readRate, stepRate } from './player.logic';
import type { MediaState } from './use-media-state';

// The player's actions on its <video>: speed, fullscreen, play/pause/seek and volume. Shared by every LeClap player;
// the landing films bring their own sound (film-frame.tsx), the rest use useVolume.

const RATE_KEY = 'leclap-player-rate';

const storedRate = (): number => {
  try {
    return readRate(sessionStorage.getItem(RATE_KEY));
  } catch {
    return 1;
  }
};

/**
 * The playback speed, remembered for the session so the next video plays at the same pace, pitch preserved. It is
 * written to the element after every render, so a video that mounts late or reloads its source picks it up too.
 */
export function usePlaybackRate(videoRef: RefObject<HTMLVideoElement | null>) {
  const [rate, setRateState] = useState(storedRate);

  useEffect(() => {
    const video = videoRef.current;

    if (!video) return;

    video.preservesPitch = true;
    video.defaultPlaybackRate = rate;
    video.playbackRate = rate;
  });

  const setRate = (next: number) => {
    setRateState(next);

    try {
      sessionStorage.setItem(RATE_KEY, String(next));
    } catch {
      /* storage may be unavailable (private mode): the speed still applies to this video */
    }
  };

  const step = (direction: 1 | -1) => {
    setRate(stepRate(rate, direction));
  };

  return { rate, setRate, step };
}

type WebkitDocument = Document & { webkitFullscreenElement?: Element | null };

const fullscreenElement = (): Element | null =>
  document.fullscreenElement ?? (document as WebkitDocument).webkitFullscreenElement ?? null;

type WebkitVideo = HTMLVideoElement & { webkitEnterFullscreen: () => void; webkitDisplayingFullscreen: boolean };

// iOS Safari only lets the video itself go fullscreen, natively.
const videoFullscreen = (video: HTMLVideoElement | null): video is WebkitVideo =>
  video !== null && 'webkitEnterFullscreen' in video && 'webkitDisplayingFullscreen' in video;

const FULLSCREEN_EVENTS = ['fullscreenchange', 'webkitfullscreenchange'] as const;
const VIDEO_FULLSCREEN_EVENTS = ['webkitbeginfullscreen', 'webkitendfullscreen'] as const;

/**
 * Fullscreen on the player's own frame, so its controls come along; iOS Safari, which only lets a video go
 * fullscreen, gets the video's native fullscreen instead. Escape (or the system gesture) leaves it, as usual.
 * `element` is the frame while it is fullscreen: the menus render inside it then, or they would not show.
 */
export function useFullscreen(
  containerRef: RefObject<HTMLElement | null>,
  videoRef: RefObject<HTMLVideoElement | null>
) {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [nativeVideo, setNativeVideo] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    const sync = () => {
      const container = containerRef.current;

      setElement(container && fullscreenElement() === container ? container : null);
      setNativeVideo(videoFullscreen(video) && video.webkitDisplayingFullscreen);
    };

    for (const name of FULLSCREEN_EVENTS) document.addEventListener(name, sync);

    for (const name of VIDEO_FULLSCREEN_EVENTS) video?.addEventListener(name, sync);

    return () => {
      for (const name of FULLSCREEN_EVENTS) document.removeEventListener(name, sync);

      for (const name of VIDEO_FULLSCREEN_EVENTS) video?.removeEventListener(name, sync);
    };
  });

  const toggle = () => {
    const container = containerRef.current;
    const video = videoRef.current;
    const plan = fullscreenPlan({
      active: container !== null && fullscreenElement() === container,
      containerSupported: document.fullscreenEnabled && container !== null && 'requestFullscreen' in container,
      videoSupported: videoFullscreen(video),
    });

    if (plan === 'exit') {
      document.exitFullscreen().catch(() => {});

      return;
    }

    if (plan === 'container') {
      container?.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});

      return;
    }

    if (plan === 'video' && videoFullscreen(video)) video.webkitEnterFullscreen();
  };

  return { active: element !== null || nativeVideo, element, toggle };
}

/** Play, pause, retry and seek, for a player whose sound has no policy of its own. */
export function useTransport(videoRef: RefObject<HTMLVideoElement | null>, media: MediaState) {
  const play = () => {
    videoRef.current?.play().catch(() => {});
  };

  const retry = () => {
    videoRef.current?.load();
    play();
  };

  const toggle = () => {
    const video = videoRef.current;

    if (!video) return;

    if (media.failed) {
      retry();

      return;
    }

    if (video.paused || video.ended) {
      play();

      return;
    }

    video.pause();
  };

  const seekTo = (seconds: number) => {
    const video = videoRef.current;

    if (!video || media.duration === 0) return;

    video.currentTime = seconds;
  };

  return { retry, toggle, seekTo };
}

const clampVolume = (value: number): number => Math.min(1, Math.max(0, Math.round(value * 100) / 100));

/** Mute and volume on the element; unmuting from silence comes back at full volume. */
export function useVolume(videoRef: RefObject<HTMLVideoElement | null>, startMuted: boolean) {
  const [muted, setMuted] = useState(startMuted);
  const [volume, setVolume] = useState(1);

  const setLevel = (next: number) => {
    const video = videoRef.current;
    const level = clampVolume(next);

    if (!video) return;

    video.volume = level;
    video.muted = level === 0;
    setVolume(level);
    setMuted(level === 0);
  };

  const toggleMute = () => {
    const video = videoRef.current;

    if (!video) return;

    if (muted && volume === 0) {
      setLevel(1);

      return;
    }

    video.muted = !muted;
    setMuted(!muted);
  };

  const volumeBy = (delta: number) => {
    setLevel((muted ? 0 : volume) + delta);
  };

  return { muted, volume, setLevel, toggleMute, volumeBy };
}
