import { useEffect, useState, type RefObject } from 'react';
import { togglePip, watchPip, type PipSnapshot } from './pip.logic';

const NO_PIP: PipSnapshot = { support: 'none', active: false };

/**
 * Picture-in-Picture for the player's video (pip.logic.ts): whether the browser offers it, whether the video is in
 * its floating window, and the toggle. `key` re-attaches when the element is replaced.
 */
export function usePip(videoRef: RefObject<HTMLVideoElement | null>, key?: unknown) {
  const [snapshot, setSnapshot] = useState<PipSnapshot>(NO_PIP);

  useEffect(() => {
    const video = videoRef.current;

    if (!video) return () => {};

    return watchPip(video, document, setSnapshot);
  }, [videoRef, key]);

  const toggle = () => {
    if (videoRef.current) togglePip(videoRef.current, document);
  };

  return {
    available: snapshot.support !== 'none',
    active: snapshot.active,
    toggle: snapshot.support === 'none' ? undefined : toggle,
  };
}

export type PlayerPip = ReturnType<typeof usePip>;
