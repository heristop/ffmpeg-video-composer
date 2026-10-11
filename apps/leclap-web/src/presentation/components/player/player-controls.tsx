import { useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import * as SliderPrimitive from '@radix-ui/react-slider';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { cva, type VariantProps } from 'class-variance-authority';
import { AlertCircle, Check, Code2, Ellipsis, Loader2, Maximize, Minimize, RotateCcw } from 'lucide-react';
import { Captions, CaptionsOff, Volume2, VolumeX } from '@/presentation/components/icons';
import { PlayIcon } from '@/presentation/components/icons/play';
import { PauseIcon } from '@/presentation/components/icons/pause';
import { cn } from '@/lib/utils';
import { PLAYBACK_RATES, formatClock, formatRate, fraction, keySeekTarget, pointerTime } from './player.logic';

// The LeClap player's controls: one set, shared by every player in the app. Each is a real control (Radix where
// Radix has one: the seek and volume sliders, the speed and more menus) with a translated name, a 44 px target,
// the brand's lavender for progress and focus, and the player's ink and off-white tokens, never a raw colour.
// They sit on the player's own scrim, so they read the same over any footage in either theme; the menus they
// open are the app's dark popover surface, like its dialogs.

export const playerButtonVariants = cva(
  [
    'tap relative grid shrink-0 cursor-pointer place-items-center rounded-full text-player-fg/85',
    'transition-[transform,background-color,color] duration-150 ease-[var(--ease-smooth)]',
    'hover:bg-player-fg/12 hover:text-player-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400',
    'aria-pressed:text-player-fg data-[state=open]:bg-player-fg/15 data-[state=open]:text-player-fg',
    'disabled:pointer-events-none disabled:opacity-40',
  ],
  {
    variants: {
      size: {
        // 44 px everywhere: on a phone the bar sits over footage, where a miss plays or pauses instead.
        md: 'size-11 [&_svg]:size-5 group-data-[fullscreen]/player:size-12',
        wide: 'h-11 min-w-11 px-2.5 text-sm font-semibold tabular-nums group-data-[fullscreen]/player:h-12',
        hero: 'size-16 bg-player-ink/55 text-player-fg ring-1 ring-player-fg/20 backdrop-blur-md hover:bg-player-ink/70 hover:scale-105 focus-visible:ring-4 [&_svg]:size-7 sm:size-[4.5rem] @max-[24rem]/player:size-12 @max-[24rem]/player:[&_svg]:size-5',
      },
    },
    defaultVariants: { size: 'md' },
  }
);

export type PlayerButtonProps = ComponentProps<'button'> &
  VariantProps<typeof playerButtonVariants> & {
    /** The accessible name, shown as a tooltip too. */
    label: string;
  };

export function PlayerButton({ label, size, className, children, ...props }: PlayerButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(playerButtonVariants({ size }), className)}
      {...props}
    >
      {children}
    </button>
  );
}

/** Play or pause, in the bar. */
export function PlayerPlayButton({
  paused,
  labels,
  onToggle,
}: {
  paused: boolean;
  labels: { play: string; pause: string };
  onToggle: () => void;
}) {
  return (
    <PlayerButton label={paused ? labels.play : labels.pause} onClick={onToggle} data-player-play="">
      {paused ? <PlayIcon size={20} className="translate-x-px" /> : <PauseIcon size={20} />}
    </PlayerButton>
  );
}

/** The big centre button over the poster and a paused film: the surface's one obvious action. */
export function PlayerCenterButton({ label, onToggle }: { label: string; onToggle: () => void }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
      <PlayerButton size="hero" label={label} onClick={onToggle} className="pointer-events-auto" data-player-center="">
        <PlayIcon size={28} className="translate-x-0.5" />
      </PlayerButton>
    </div>
  );
}

/**
 * The seek bar: a Radix slider whose track shows what has played (lavender) over what has buffered. Hovered,
 * focused or dragged it thickens (a transform, so nothing reflows) and shows its thumb, and a time bubble follows
 * the pointer. Arrows step 5 s, Page Up/Down a tenth, Home/End the ends; it speaks "1:23 of 6:12".
 */
export function PlayerSeek({
  current,
  duration,
  buffered,
  onSeek,
  onScrub,
  className,
}: {
  current: number;
  duration: number;
  buffered: number;
  onSeek: (seconds: number) => void;
  /** Whether a drag is under way, so the chrome stays up meanwhile. */
  onScrub?: (scrubbing: boolean) => void;
  className?: string;
}) {
  const { t } = useTranslation('player');
  const rootRef = useRef<HTMLSpanElement>(null);
  const [hover, setHover] = useState<{ x: number; time: number } | null>(null);
  const loaded = fraction(buffered, duration);
  const now = formatClock(current);
  const total = formatClock(duration);

  return (
    <SliderPrimitive.Root
      ref={rootRef}
      value={[Math.min(current, duration)]}
      max={duration > 0 ? duration : 1}
      step={0.01}
      disabled={duration === 0}
      onValueChange={([next]) => {
        onSeek(next);
      }}
      onPointerDown={() => onScrub?.(true)}
      onValueCommit={() => onScrub?.(false)}
      onLostPointerCapture={() => onScrub?.(false)}
      onKeyDown={(event) => {
        const target = keySeekTarget(event.key, current, duration);

        if (target === null) return;

        event.preventDefault();
        onSeek(target);
      }}
      onPointerMove={(event) => {
        const box = rootRef.current?.getBoundingClientRect();

        if (!box) return;

        setHover({
          x: Math.min(box.width, Math.max(0, event.clientX - box.left)),
          time: pointerTime(event.clientX, box, duration),
        });
      }}
      onPointerLeave={() => {
        setHover(null);
      }}
      className={cn(
        'group/seek relative flex h-6 w-full cursor-pointer touch-none select-none items-center data-[disabled]:cursor-default',
        className
      )}
    >
      <SliderPrimitive.Track className="relative h-1 grow origin-center overflow-hidden rounded-full bg-player-fg/25 transition-transform duration-200 ease-[var(--ease-out-expo)] group-hover/seek:scale-y-150 group-has-[:focus-visible]/seek:scale-y-150">
        <span
          aria-hidden="true"
          className="absolute inset-0 origin-left bg-player-fg/30"
          style={{ transform: `scaleX(${loaded})` }}
        />
        <SliderPrimitive.Range className="absolute h-full bg-brand-500" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        aria-label={t('seek')}
        aria-valuetext={t('position', { current: now, total })}
        className="block size-3.5 scale-0 rounded-full bg-player-fg shadow-[0_0_0_3px_color-mix(in_oklch,var(--color-player-ink)_35%,transparent)] transition-transform duration-150 ease-[var(--ease-out-expo)] group-hover/seek:scale-100 focus-visible:scale-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-400/60"
      />
      {hover && duration > 0 && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-6 -translate-x-1/2 rounded-md bg-player-ink/80 px-2 py-0.5 text-xs font-medium tabular-nums text-player-fg ring-1 ring-player-fg/15 backdrop-blur-sm"
          style={{ left: hover.x }}
        >
          {formatClock(hover.time)}
        </span>
      )}
    </SliderPrimitive.Root>
  );
}

/** "0:42 / 6:12" in tabular figures; the seek slider speaks the position, so this is for the eye only. */
export function PlayerTime({
  current,
  duration,
  className,
}: {
  current: number;
  duration: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'whitespace-nowrap px-1.5 text-sm font-medium tabular-nums tracking-wide text-player-fg/90 transition-opacity duration-200',
        duration === 0 && 'opacity-0',
        className
      )}
    >
      {formatClock(current)}
      <span className="text-player-fg/55"> / {formatClock(duration)}</span>
    </span>
  );
}

/**
 * The volume slider: a Radix slider beside the speaker button, where the bar has room (a hovering pointer and a wide
 * frame; a phone's volume is its own buttons). It reads 0 while muted and speaks a percentage.
 */
export function PlayerVolumeSlider({
  level,
  onVolume,
  className,
}: {
  level: number;
  onVolume: (next: number) => void;
  className?: string;
}) {
  const { t } = useTranslation('player');

  return (
    <SliderPrimitive.Root
      value={[level]}
      max={1}
      step={0.05}
      onValueChange={([next]) => {
        onVolume(next);
      }}
      className={cn(
        'group/vol relative hidden h-11 w-20 cursor-pointer touch-none select-none items-center pr-2 [@media(hover:hover)]:@min-[30rem]/player:flex',
        className
      )}
    >
      <SliderPrimitive.Track className="relative h-1 grow overflow-hidden rounded-full bg-player-fg/25">
        <SliderPrimitive.Range className="absolute h-full bg-player-fg" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        aria-label={t('volume')}
        aria-valuetext={`${Math.round(level * 100)}%`}
        className="block size-3 rounded-full bg-player-fg transition-transform duration-150 group-hover/vol:scale-110 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-400/60"
      />
    </SliderPrimitive.Root>
  );
}

/** Mute and volume: the speaker button and its slider. */
export function PlayerVolume({
  muted,
  volume,
  onToggle,
  onVolume,
  className,
}: {
  muted: boolean;
  volume: number;
  onToggle: () => void;
  onVolume: (next: number) => void;
  className?: string;
}) {
  const { t } = useTranslation('player');

  return (
    <div className={cn('flex items-center', className)}>
      <PlayerButton label={muted ? t('unmute') : t('mute')} onClick={onToggle} data-player-mute="">
        {muted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
      </PlayerButton>
      <PlayerVolumeSlider level={muted ? 0 : volume} onVolume={onVolume} />
    </div>
  );
}

/** Captions on or off: a pressed toggle. */
export function PlayerCaptionsButton({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  const { t } = useTranslation('player');

  return (
    <PlayerButton label={t('captions')} aria-pressed={on} onClick={onToggle}>
      {on ? <Captions aria-hidden="true" /> : <CaptionsOff aria-hidden="true" />}
    </PlayerButton>
  );
}

/** Fullscreen on or off. */
export function PlayerFullscreenButton({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  const { t } = useTranslation('player');

  return (
    <PlayerButton label={active ? t('exitFullscreen') : t('fullscreen')} onClick={onToggle} data-player-fullscreen="">
      {active ? <Minimize aria-hidden="true" /> : <Maximize aria-hidden="true" />}
    </PlayerButton>
  );
}

const MENU_CONTENT = cn(
  'dark z-[70] min-w-40 rounded-xl border border-divider bg-surface p-1 text-foreground shadow-[var(--shadow-lg)]',
  'origin-[var(--radix-dropdown-menu-content-transform-origin)] data-[state=open]:animate-[player-menu-in_0.16s_var(--ease-out-expo)]'
);

const MENU_ITEM =
  'relative flex min-h-11 cursor-pointer select-none items-center gap-2.5 rounded-lg px-3 text-sm text-foreground outline-none data-[highlighted]:bg-brand-500/15 [&_svg]:size-4 [&_svg]:shrink-0';

interface MenuProps {
  /** Where the menu renders: the player itself while it is fullscreen, so the menu shows there too. */
  container?: HTMLElement | null;
  onOpenChange?: (open: boolean) => void;
}

/** The speed menu: its button reads the current speed; the menu lists the six, the current one checked. */
export function PlayerRateMenu({
  rate,
  onRate,
  container,
  onOpenChange,
}: MenuProps & { rate: number; onRate: (rate: number) => void }) {
  const { t } = useTranslation('player');
  const shown = formatRate(rate);

  return (
    <DropdownMenu.Root modal={false} onOpenChange={onOpenChange}>
      <DropdownMenu.Trigger asChild>
        <PlayerButton size="wide" label={t('speedValue', { rate: shown })} data-player-rate="">
          {shown}
        </PlayerButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal container={container ?? undefined}>
        <DropdownMenu.Content side="top" align="end" sideOffset={8} collisionPadding={8} className={MENU_CONTENT}>
          <DropdownMenu.Label className="px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
            {t('speed')}
          </DropdownMenu.Label>
          <DropdownMenu.RadioGroup
            value={String(rate)}
            onValueChange={(value) => {
              onRate(Number(value));
            }}
          >
            {PLAYBACK_RATES.map((step) => (
              <DropdownMenu.RadioItem key={step} value={String(step)} className={cn(MENU_ITEM, 'pl-9 tabular-nums')}>
                <span className="absolute left-3 grid size-4 place-items-center">
                  <DropdownMenu.ItemIndicator>
                    <Check className="text-brand-300" aria-hidden="true" />
                  </DropdownMenu.ItemIndicator>
                </span>
                {step === 1 ? t('normalSpeed') : formatRate(step)}
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** The overflow menu: today the embed code, for a video the site serves publicly. */
export function PlayerMoreMenu({ onEmbed, container, onOpenChange }: MenuProps & { onEmbed: () => void }) {
  const { t } = useTranslation('player');

  return (
    <DropdownMenu.Root modal={false} onOpenChange={onOpenChange}>
      <DropdownMenu.Trigger asChild>
        <PlayerButton label={t('more')} data-player-more="">
          <Ellipsis aria-hidden="true" />
        </PlayerButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal container={container ?? undefined}>
        <DropdownMenu.Content side="top" align="end" sideOffset={8} collisionPadding={8} className={MENU_CONTENT}>
          <DropdownMenu.Item className={MENU_ITEM} onSelect={onEmbed}>
            <Code2 aria-hidden="true" className="text-brand-300" />
            {t('embed')}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** Loading (a spinner, after a beat) and failure (what happened, and a retry), centred on the screen. */
export function PlayerStatus({
  waiting,
  failed,
  labels,
  onRetry,
}: {
  waiting: boolean;
  failed: boolean;
  labels: { loading: string; error: string; retry: string };
  onRetry: () => void;
}) {
  if (failed) {
    return (
      <div className="absolute inset-0 z-20 grid place-items-center bg-player-ink/70 p-4">
        <div role="alert" className="flex max-w-xs flex-col items-center gap-3 text-center text-player-fg">
          <AlertCircle className="size-7 text-secondary-300" aria-hidden="true" />
          <p className="text-sm font-medium leading-snug text-balance">{labels.error}</p>
          <button
            type="button"
            onClick={onRetry}
            className="tap inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full bg-player-fg px-4 text-sm font-semibold text-player-ink transition-[transform,background-color] duration-150 hover:bg-brand-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-player-ink [&_svg]:size-4"
          >
            <RotateCcw aria-hidden="true" />
            {labels.retry}
          </button>
        </div>
      </div>
    );
  }

  if (!waiting) return null;

  return (
    <div role="status" className="player-delayed pointer-events-none absolute inset-0 z-10 grid place-items-center">
      <span className="grid size-16 place-items-center rounded-full bg-player-ink/55 text-brand-300 ring-1 ring-player-fg/15 backdrop-blur-md">
        <Loader2 className="size-7 motion-safe:animate-spin" aria-hidden="true" />
      </span>
      <span className="sr-only">{labels.loading}</span>
    </div>
  );
}

/**
 * The control bar's layout: the seek bar on top, then the transport on the left (`start`) and the rest on the right
 * (`end`), all on the player's scrim. It is a named group, so several players on one page stay tell-apart.
 */
export function PlayerBar({
  label,
  seek,
  start,
  end,
  className,
}: {
  label: string;
  seek?: ReactNode;
  start: ReactNode;
  end: ReactNode;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn('player-bar flex flex-col px-2 pb-1', className)}>
      {seek && <div className="px-2">{seek}</div>}
      <div className="flex items-center justify-between gap-1">
        <div className="flex min-w-0 items-center">{start}</div>
        <div className="flex shrink-0 items-center">{end}</div>
      </div>
    </div>
  );
}
