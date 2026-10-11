import { useEffect, useState, type RefObject } from 'react';

// The player's live state, read off the <video> element: the hook every LeClap player shares, whatever its policy
// on sound or autoplay (the landing films keep their own; see film-player.tsx).

export interface MediaState {
  paused: boolean;
  /** Stalled for data. */
  waiting: boolean;
  /** No source could play. */
  failed: boolean;
  /** It has played at least once: past the poster. */
  started: boolean;
  current: number;
  duration: number;
  /** Where the buffered range around the playhead ends. */
  buffered: number;
  /** The frame's size, once the metadata has loaded (0 before). */
  width: number;
  height: number;
}

const INITIAL: MediaState = {
  paused: true,
  waiting: false,
  failed: false,
  started: false,
  current: 0,
  duration: 0,
  buffered: 0,
  width: 0,
  height: 0,
};

const bufferedEnd = (video: HTMLVideoElement): number => {
  const { buffered, currentTime } = video;

  for (let index = buffered.length - 1; index >= 0; index--) {
    if (buffered.start(index) <= currentTime) return buffered.end(index);
  }

  return 0;
};

const NO_SOURCE = 3;

// A <source> that fails fires its error on itself, not the video: only the last one failing (no source left) or the
// element's own error means the film cannot play.
const hasFailed = (video: HTMLVideoElement): boolean => video.error !== null || video.networkState === NO_SOURCE;

const TIME_EVENTS = ['timeupdate', 'durationchange', 'loadedmetadata', 'progress', 'seeked'] as const;

/**
 * The video's state, kept current by its events, with a frame loop while it plays so the progress fill glides.
 * `key` re-attaches the listeners when the element is replaced (a lazily mounted film, a new source).
 */
export function useMediaState(videoRef: RefObject<HTMLVideoElement | null>, key?: unknown): MediaState {
  const [state, setState] = useState<MediaState>(INITIAL);

  useEffect(() => {
    const video = videoRef.current;

    if (!video) return () => {};

    let frame = 0;
    const merge = (patch: Partial<MediaState>) => {
      setState((previous) => ({ ...previous, ...patch }));
    };
    const readTime = () => {
      merge({
        current: video.currentTime,
        duration: Number.isFinite(video.duration) ? video.duration : 0,
        buffered: bufferedEnd(video),
        width: video.videoWidth,
        height: video.videoHeight,
      });
    };
    const tick = () => {
      readTime();
      frame = video.paused ? 0 : requestAnimationFrame(tick);
    };
    const onPlay = () => {
      merge({ paused: false, started: true, failed: false });
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(tick);
    };
    const onPause = () => {
      merge({ paused: true });
    };
    const onWaiting = () => {
      merge({ waiting: true });
    };
    const onReady = () => {
      merge({ waiting: false, failed: false });
    };
    const onError = () => {
      if (!hasFailed(video)) return;

      merge({ failed: true, waiting: false, paused: true });
    };
    const onEmptied = () => {
      setState({ ...INITIAL, paused: video.paused });
    };
    const listeners: Array<[string, () => void]> = [
      ['play', onPlay],
      ['pause', onPause],
      ['ended', onPause],
      ['waiting', onWaiting],
      ['playing', onReady],
      ['canplay', onReady],
      ['emptied', onEmptied],
      ...TIME_EVENTS.map((name): [string, () => void] => [name, readTime]),
    ];

    for (const [name, listener] of listeners) video.addEventListener(name, listener);
    // Capture: a <source>'s error does not bubble to the video.
    video.addEventListener('error', onError, true);
    readTime();
    merge({ paused: video.paused, failed: hasFailed(video) });

    if (!video.paused) onPlay();

    return () => {
      cancelAnimationFrame(frame);

      for (const [name, listener] of listeners) video.removeEventListener(name, listener);
      video.removeEventListener('error', onError, true);
    };
  }, [videoRef, key]);

  return state;
}
