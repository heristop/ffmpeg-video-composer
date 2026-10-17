import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { GradientMeter } from './gradient-meter';

type MonitorAspect = 'portrait' | 'landscape' | 'square' | number;

const ASPECT_RATIO: Record<'portrait' | 'landscape' | 'square', number> = {
  portrait: 9 / 16,
  landscape: 16 / 9,
  square: 1,
};

// Resolve the aspect prop to a numeric ratio, or undefined to frame the child at its natural size.
const resolveAspect = (aspect: MonitorAspect | undefined): number | undefined => {
  if (aspect === undefined) return undefined;

  if (typeof aspect === 'number') return aspect;

  return ASPECT_RATIO[aspect];
};

export interface ProgramMonitorProps {
  children: ReactNode;
  /** Force an aspect ratio; omit to frame the child at its natural size. */
  aspect?: MonitorAspect;
  /** Tally chip label; pass null to hide. */
  label?: string | null;
  showBrackets?: boolean;
  /** 0..1 → renders a playhead scrubber along the bottom. */
  progress?: number;
  /** Dark render-theater surface instead of the light default. */
  dark?: boolean;
  /** Drift a faint CRT scanline over the preview so it reads as a live video surface (opt-in). */
  scanline?: boolean;
  className?: string;
}

// A faint drifting raster over the framed preview — the ambient "live video" cue. The raster layer
// extends one tile above its clipped wrapper and translates down (compositor-only, no per-frame
// repaint); the global reduced-motion reset settles it to a static grille.
const SCANLINE_STYLE = {
  backgroundImage:
    'repeating-linear-gradient(to bottom, oklch(0 0 0 / 0.05) 0, oklch(0 0 0 / 0.05) 1px, transparent 1px, transparent 4px)',
  backgroundSize: '100% 4px',
} as const;

const Scanline = () => (
  <span
    aria-hidden="true"
    className="pointer-events-none absolute inset-0 z-[1] overflow-hidden opacity-60 mix-blend-multiply"
  >
    <span className="animate-scanline absolute inset-x-0 -top-1 bottom-0" style={SCANLINE_STYLE} />
  </span>
);

// The corner registration brackets and the PROGRAM tally chip (with a pulsing "recording" dot).
const TallyChip = ({ label, dark }: { label: string; dark: boolean }) => (
  <span
    className={cn(
      'absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-white backdrop-blur-sm',
      dark ? 'bg-black/55' : 'bg-foreground/55'
    )}
  >
    <span className="size-1.5 animate-pulse rounded-full bg-[var(--color-error)] motion-reduce:animate-none" />
    {label}
  </span>
);

const Brackets = ({ dark }: { dark: boolean }) => {
  const bracket = dark ? 'border-white/50' : 'border-brand-500/60';

  return (
    <>
      <span className={cn('absolute left-2.5 top-2.5 size-4 rounded-tl-md border-l-2 border-t-2', bracket)} />
      <span className={cn('absolute right-2.5 top-2.5 size-4 rounded-tr-md border-r-2 border-t-2', bracket)} />
      <span className={cn('absolute bottom-2.5 left-2.5 size-4 rounded-bl-md border-b-2 border-l-2', bracket)} />
      <span className={cn('absolute bottom-2.5 right-2.5 size-4 rounded-br-md border-b-2 border-r-2', bracket)} />
    </>
  );
};

// Frames a preview like a video deck's program monitor: a hairline frame, corner registration
// brackets, an optional PROGRAM tally chip and (when `progress` is given) a playhead scrubber. Light
// by default; `dark` switches to the render-theater stage.
export function ProgramMonitor({
  children,
  aspect,
  label = 'PROGRAM',
  showBrackets = true,
  progress,
  dark = false,
  scanline = false,
  className,
}: ProgramMonitorProps) {
  const ratio = resolveAspect(aspect);
  const frame = dark ? 'border-white/15' : 'border-foreground/10';

  return (
    <div
      className={cn('relative overflow-hidden rounded-2xl border', frame, dark && 'bg-black', className)}
      style={ratio ? { aspectRatio: ratio } : undefined}
    >
      <div className="h-full">{children}</div>

      <MonitorOverlays scanline={scanline} showBrackets={showBrackets} label={label} dark={dark} progress={progress} />
    </div>
  );
}

function MonitorOverlays({
  scanline = false,
  showBrackets = false,
  label,
  dark = false,
  progress,
}: Pick<ProgramMonitorProps, 'scanline' | 'showBrackets' | 'label' | 'dark' | 'progress'>) {
  return (
    <>
      {scanline && <Scanline />}
      {showBrackets && <Brackets dark={dark} />}
      {label && <TallyChip label={label} dark={dark} />}
      {progress === undefined ? null : (
        <div className="absolute inset-x-3.5 bottom-3.5">
          <GradientMeter progress={progress} variant="playhead" size={4} />
        </div>
      )}
    </>
  );
}

export default ProgramMonitor;
