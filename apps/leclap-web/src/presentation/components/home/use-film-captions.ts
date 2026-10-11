import { useEffect, useState, type RefObject } from 'react';

// The film's captions, drawn by the player over its screen (film-player.tsx) rather than by the browser, so they
// rise clear of the controls: the track stays hidden and its active cue is read out as it changes.
export function useFilmCaptions(videoRef: RefObject<HTMLVideoElement | null>, mounted: boolean) {
  const [captions, setCaptions] = useState(true);
  const [cue, setCue] = useState('');

  useEffect(() => {
    const track = videoRef.current?.textTracks[0];

    if (!track) return () => {};

    track.mode = 'hidden';
    const onCueChange = () => {
      const active = track.activeCues?.[0];
      setCue(active && 'text' in active ? String(active.text) : '');
    };
    track.addEventListener('cuechange', onCueChange);

    return () => {
      track.removeEventListener('cuechange', onCueChange);
    };
  }, [videoRef, mounted]);

  return { captions, setCaptions, cue };
}

export function useFilmVisibility(videoRef: RefObject<HTMLVideoElement | null>, reduced: boolean, requested: boolean) {
  useEffect(() => {
    if (reduced && !requested) videoRef.current?.pause();
  }, [videoRef, reduced, requested]);
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) videoRef.current?.pause();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [videoRef]);
}
