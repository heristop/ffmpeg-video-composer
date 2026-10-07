// An accessible collapsible group used inside a section card to tuck away advanced controls
// (Effects, Audio, Camera guide). Collapsed by default; the header is a real <button> with
// aria-expanded / aria-controls and a chevron that rotates. Expansion animates via grid-template-rows
// (0fr → 1fr) — not height — and the revealed body fades in through FadeIn (the alpha apparition).
// While collapsed, a summary chip on the header tells the author what's configured without expanding.
import { useId, useState, type ReactNode } from 'react';
import { ChevronDownIcon } from '@/presentation/components/icons/chevron-down';
import { useIconHover } from '@/presentation/components/icons/useIconHover';
import { cn } from '@/lib/utils';
import { FadeIn } from './FadeIn';

interface SectionDisclosureProps {
  /** Short group title, e.g. "Effects". */
  label: string;
  /** Optional leading glyph. */
  icon?: ReactNode;
  /** At-a-glance state shown on the collapsed header ("Cinematic · Ken Burns" / "None"). */
  summary: string;
  children: ReactNode;
  /** Start expanded (e.g. when the group holds something the user must fill in first). */
  defaultOpen?: boolean;
  /** Controlled expansion, for a host that opens the group from elsewhere (pair with `onOpenChange`). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export const SectionDisclosure = ({
  label,
  icon,
  summary,
  children,
  defaultOpen = false,
  open: controlled,
  onOpenChange,
}: SectionDisclosureProps) => {
  const [uncontrolled, setUncontrolled] = useState(defaultOpen);
  const open = controlled ?? uncontrolled;
  const bodyId = useId();
  const { ref: chevronRef, hoverProps: chevronHoverProps } = useIconHover();

  return (
    <div className="rounded-xl border border-foreground/10 bg-surface">
      <button
        type="button"
        onClick={() => {
          setUncontrolled(!open);
          onOpenChange?.(!open);
        }}
        aria-expanded={open}
        aria-controls={bodyId}
        className="tap flex min-h-10 w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
        {...chevronHoverProps}
      >
        <ChevronDownIcon
          ref={chevronRef}
          aria-hidden
          size={16}
          className={cn(
            'shrink-0 text-gray-500 transition-transform duration-200 ease-[var(--ease-out-expo)]',
            open ? 'rotate-0' : '-rotate-90'
          )}
        />
        {icon}
        <span className="text-sm font-semibold text-foreground">{label}</span>
        {!open && (
          <span className="ml-auto max-w-[55%] shrink-0 truncate rounded-md bg-foreground/[0.06] px-2 py-0.5 text-[0.7rem] font-medium text-gray-500 dark:text-gray-400">
            {summary}
          </span>
        )}
      </button>
      <div
        id={bodyId}
        className={cn(
          'grid transition-[grid-template-rows] duration-200 ease-[var(--ease-out-expo)] motion-reduce:transition-none',
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        )}
      >
        <div className="overflow-hidden">
          {open && <FadeIn className="space-y-3 px-3 pb-3 pt-1">{children}</FadeIn>}
        </div>
      </div>
    </div>
  );
};
