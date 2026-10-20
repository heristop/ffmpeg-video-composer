// A track's measured waveform (64 RMS bars from the catalog profile) as a playhead: the played part in
// lavender, the rest muted. With `onSeek`, hovering marks where a click lands and the click jumps there.
import { useState, type MouseEvent } from 'react';
import { profileBars } from '@leclap/creative-kit/music-profile';
import { cn } from '@/lib/utils';

const HEIGHT = 16;

interface WaveformProps {
  peaks: string;
  // 0..1 through the track.
  progress: number;
  onSeek?: (ratio: number) => void;
  // Accessible name of the seek control (only with onSeek).
  seekLabel?: string;
  className?: string;
}

function ratioAt(event: MouseEvent<HTMLElement>): number {
  const rect = event.currentTarget.getBoundingClientRect();

  return rect.width > 0 ? Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) : 0;
}

function Bars({ peaks, progress }: { peaks: string; progress: number }) {
  const bars = profileBars(peaks);

  return (
    <svg
      viewBox={`0 0 ${bars.length} ${HEIGHT}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      className="block size-full"
    >
      {bars.map((level, index) => {
        const height = Math.max(1, level * HEIGHT);

        return (
          <rect
            key={index}
            x={index + 0.18}
            width={0.64}
            y={(HEIGHT - height) / 2}
            height={height}
            className={(index + 0.5) / bars.length <= progress ? 'fill-brand-400' : 'fill-foreground/25'}
          />
        );
      })}
    </svg>
  );
}

export function Waveform({ peaks, progress, onSeek, seekLabel, className }: WaveformProps) {
  const [hover, setHover] = useState<number | null>(null);

  if (!onSeek) {
    return (
      <span className={cn('block', className)}>
        <Bars peaks={peaks} progress={progress} />
      </span>
    );
  }

  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={seekLabel}
      onPointerMove={(event) => {
        setHover(ratioAt(event));
      }}
      onPointerLeave={() => {
        setHover(null);
      }}
      onClick={(event) => {
        onSeek(ratioAt(event));
      }}
      className={cn('relative block cursor-pointer', className)}
    >
      <Bars peaks={peaks} progress={progress} />
      {hover === null ? null : (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 w-px bg-foreground/80"
          style={{ left: `${(hover * 100).toFixed(2)}%` }}
        />
      )}
    </button>
  );
}
