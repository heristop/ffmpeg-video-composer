import { useEffect, useState, type RefObject } from 'react';

export function useFilmCaptions(videoRef: RefObject<HTMLVideoElement | null>, reduced: boolean, mounted: boolean) {
  const [captions, setCaptions] = useState(true);
  const [cue, setCue] = useState('');

  useEffect(() => {
    const track = videoRef.current?.textTracks[0];

    if (!track) return () => {};

    if (reduced) {
      track.mode = 'showing';

      return () => {};
    }
    track.mode = 'hidden';
    const onCueChange = () => {
      const active = track.activeCues?.[0];
      setCue(active && 'text' in active ? String(active.text) : '');
    };
    track.addEventListener('cuechange', onCueChange);

    return () => {
      track.removeEventListener('cuechange', onCueChange);
    };
  }, [videoRef, reduced, mounted]);

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
