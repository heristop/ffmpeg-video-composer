import { type ReactNode } from 'react';

interface ProgramMonitorProps {
  children: ReactNode;
  label: string;
  note?: string;
  meta?: string;
  swapKey?: string;
  /** Optional transport bar (play/scrub) docked between the stage and the status strip. */
  transport?: ReactNode;
  /** Optional monitor switches (e.g. safe areas) on the status strip, before the meta. */
  controls?: ReactNode;
}

// The program-monitor stage: the preview floats on a recessed, vignetted workspace (`studio-stage`)
// framed like a video deck — corner registration brackets, a REC tally dot on the status strip and a
// lavender→pink program-out scrubber along the bottom edge, echoing the kinetic ProgramMonitor. When
// a transport is passed it sits flush under the stage's gradient edge, above the status strip.
export const ProgramMonitor = ({ children, label, note, meta, swapKey, transport, controls }: ProgramMonitorProps) => (
  <div className="flex h-full min-h-0 flex-col">
    <div className="studio-stage relative min-h-0 flex-1">
      <div key={swapKey} className="monitor-swap h-full motion-reduce:animate-none">
        {children}
      </div>

      {/* Corner registration brackets — the deck-monitor framing of the kinetic vocabulary. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-3 size-4 rounded-tl-md border-l-2 border-t-2 border-brand-400/50"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-3 size-4 rounded-tr-md border-r-2 border-t-2 border-brand-400/50"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-3 left-3 size-4 rounded-bl-md border-b-2 border-l-2 border-brand-400/50"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-3 right-3 size-4 rounded-br-md border-b-2 border-r-2 border-brand-400/50"
      />

      {/* Program-out scrubber — the signature gradient pinned to the stage's out edge. */}
      <span aria-hidden="true" className="brand-gradient pointer-events-none absolute inset-x-0 bottom-0 h-[3px]" />
    </div>
    {transport}
    <div className="flex shrink-0 items-center justify-between gap-3 border-t border-foreground/10 bg-surface-2/40 px-4 py-1.5 text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
      <span className="flex min-w-0 items-center gap-1.5">
        <span
          aria-hidden="true"
          className="size-1.5 shrink-0 animate-pulse rounded-full bg-[var(--color-error)] motion-reduce:animate-none"
        />
        <span className="truncate">
          {label}
          {note ? ` · ${note}` : ''}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-3">
        {controls}
        {meta ? <span className="tabular-nums">{meta}</span> : null}
      </span>
    </div>
  </div>
);
