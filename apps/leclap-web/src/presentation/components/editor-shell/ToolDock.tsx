import React, { useRef, useState, type ComponentType, type KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';
import { arrowTarget } from '@/presentation/components/builder/rovingKeys';
import { useIconHover, type AnimatedIconHandle } from '@/presentation/components/icons/useIconHover';
import { PressableScale } from '@/presentation/components/kinetic';

const RAIL_SLOT = 4.5; // rem — fixed slot height so the indicator can slide deterministically

export interface ToolItem<Id extends string = string> {
  id: Id;
  icon: ComponentType<{ className?: string }>;
  label: string;
}

interface ToolDockProps<Id extends string> {
  items: ToolItem<Id>[];
  active: Id;
  onSelect: (id: Id) => void;
  ariaLabel: string;
}

interface DockButtonProps {
  icon: ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
  tabIndex: number;
  onSelect: () => void;
  buttonRef: (el: HTMLButtonElement | null) => void;
  onKeyDown: (e: KeyboardEvent) => void;
}

const DockButton = ({ icon: Icon, label, active, tabIndex, onSelect, buttonRef, onKeyDown }: DockButtonProps) => {
  const { ref, hoverProps } = useIconHover();
  const AnimIcon = Icon as unknown as React.ForwardRefExoticComponent<
    { className?: string } & React.RefAttributes<AnimatedIconHandle>
  >;

  return (
    <PressableScale
      ref={buttonRef}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      aria-current={active}
      tabIndex={tabIndex}
      title={label}
      {...hoverProps}
      className={cn(
        'relative z-10 flex min-h-14 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-2 py-1 text-[0.65rem] font-medium transition-colors duration-200 short:min-h-10 short:gap-0.5',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 desk:h-[4.5rem] desk:min-h-0 desk:w-full desk:flex-none desk:py-0',
        active ? 'text-brand-600 dark:text-brand-300' : 'text-foreground/50 hover:text-foreground/80'
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'grid size-9 place-items-center rounded-xl transition-all duration-200 ease-[var(--ease-spring)]',
          active ? 'bg-brand-500/20 ring-1 ring-brand-500/40' : 'bg-foreground/[0.07]'
        )}
      >
        <AnimIcon className="size-[1.15rem]" ref={ref} />
      </span>
      {/* On the narrow rail tier the dock is icon-only: the label stays in the a11y tree (sr-only),
          and the title attribute gives sighted users the hover hint. It returns visually at lg, and
          it is always visible in the stacked bottom-bar layout. That "rail but not yet wide" tier is
          spelled as one stacked condition rather than an `lg:` override of a `desk:` rule — the two
          are separate media queries, so which won would come down to their order in the generated
          sheet, and `desk` being a custom variant is emitted after `lg`. */}
      <span className="desk:max-lg:sr-only">{label}</span>
    </PressableScale>
  );
};

// A tool dock as an ARIA toolbar: a brand-gradient indicator slides to the active tool on desktop;
// Tab reaches it, then arrow keys (either axis) move + activate with a roving tabindex. A bottom
// tab bar in the stacked layout (equal-width, ≥44px targets, safe-area padded), a vertical rail from
// `desk` up — icon-only until lg, icon + label from there. The active tool reads via the icon pill on
// the bar and the sliding indicator on the rail. Generic over the tool id type.
export const ToolDock = <Id extends string>({ items, active, onSelect, ariaLabel }: ToolDockProps<Id>) => {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const activeIndex = items.findIndex((item) => item.id === active);
  const [travel, setTravel] = useState(() => ({ activeIndex, goingDown: true }));

  if (travel.activeIndex !== activeIndex) {
    setTravel({ activeIndex, goingDown: activeIndex >= travel.activeIndex });
  }

  const goingDown = travel.activeIndex === activeIndex ? travel.goingDown : activeIndex >= travel.activeIndex;

  const move = (event: KeyboardEvent, from: number) => {
    const target = arrowTarget(event.key, from, items.length - 1);

    if (target < 0) return;

    event.preventDefault();
    onSelect(items[target].id);
    refs.current[target]?.focus();
  };

  return (
    <nav
      role="toolbar"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      className="relative order-last flex gap-1 border-t border-foreground/10 bg-surface-2 px-2 py-1.5 pb-[calc(0.375rem+env(safe-area-inset-bottom))] short:py-0.5 short:pb-[calc(0.125rem+env(safe-area-inset-bottom))] desk:order-none desk:flex-col desk:gap-0 desk:border-t-0 desk:border-r desk:px-2 desk:py-3 desk:pb-3"
    >
      {activeIndex >= 0 && (
        // Outer slot glides to the active tool (top-0 so the translateY's padding term isn't double-counted
        // against the static-flow baseline). The inner bar carries the visual + a magnetic stretch replayed
        // on each switch (keyed to the slot), leaning toward the travel direction so it looks pulled.
        <span
          aria-hidden="true"
          className="absolute top-0 left-0 hidden w-[3px] transition-transform duration-300 ease-[var(--ease-spring)] motion-reduce:transition-none desk:block"
          style={{
            height: `${RAIL_SLOT}rem`,
            transform: `translateY(calc(0.75rem + ${activeIndex} * ${RAIL_SLOT}rem))`,
          }}
        >
          <span
            key={activeIndex}
            className="brand-gradient block h-full w-full rounded-r-full will-change-transform motion-safe:animate-dock-stretch"
            style={{ transformOrigin: goingDown ? 'top' : 'bottom' }}
          />
        </span>
      )}
      {items.map((item, i) => (
        <DockButton
          key={item.id}
          icon={item.icon}
          label={item.label}
          active={item.id === active}
          tabIndex={item.id === active ? 0 : -1}
          buttonRef={(el) => {
            refs.current[i] = el;
          }}
          onKeyDown={(e) => {
            move(e, i);
          }}
          onSelect={() => {
            onSelect(item.id);
          }}
        />
      ))}
    </nav>
  );
};
