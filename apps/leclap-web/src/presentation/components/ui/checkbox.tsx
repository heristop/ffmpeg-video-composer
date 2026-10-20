import * as React from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { cn } from '@/lib/utils';

// The box every checkbox in the app draws, shared with list rows that carry their own checkbox role
// (the music track list) so a tick looks the same wherever it appears. A solid lavender fill, not the
// brand gradient: the gradient is for brand moments, and a control should read as state. brand-600 keeps
// the white glyph above 3:1 on both themes. The pseudo-element widens the hit area to ~44px without
// growing the box.
export const checkboxBoxClass = cn(
  'relative grid size-5 shrink-0 place-items-center rounded-[0.3125rem] border-[1.5px] border-foreground/30 bg-surface-inset text-white',
  'transition-[background-color,border-color] duration-150 ease-[var(--ease-smooth)]',
  "before:absolute before:-inset-2.5 before:content-['']",
  'data-[state=checked]:border-brand-600 data-[state=checked]:bg-brand-600',
  'data-[state=indeterminate]:border-brand-600 data-[state=indeterminate]:bg-brand-600'
);

// Hover and disabled belong to the interactive root only; a decorative mark inside a row takes its
// hover from the row.
const checkboxRootClass = cn(
  checkboxBoxClass,
  'peer hover:border-brand-400 data-[state=checked]:hover:bg-brand-500 data-[state=checked]:hover:border-brand-500',
  'disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:border-foreground/30'
);

// A tick that draws itself in once (stroke-dashoffset), and a dash for the mixed state. Static under
// reduced motion.
export function CheckGlyph({ state }: { state: 'checked' | 'indeterminate' }) {
  if (state === 'indeterminate') {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3.5">
        <path d="M4 8h8" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3.5">
      <path
        d="M3.5 8.5 6.5 11.5 12.5 4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="animate-check-draw motion-reduce:animate-none"
        pathLength={1}
      />
    </svg>
  );
}

// A non-interactive checkbox mark for rows whose own button carries role="checkbox".
export function CheckboxMark({ checked, className }: { checked: boolean; className?: string }) {
  return (
    <span aria-hidden="true" data-state={checked ? 'checked' : 'unchecked'} className={cn(checkboxBoxClass, className)}>
      {checked ? <CheckGlyph state="checked" /> : null}
    </span>
  );
}

const Checkbox = React.forwardRef<
  React.ComponentRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, checked, ...props }, ref) => (
  <CheckboxPrimitive.Root ref={ref} checked={checked} className={cn(checkboxRootClass, className)} {...props}>
    <CheckboxPrimitive.Indicator className="grid place-items-center text-current">
      <CheckGlyph state={checked === 'indeterminate' ? 'indeterminate' : 'checked'} />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
