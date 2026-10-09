import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { cn } from '@/lib/utils';
import { formatClock, keySeekTarget, pointerTime } from './seek-bar.logic';

// The film player's seek bar (showcase samples): a hairline just above the screen's sprocket edge, the played part in
// the brand gradient over the buffered part. Hovered, focused or dragged it thickens and shows its thumb, and a
// time bubble follows the pointer; a glass chip beside the player's pill reads the position. Everything that moves is a
// transform or an opacity on the site's ease-out-expo curve, so nothing reflows. It is a real slider: arrows
// step 5 s, Page Up / Page Down a tenth, Home / End the ends. Under reduced motion the player keeps the
// native controls instead, so this bar is never mounted there.

export interface SeekLabels {
  /** Accessible name of the slider, e.g. "Seek in the preview". */
  seek: string;
  /** Spoken position, e.g. "1:23 of 6:12". */
  position: (current: string, total: string) => string;
}

interface MediaTime {
  current: number;
  duration: number;
  buffered: number;
}

const bufferedEnd = (video: HTMLVideoElement): number => {
  const { buffered, currentTime } = video;

  for (let index = buffered.length - 1; index >= 0; index--) {
    if (buffered.start(index) <= currentTime) return buffered.end(index);
  }

  return 0;
};

const readTime = (video: HTMLVideoElement): MediaTime => ({
  current: video.currentTime,
  duration: Number.isFinite(video.duration) ? video.duration : 0,
  buffered: bufferedEnd(video),
});

const MEDIA_EVENTS = ['timeupdate', 'durationchange', 'loadedmetadata', 'progress', 'seeked'] as const;

// The video's clock: its events keep it current, and a frame loop while it plays keeps the fill smooth.
function useMediaTime(videoRef: RefObject<HTMLVideoElement | null>, mounted: boolean): MediaTime {
  const [time, setTime] = useState<MediaTime>({ current: 0, duration: 0, buffered: 0 });

  useEffect(() => {
    const video = videoRef.current;

    if (!video) return () => {};

    let frame = 0;
    const read = () => {
      setTime(readTime(video));
    };
    const tick = () => {
      read();
      frame = video.paused ? 0 : requestAnimationFrame(tick);
    };
    const start = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(tick);
    };

    for (const name of MEDIA_EVENTS) {
      video.addEventListener(name, read);
    }
    video.addEventListener('play', start);
    read();

    return () => {
      cancelAnimationFrame(frame);
      for (const name of MEDIA_EVENTS) video.removeEventListener(name, read);
      video.removeEventListener('play', start);
    };
  }, [videoRef, mounted]);

  return time;
}

const fraction = (part: number, whole: number): number => (whole > 0 ? Math.min(1, Math.max(0, part / whole)) : 0);

/**
 * The seek bar's labels when it should show: a showcase film (labels given), outside reduced motion (the native
 * controls seek there), once the film element exists. Undefined otherwise.
 */
export const activeSeekLabels = (
  labels: SeekLabels | undefined,
  reduced: boolean,
  mounted: boolean
): SeekLabels | undefined => (labels && !reduced && mounted ? labels : undefined);

// The seek bar under the row that reads the position and holds the player's pill (`children`): one bar the
// frame lays over the screen's foot or under it (FilmScreen's `bar`).
export const SeekBar = ({
  videoRef,
  mounted,
  labels,
  children,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  mounted: boolean;
  labels: SeekLabels;
  children?: ReactNode;
}) => {
  const time = useMediaTime(videoRef, mounted);
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [hover, setHover] = useState<{ x: number; time: number } | null>(null);
  const played = fraction(time.current, time.duration);
  const buffered = fraction(time.buffered, time.duration);

  const timeAt = (clientX: number): { x: number; time: number } | null => {
    const track = trackRef.current?.getBoundingClientRect();

    if (!track) return null;

    return {
      x: Math.min(track.width, Math.max(0, clientX - track.left)),
      time: pointerTime(clientX, track, time.duration),
    };
  };

  const seek = (target: number) => {
    const video = videoRef.current;

    if (video && time.duration > 0) video.currentTime = target;
  };

  const now = formatClock(time.current);
  const total = formatClock(time.duration);

  return (
    <div className="film-bar">
      <div className="flex min-h-10 items-center justify-between gap-3 px-3">
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none rounded-full bg-black/60 px-2.5 py-1 text-xs font-medium tabular-nums text-white/90 ring-1 ring-white/15 backdrop-blur-sm transition-opacity duration-200',
            time.duration === 0 && 'opacity-0'
          )}
        >
          {now} / {total}
        </span>
        {children}
      </div>
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label={labels.seek}
        aria-valuemin={0}
        aria-valuemax={Math.round(time.duration)}
        aria-valuenow={Math.round(time.current)}
        aria-valuetext={labels.position(now, total)}
        aria-disabled={time.duration === 0}
        data-dragging={dragging || undefined}
        className="group/seek relative mx-4 h-5 cursor-pointer touch-none outline-none"
        onKeyDown={(event) => {
          const target = keySeekTarget(event.key, time.current, time.duration);

          if (target === null) return;

          event.preventDefault();
          seek(target);
        }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
          seek(timeAt(event.clientX)?.time ?? 0);
        }}
        onPointerMove={(event) => {
          const at = timeAt(event.clientX);

          setHover(at);

          if (dragging && at) seek(at.time);
        }}
        onPointerUp={(event) => {
          event.currentTarget.releasePointerCapture(event.pointerId);
          setDragging(false);
        }}
        onPointerLeave={() => {
          if (!dragging) setHover(null);
        }}
      >
        <div className="absolute inset-x-0 bottom-2 h-1 origin-bottom overflow-hidden rounded-full bg-white/20 transition-transform duration-200 ease-[var(--ease-out-expo)] group-hover/seek:scale-y-[1.75] group-focus-visible/seek:scale-y-[1.75] group-data-[dragging]/seek:scale-y-[1.75]">
          <div className="absolute inset-0 origin-left bg-white/30" style={{ transform: `scaleX(${buffered})` }} />
          <div className="brand-gradient absolute inset-0 origin-left" style={{ transform: `scaleX(${played})` }} />
        </div>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-1.5 left-0 size-3 -translate-x-1/2"
          style={{ left: `${played * 100}%` }}
        >
          <span className="block size-full scale-0 rounded-full bg-white shadow-[0_0_0_3px_rgb(0_0_0/0.25)] transition-transform duration-150 ease-[var(--ease-out-expo)] group-hover/seek:scale-100 group-focus-visible/seek:scale-100 group-data-[dragging]/seek:scale-100" />
        </span>
        {hover && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute bottom-6 -translate-x-1/2 rounded-md bg-black/75 px-2 py-0.5 text-xs font-medium tabular-nums text-white ring-1 ring-white/15 backdrop-blur-sm"
            style={{ left: hover.x }}
          >
            {formatClock(hover.time)}
          </span>
        )}
      </div>
    </div>
  );
};
