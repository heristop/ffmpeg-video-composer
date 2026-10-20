import { useState, type CSSProperties, type ReactNode } from 'react';

interface PanelFrameProps {
  title: string;
  meta?: string;
  // Changing it replays the body's entrance; `travel` says which way: -1 from the left (an earlier scene),
  // 1 from the right (a later one), 0 a small settle (another tool).
  swapKey?: string;
  travel?: number;
  children: ReactNode;
}

// Which way the panel travels when the selected scene changes: -1 back, 1 forward, 0 unchanged.
export function usePanelTravel(index: number): number {
  const [last, setLast] = useState({ index, travel: 0 });

  if (last.index !== index) setLast({ index, travel: Math.sign(index - last.index) });

  return last.index === index ? last.travel : Math.sign(index - last.index);
}

// A panel shell: one title row (plus a quiet meta on the right) above a swap-animated body. The header
// is neutral chrome on the panel's 16px gutter, pinned (shrink-0) and compacted on short viewports so
// the scrollable body keeps its height; overscroll stays contained so panel scroll never chains.
export function PanelFrame({ title, meta, swapKey, travel = 0, children }: PanelFrameProps) {
  const enter = { '--swap-x': `${String(travel * 8)}px`, '--swap-y': travel === 0 ? '4px' : '0px' } as CSSProperties;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-baseline justify-between gap-3 border-b border-divider px-4 py-3 [@media(max-height:700px)]:py-2">
        <h2 className="min-w-0 truncate font-display text-base font-semibold text-foreground">{title}</h2>
        {meta ? <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{meta}</span> : null}
      </header>
      <div
        key={swapKey}
        style={enter}
        className="panel-swap min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 pb-6 [scrollbar-width:thin] motion-reduce:animate-none [@media(max-height:700px)]:p-3 [@media(max-height:700px)]:pb-5"
      >
        {children}
      </div>
    </div>
  );
}
