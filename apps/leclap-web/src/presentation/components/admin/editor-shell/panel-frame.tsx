import type { ReactNode } from 'react';

// A panel shell: one title row (plus a quiet meta on the right) above a swap-animated body. The header
// is neutral chrome on the panel's 16px gutter, pinned (shrink-0) and compacted on short viewports so
// the scrollable body keeps its height; overscroll stays contained so panel scroll never chains.
export const PanelFrame = ({ title, meta, children }: { title: string; meta?: string; children: ReactNode }) => (
  <div className="flex min-h-0 flex-1 flex-col">
    <header className="flex shrink-0 items-baseline justify-between gap-3 border-b border-divider px-4 py-3 [@media(max-height:700px)]:py-2">
      <h2 className="min-w-0 truncate font-display text-base font-semibold text-foreground">{title}</h2>
      {meta ? <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{meta}</span> : null}
    </header>
    <div className="panel-swap min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 pb-6 [scrollbar-width:thin] motion-reduce:animate-none [@media(max-height:700px)]:p-3 [@media(max-height:700px)]:pb-5">
      {children}
    </div>
  </div>
);
