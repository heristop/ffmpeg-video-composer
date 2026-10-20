// The program monitor's transport bar: play/pause, a scrubbable timeline with full-height scene edges a
// scrub snaps to, a playhead bar, and an SMPTE timecode readout with its frame rate. All per-frame updates (range value, gradient fill, timecode text) are
// written straight to refs by the clock subscription — the studio-range/--range-pct pattern from the
// home hero — so scrubbing and playback stay at 60fps with zero re-renders.
import { useEffect, useRef, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { PlayIcon } from '@/presentation/components/icons/play';
import { PauseIcon } from '@/presentation/components/icons/pause';
import { formatTimecode } from '../../home/hero-timecode.logic';
import { totalDuration, type Segment } from './program-timeline.logic';
import { PREVIEW_FPS, sceneEdges, snapToEdge } from './program-music.logic';
import type { ProgramClock } from './use-program-clock';

const SCRUB_RESOLUTION = 1000;
// A scrub within this share of the timeline of a scene edge lands on the edge.
const SNAP_SHARE = 0.012;

interface ProgramTransportProps {
  clock: ProgramClock;
  timeline: Segment[];
  // Parks the program monitor on `seconds` (pausing playback), so the scrubbed frame shows.
  onSeek: (seconds: number) => void;
}

export const ProgramTransport = ({ clock, timeline, onSeek }: ProgramTransportProps) => {
  const { t } = useTranslation('admin');
  const rangeRef = useRef<HTMLInputElement>(null);
  const timecodeRef = useRef<HTMLSpanElement>(null);
  const total = totalDuration(timeline);

  useEffect(() => {
    return clock.subscribe((time) => {
      const ratio = total > 0 ? time / total : 0;
      const range = rangeRef.current;
      const readout = timecodeRef.current;

      if (readout) readout.textContent = formatTimecode(time, PREVIEW_FPS);

      if (!range) return;

      range.valueAsNumber = Math.round(ratio * SCRUB_RESOLUTION);
      range.style.setProperty('--range-pct', `${(ratio * 100).toFixed(2)}%`);
    });
  }, [clock, total]);

  const onScrub = (event: ChangeEvent<HTMLInputElement>): void => {
    const seconds = (event.target.valueAsNumber / SCRUB_RESOLUTION) * total;
    onSeek(snapToEdge(sceneEdges(timeline), seconds, total * SNAP_SHARE));
  };

  return (
    // Docked inside the ProgramMonitor between the stage's gradient out-edge and the status strip,
    // so it reads as one piece of deck chrome (padding aligned with the strip, no extra border).
    <div className="flex items-center gap-3 bg-surface-2/40 px-4 py-2">
      <button
        type="button"
        onClick={clock.toggle}
        aria-label={clock.playing ? t('monitor.pause') : t('monitor.play')}
        title={t('shell.playTooltip')}
        className="tap relative grid size-9 shrink-0 cursor-pointer place-items-center rounded-full bg-brand-500/15 text-brand-600 transition-colors before:absolute before:-inset-1 before:content-[''] hover:bg-brand-500/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-brand-300"
      >
        {clock.playing ? <PauseIcon size={16} /> : <PlayIcon size={16} className="translate-x-px" />}
      </button>
      <div className="relative flex-1">
        <input
          ref={rangeRef}
          type="range"
          min={0}
          max={SCRUB_RESOLUTION}
          defaultValue={0}
          onChange={onScrub}
          aria-label={t('monitor.scrub')}
          className="studio-range transport-scrub w-full"
        />
        {/* Scene edges as full-height hairlines, so cuts read while scrubbing (and the scrub snaps to them). */}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          {timeline.slice(0, -1).map((segment) => (
            <span
              key={segment.index}
              className="absolute inset-y-0.5 w-px bg-foreground/25"
              style={{ left: `${((segment.end / total) * 100).toFixed(2)}%` }}
            />
          ))}
        </div>
      </div>
      <span className="flex shrink-0 items-baseline gap-1.5 font-mono text-[0.7rem] tabular-nums">
        <span ref={timecodeRef} className="text-foreground/85">
          00:00:00:00
        </span>
        <span className="text-gray-500">{t('monitor.fps', { fps: PREVIEW_FPS })}</span>
      </span>
    </div>
  );
};
