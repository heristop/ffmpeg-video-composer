import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useTranslation } from 'react-i18next';
import { X } from '@/presentation/components/icons';
import { cn } from '@/lib/utils';
import { useReturnFocus } from './use-return-focus';
import { useDragDismiss } from './use-drag-dismiss';

// shadcn-style Sheet over Radix Dialog: a panel docked to an edge of the viewport instead of centred.
// Same semantics as Dialog (role="dialog", aria-modal, focus trap, Escape, scroll lock, focus returned
// to the trigger); the page behind stays in view under a light scrim so the user keeps their context.
// `side="right"` is a full-height side panel; `side="bottom"` is a phone sheet with a drag handle.
// Slide in/out comes from `.sheet-panel` in index.css and falls back to a fade under reduced motion.

type SheetSide = 'right' | 'bottom';

// The Root's onOpenChange, so the bottom sheet's drag handle can dismiss it like Escape does.
const SheetCloseContext = React.createContext<(() => void) | null>(null);

interface SheetProps extends Omit<DialogPrimitive.DialogProps, 'onOpenChange'> {
  onOpenChange?: (open: boolean) => void;
}

const Sheet = ({ onOpenChange, ...props }: SheetProps) => (
  <SheetCloseContext
    value={() => {
      onOpenChange?.(false);
    }}
  >
    <DialogPrimitive.Root onOpenChange={onOpenChange} {...props} />
  </SheetCloseContext>
);

const SheetTrigger = DialogPrimitive.Trigger;
const SheetClose = DialogPrimitive.Close;

// The grab handle atop a bottom sheet: drag it down (or flick it) to dismiss. Pointer-only and hidden
// from assistive tech; the close button and Escape stay the accessible ways out.
const SheetHandle = () => {
  const close = React.use(SheetCloseContext);
  const drag = useDragDismiss(() => close?.());

  return (
    <div aria-hidden="true" className="flex h-6 shrink-0 cursor-grab touch-none justify-center pt-2.5" {...drag}>
      <span className="h-1.5 w-10 rounded-full bg-foreground/20" />
    </div>
  );
};

interface SheetContentProps extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  side?: SheetSide;
  // Selector for where focus goes on close when the element that opened the sheet is gone.
  returnFocusTo?: string;
}

const PANEL: Record<SheetSide, string> = {
  right: 'inset-y-0 right-0 h-dvh w-full border-l sm:max-w-[28rem]',
  bottom: 'inset-x-0 bottom-0 max-h-[calc(100dvh-2.5rem)] rounded-t-2xl border-t pb-[env(safe-area-inset-bottom)]',
};

const SheetContent = React.forwardRef<React.ComponentRef<typeof DialogPrimitive.Content>, SheetContentProps>(
  ({ side = 'right', className, children, onCloseAutoFocus, returnFocusTo, ...props }, ref) => {
    const { t } = useTranslation('common');
    const returnFocus = useReturnFocus(onCloseAutoFocus, returnFocusTo);

    return (
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="sheet-overlay fixed inset-0 z-[58] bg-black/30 dark:bg-black/45" />
        <DialogPrimitive.Content
          ref={ref}
          data-side={side}
          onCloseAutoFocus={returnFocus}
          className={cn(
            'dark sheet-panel fixed z-[59] flex flex-col border-divider bg-surface shadow-[var(--shadow-lg)] focus:outline-none',
            PANEL[side],
            className
          )}
          {...props}
        >
          {side === 'bottom' && <SheetHandle />}
          {children}
          {/* Above the content's pinned header (z-10), which would otherwise take the clicks. */}
          <DialogPrimitive.Close
            aria-label={t('actions.close')}
            className={cn(
              "tap cursor-pointer absolute right-3 z-20 grid h-10 w-10 place-items-center rounded-full text-gray-400 transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 before:absolute before:-inset-1.5 before:content-['']",
              side === 'bottom' ? 'top-5' : 'top-3'
            )}
          >
            <X className="h-5 w-5" />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    );
  }
);
SheetContent.displayName = 'SheetContent';

const SheetTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('font-display text-2xl font-bold text-foreground', className)}
    {...props}
  />
));
SheetTitle.displayName = DialogPrimitive.Title.displayName;

const SheetDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn('text-sm text-gray-400', className)} {...props} />
));
SheetDescription.displayName = DialogPrimitive.Description.displayName;

export { Sheet, SheetTrigger, SheetClose, SheetContent, SheetTitle, SheetDescription, type SheetSide };
