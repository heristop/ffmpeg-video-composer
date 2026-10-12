import { useEffect, useRef } from 'react';
import { LogoMark, type LogoMarkHandle } from '@/presentation/components/LogoMark';
import { cn } from '@/lib/utils';
import { formatClock } from './player.logic';
import { aspectLabel } from './timeline.logic';
import type { MediaState } from './use-media-state';

// The player's LeClap layer, drawn over the footage: the title card a video waits on (and that returns, larger, in
// fullscreen), the monitor's corner brackets, and the clapper that slams when a visitor starts the film. All of it
// is decorative (aria-hidden): the frame's own name and controls carry the meaning.

/** The program monitor's corner registration brackets (kinetic/program-monitor.tsx), over footage. */
export function PlayerBrackets({ className }: { className?: string }) {
  const corner = 'absolute size-5 border-player-fg/55 group-data-[fullscreen]/player:size-8';

  return (
    <span aria-hidden="true" className={cn('pointer-events-none absolute inset-x-3 top-3 bottom-24 z-[5]', className)}>
      <span className={cn(corner, 'left-0 top-0 rounded-tl-md border-l-2 border-t-2')} />
      <span className={cn(corner, 'right-0 top-0 rounded-tr-md border-r-2 border-t-2')} />
      <span className={cn(corner, 'bottom-0 left-0 rounded-bl-md border-b-2 border-l-2')} />
      <span className={cn(corner, 'bottom-0 right-0 rounded-br-md border-b-2 border-r-2')} />
    </span>
  );
}

/** The card's facts before the video's metadata has loaded: its shape ("9:16") and its length in seconds. */
export interface CardMeta {
  shape?: string;
  duration?: number;
}

/** The tally chip's row (kinetic/program-monitor.tsx): the LeClap mark, the frame's shape and the length. */
function SlateChips({ media, meta }: { media: MediaState; meta?: CardMeta }) {
  // Zero and empty mean the metadata has not loaded yet: fall back to what the caller knows.
  const measured = aspectLabel(media.width, media.height);
  const shape = measured === '' ? meta?.shape : measured;
  const duration = media.duration > 0 ? media.duration : (meta?.duration ?? 0);

  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-player-ink/60 py-1 pl-1 pr-2.5 font-mono text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-player-fg/90 ring-1 ring-player-fg/15 backdrop-blur-sm">
      <img src="/favicon.svg" alt="" width={18} height={18} className="size-[1.125rem] rounded-[0.3rem]" />
      <span className="text-player-fg">LeClap</span>
      {shape && <span className="text-brand-200">{shape}</span>}
      {duration > 0 && <span className="tabular-nums text-player-fg/70">{formatClock(duration)}</span>}
    </span>
  );
}

/**
 * The title card: a slate in the top-left corner over a soft scrim, with the LeClap chip row and the video's title in
 * the display face. On the poster it is the video's cover; in fullscreen it returns larger and fades with the
 * controls, the way a cinema title holds over the opening shot. Mini frames keep the chips and drop the title.
 */
export function PlayerTitleCard({
  title,
  media,
  meta,
  cinema,
  className,
}: {
  title?: string;
  media: MediaState;
  meta?: CardMeta;
  /** Fullscreen: larger, under the controls' fade. */
  cinema: boolean;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute inset-x-0 top-0 z-[6] bg-linear-to-b from-player-ink/70 via-player-ink/25 to-transparent px-4 pb-20 pt-4 sm:px-5',
        cinema && 'player-fade px-8 pt-8 sm:px-10 sm:pt-10',
        className
      )}
    >
      <SlateChips media={media} meta={meta} />
      {title && (
        <p
          className={cn(
            'mt-2 max-w-[28ch] font-display text-xl font-bold uppercase leading-[1.05] tracking-[-0.01em] text-balance text-player-fg [text-shadow:0_2px_12px_color-mix(in_oklch,var(--color-player-ink)_70%,transparent)] sm:text-2xl @max-[24rem]/player:hidden',
            cinema && 'text-3xl sm:text-5xl'
          )}
        >
          {title}
        </p>
      )}
    </div>
  );
}

/**
 * The clap: the LeClap mark (the header's logo) pops at the centre as the visitor starts the film and claps its
 * stick shut as it lands, then fades. Keyed by each start, so it replays every time; reduced motion never shows it.
 */
export function PlayerClap() {
  const mark = useRef<LogoMarkHandle>(null);

  useEffect(() => {
    // Clap as the pop reaches full size, not while the mark is still growing in.
    const timer = setTimeout(() => mark.current?.clap(), 180);

    return () => {
      clearTimeout(timer);
    };
  }, []);

  return (
    <span
      aria-hidden="true"
      data-player-clap="logo"
      className="player-clap pointer-events-none absolute left-1/2 top-1/2 z-[15] motion-reduce:hidden"
    >
      <LogoMark ref={mark} className="size-20 [filter:drop-shadow(0_10px_24px_rgba(28,21,64,0.55))]" />
    </span>
  );
}
