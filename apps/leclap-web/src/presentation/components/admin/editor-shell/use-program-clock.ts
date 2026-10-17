// The program monitor's master clock: a rAF loop advancing a time ref and fanning it out to
// subscribers, who write straight to the DOM (the use-hero-playhead pattern — zero re-renders at
// 60fps). Only `playing` is React state (a handful of flips per session). Honors reduced motion:
// no auto-run loop, but seeks still paint once so scrubbing works.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface ProgramClock {
  playing: boolean;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seekTo: (seconds: number) => void;
  seekRatio: (ratio: number) => void;
  current: () => number;
  subscribe: (fn: (t: number) => void) => () => void;
}

export function useProgramClock(total: number, reduced: boolean): ProgramClock {
  const [playing, setPlaying] = useState(false);
  const timeRef = useRef(0);
  const totalRef = useRef(total);
  const subscribers = useRef(new Set<(t: number) => void>());

  const broadcast = useCallback(() => {
    for (const fn of subscribers.current) fn(timeRef.current);
  }, []);

  // Shrinking the timeline (scene deleted / shortened) pulls the playhead back in range.
  useEffect(() => {
    totalRef.current = total;

    if (timeRef.current <= total) return;

    timeRef.current = total;
    broadcast();
  }, [total, broadcast]);

  useEffect(() => {
    let frame = 0;

    if (playing && !reduced) {
      let last = performance.now();
      frame = requestAnimationFrame(function tick(now: number) {
        timeRef.current = Math.min(totalRef.current, timeRef.current + (now - last) / 1000);
        last = now;
        broadcast();

        if (timeRef.current >= totalRef.current) {
          setPlaying(false);

          return;
        }

        frame = requestAnimationFrame(tick);
      });
    }

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [playing, reduced, broadcast]);

  const seekTo = useCallback(
    (seconds: number) => {
      timeRef.current = Math.min(totalRef.current, Math.max(0, seconds));
      broadcast();
    },
    [broadcast]
  );

  const seekRatio = useCallback(
    (ratio: number) => {
      seekTo(Math.min(1, Math.max(0, ratio)) * totalRef.current);
    },
    [seekTo]
  );

  const play = useCallback(() => {
    // Replay from the top when the playhead is parked at the end.
    if (timeRef.current >= totalRef.current) timeRef.current = 0;
    setPlaying(true);
  }, []);

  const pause = useCallback(() => {
    setPlaying(false);
  }, []);

  const toggle = useCallback(() => {
    setPlaying((was) => {
      if (!was && timeRef.current >= totalRef.current) timeRef.current = 0;

      return !was;
    });
  }, []);

  const subscribe = useCallback((fn: (t: number) => void) => {
    subscribers.current.add(fn);
    fn(timeRef.current);

    return () => {
      subscribers.current.delete(fn);
    };
  }, []);

  const current = useCallback(() => timeRef.current, []);

  return useMemo(
    () => ({ playing, play, pause, toggle, seekTo, seekRatio, current, subscribe }),
    [playing, play, pause, toggle, seekTo, seekRatio, current, subscribe]
  );
}
