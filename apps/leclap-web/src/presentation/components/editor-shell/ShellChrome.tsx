import { useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLockBodyScroll } from '@/hooks/useLockBodyScroll';
import { MobileResizeHandle } from './MobileResizeHandle';
import { useMobileSplit } from './useMobileSplit';
import { MobileViewTabs, type ShellView, type ViewTab } from './MobileViewTabs';

interface ShellChromeProps {
  titlebar: ReactNode;
  dock: ReactNode;
  panel: ReactNode;
  monitor: ReactNode;
  timeline: ReactNode;
  resizeLabel: string;
  /**
   * Stacked-layout surface tabs, `[panel, monitor]`. Supplying them swaps the draggable divider for
   * a tab switch on phones — each surface then gets the full height instead of a cropped share.
   */
  viewTabs?: [ViewTab, ViewTab];
  viewTabsLabel?: string;
  /**
   * Changes to this value mean "the user just asked to edit something" (they picked a tool or a
   * scene), so the phone returns to the panel. Without it a dock tap would silently rearrange a
   * surface the user cannot currently see.
   */
  panelFocusKey?: string;
}

// The studio/editor app frame: a full-viewport portal sitting BELOW the global LeClap header
// (fixed, ~4rem, z-50) so the site header stays visible and on top. Locks body scroll while open.
export const ShellChrome = ({
  titlebar,
  dock,
  panel,
  monitor,
  timeline,
  resizeLabel,
  viewTabs,
  viewTabsLabel,
  panelFocusKey,
}: ShellChromeProps) => {
  useLockBodyScroll();
  const { containerRef, monitorHeight, beginResize, resizeBy } = useMobileSplit();
  // Opens on the panel: the monitor has nothing to show until the template has some content in it.
  const [viewState, setViewState] = useState(() => ({ panelFocusKey, view: 'panel' as ShellView }));

  if (viewState.panelFocusKey !== panelFocusKey) setViewState({ panelFocusKey, view: 'panel' });
  const view = viewState.panelFocusKey === panelFocusKey ? viewState.view : 'panel';
  const setView = (next: ShellView): void => {
    setViewState({ panelFocusKey, view: next });
  };

  const tabbed = viewTabs !== undefined;
  const onMonitor = tabbed && view === 'monitor';
  // Untabbed shells keep the draggable split, so the monitor is a fixed slice of the stack; tabbed
  // ones give the selected surface everything that is left.
  const monitorStacked = tabbed
    ? `min-h-0 flex-1 animate-surface-in-right motion-reduce:animate-none ${onMonitor ? 'block' : 'hidden'}`
    : 'h-[var(--monitor-h)] min-h-0 shrink-0';

  return createPortal(
    <>
      {/* Dark fill behind the fixed header so backdrop-blur picks up the dark surface,
        matching studio and template-list pages (z-[29] < z-30 < z-50 header). */}
      <div className="dark fixed inset-x-0 top-0 z-[29] h-16 bg-background" />
      <div className="dark fixed inset-x-0 bottom-0 top-16 z-30 flex flex-col bg-background text-foreground">
        {titlebar}
        {viewTabs && (
          <MobileViewTabs tabs={viewTabs} active={view} onSelect={setView} ariaLabel={viewTabsLabel ?? resizeLabel} />
        )}
        {/* One grid holds all regions. Stacked (flex-col): monitor → resize divider → panel →
          timeline → dock (the dock is a bottom tab bar, order-last). The monitor's height is the
          draggable split (`--monitor-h`); `desk:h-auto` resets it for the grid tiers, where the
          timeline spans the full second row below dock·panel·monitor. The switch is `desk`, not
          `md` — it needs viewport HEIGHT as well as width, or a landscape phone lands on the grid
          with no room for it. The first desk tier gets an icon-only dock rail and a narrower panel
          so the monitor keeps priority; the panel widens again at lg/xl. */}
        <div
          ref={containerRef}
          className="flex min-h-0 flex-1 flex-col desk:grid desk:grid-cols-[3.75rem_19rem_minmax(0,1fr)] desk:grid-rows-[minmax(0,1fr)_auto] lg:grid-cols-[5rem_22rem_minmax(0,1fr)] xl:grid-cols-[5rem_24rem_minmax(0,1fr)]"
        >
          {dock}
          <section
            className={`order-3 min-h-0 flex-1 flex-col overflow-hidden border-foreground/10 bg-surface desk:order-none desk:flex desk:animate-none desk:border-r ${
              tabbed ? 'animate-surface-in-left motion-reduce:animate-none' : ''
            } ${onMonitor ? 'hidden' : 'flex'}`}
          >
            {panel}
          </section>
          <div
            className={`order-1 desk:order-none desk:block desk:h-auto desk:flex-none desk:shrink desk:animate-none ${monitorStacked}`}
            style={tabbed ? undefined : ({ '--monitor-h': monitorHeight } as CSSProperties)}
          >
            {monitor}
          </div>
          {!tabbed && <MobileResizeHandle onResize={beginResize} onNudge={resizeBy} label={resizeLabel} />}
          <footer className="track-lane order-4 flex items-stretch border-t border-foreground/10 desk:order-none desk:col-span-3">
            {timeline}
          </footer>
        </div>
      </div>
    </>,
    document.body
  );
};
