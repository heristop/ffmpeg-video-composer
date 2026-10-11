import { useState, type ComponentProps, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import * as SliderPrimitive from '@radix-ui/react-slider';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { cva, type VariantProps } from 'class-variance-authority';
import { Check, Maximize, Minimize } from 'lucide-react';
import { Captions, CaptionsOff, Volume2, VolumeX } from '@/presentation/components/icons';
import { PlayIcon } from '@/presentation/components/icons/play';
import { PauseIcon } from '@/presentation/components/icons/pause';
import { cn } from '@/lib/utils';
import { PLAYBACK_RATES, formatClock, formatRate } from './player.logic';
import { rateRoll } from './timeline.logic';

// The LeClap player's controls: one set, shared by every player in the app, in the app's own vocabulary. The
// buttons sit in glass capsules like the header's pills, press with the app's tap spring and focus with the brand
// ring; the speed is a brand chip whose figure rolls as it changes; the time reads in the mono of the app's slates;
// the centre button is the primary call to action, in the brand gradient with its glow. Every control is a real one
// (Radix where Radix has one) with a translated name and a 44 px target, on the player's ink and off-white tokens.

export const playerButtonVariants = cva(
  [
    'tap relative grid shrink-0 cursor-pointer place-items-center rounded-full text-player-fg/85',
    'transition-[transform,background-color,color] duration-150 ease-[var(--ease-smooth)]',
    'hover:bg-player-fg/12 hover:text-player-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400',
    'aria-pressed:text-brand-200 data-[state=open]:bg-player-fg/15 data-[state=open]:text-player-fg',
    'disabled:pointer-events-none disabled:opacity-40',
  ],
  {
    variants: {
      size: {
        // 44 px everywhere: on a phone the bar sits over footage, where a miss plays or pauses instead.
        md: 'size-11 [&_svg]:size-5 group-data-[fullscreen]/player:size-12',
        wide: 'h-11 min-w-11 px-1 group-data-[fullscreen]/player:h-12',
        hero: [
          'brand-gradient size-16 text-white shadow-[var(--shadow-glow)] ring-4 ring-brand-300/25 sm:size-[4.5rem]',
          'hover:scale-105 hover:bg-transparent hover:text-white hover:ring-brand-300/45 focus-visible:ring-4 focus-visible:ring-player-fg/80',
          '[&_svg]:size-7 @max-[24rem]/player:size-12 @max-[24rem]/player:[&_svg]:size-5',
        ],
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

const MORPH =
  'absolute grid place-items-center transition-[opacity,transform] duration-200 ease-[var(--ease-out-expo)]';

/** Play or pause, in the bar: the two glyphs morph into each other (a turn and a scale), never a hard swap. */
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
      <span
        aria-hidden="true"
        className={cn(MORPH, paused ? 'scale-100 opacity-100' : '-rotate-90 scale-50 opacity-0')}
      >
        <PlayIcon size={20} className="translate-x-px" />
      </span>
      <span aria-hidden="true" className={cn(MORPH, paused ? 'rotate-90 scale-50 opacity-0' : 'scale-100 opacity-100')}>
        <PauseIcon size={20} />
      </span>
    </PlayerButton>
  );
}

/**
 * The big centre button over the poster and a paused film: the surface's one call to action, in the brand gradient
 * with its glow, and a soft halo breathing around it on the poster (still under reduced motion).
 */
export function PlayerCenterButton({ label, onToggle }: { label: string; onToggle: () => void }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
      <span aria-hidden="true" className="player-halo absolute size-16 rounded-full sm:size-[4.5rem]" />
      <PlayerButton size="hero" label={label} onClick={onToggle} className="pointer-events-auto" data-player-center="">
        <PlayIcon size={28} className="translate-x-0.5" />
      </PlayerButton>
    </div>
  );
}

/**
 * "0:42 / 6:12" in the mono of the app's slates and tabular figures; in fullscreen the playhead's time grows into the
 * display face, like a cinema timecode. The seek slider speaks the position, so this is for the eye only.
 */
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
        'flex items-baseline gap-1 whitespace-nowrap px-2 font-mono text-xs font-medium tabular-nums tracking-[0.04em] text-player-fg transition-opacity duration-200',
        duration === 0 && 'opacity-0',
        className
      )}
    >
      <span className="group-data-[fullscreen]/player:font-display group-data-[fullscreen]/player:text-2xl group-data-[fullscreen]/player:font-semibold group-data-[fullscreen]/player:tracking-normal">
        {formatClock(current)}
      </span>
      <span className="text-player-fg/55">/ {formatClock(duration)}</span>
    </span>
  );
}

/**
 * The volume slider: a Radix slider beside the speaker button, where the bar has room (a hovering pointer and a wide
 * frame; a phone's volume is its own buttons). Its fill is the brand gradient; it reads 0 while muted and speaks a
 * percentage.
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
      <SliderPrimitive.Track className="relative h-1 grow overflow-hidden rounded-full bg-brand-300/20">
        <SliderPrimitive.Range className="brand-gradient absolute h-full" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        aria-label={t('volume')}
        aria-valuetext={`${Math.round(level * 100)}%`}
        className="block size-3 rounded-full border-2 border-secondary-400 bg-player-fg transition-transform duration-150 group-hover/vol:scale-110 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-400/60"
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

/** Captions on or off: a pressed toggle, lit lavender while on. */
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

const ROLL: Record<'up' | 'down' | 'none', string> = {
  up: 'animate-[player-roll-up_0.28s_var(--ease-out-expo)]',
  down: 'animate-[player-roll-down_0.28s_var(--ease-out-expo)]',
  none: '',
};

/** The speed chip: the current speed on a lavender chip, its figure rolling up or down as the speed changes. */
function RateChip({ rate }: { rate: number }) {
  const [shown, setShown] = useState({ rate, roll: 'none' as 'up' | 'down' | 'none' });

  if (shown.rate !== rate) setShown({ rate, roll: rateRoll(shown.rate, rate) });

  return (
    <span className="grid h-7 min-w-11 place-items-center overflow-hidden rounded-full bg-brand-500/25 px-2 font-mono text-xs font-semibold tabular-nums text-brand-100 ring-1 ring-inset ring-brand-300/40 group-data-[fullscreen]/player:h-8">
      <span key={rate} className={cn('block', ROLL[shown.roll])}>
        {formatRate(rate)}
      </span>
    </span>
  );
}

/** The speed menu: its chip reads the current speed; the menu lists the six, the current one checked. */
export function PlayerRateMenu({
  rate,
  onRate,
  container,
  onOpenChange,
}: MenuProps & { rate: number; onRate: (rate: number) => void }) {
  const { t } = useTranslation('player');

  return (
    <DropdownMenu.Root modal={false} onOpenChange={onOpenChange}>
      <DropdownMenu.Trigger asChild>
        <PlayerButton
          size="wide"
          label={t('speedValue', { rate: formatRate(rate) })}
          data-player-rate=""
          className="hover:bg-transparent"
        >
          <RateChip rate={rate} />
        </PlayerButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal container={container ?? undefined}>
        <DropdownMenu.Content side="top" align="end" sideOffset={8} collisionPadding={8} className={MENU_CONTENT}>
          <DropdownMenu.Label className="px-3 pb-1 pt-2 text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-brand-300">
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

/** A glass capsule for a cluster of controls, like the header's pills over the footage. */
const CAPSULE =
  'flex items-center rounded-full bg-player-ink/45 p-0.5 ring-1 ring-player-fg/12 backdrop-blur-md shadow-[var(--shadow-md)]';

/**
 * The control bar's layout: the seek bar on top, then the transport capsule on the left (`start`) and the rest on the
 * right (`end`), on the player's scrim. It is a named group, so several players on one page stay tell-apart.
 */
export function PlayerBar({
  label,
  seek,
  start,
  end,
  className,
  onHoverChange,
}: {
  label: string;
  seek?: ReactNode;
  start: ReactNode;
  end: ReactNode;
  className?: string;
  /** A mouse rests on the bar, or left it: the controls stay up meanwhile. */
  onHoverChange?: (hovering: boolean) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn('player-bar flex flex-col gap-1 px-2.5 pb-2', className)}
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse') onHoverChange?.(true);
      }}
      onPointerLeave={() => onHoverChange?.(false)}
    >
      {seek && <div className="px-1.5">{seek}</div>}
      <div className="flex items-center justify-between gap-1.5">
        <div className={cn(CAPSULE, 'min-w-0')}>{start}</div>
        <div className={cn(CAPSULE, 'shrink-0')}>{end}</div>
      </div>
    </div>
  );
}
