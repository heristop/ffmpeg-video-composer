import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from '@/presentation/components/icons';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useReturnFocus } from './use-return-focus';

// shadcn-style Dialog over Radix — focus-trap, ESC, scroll-lock and aria for free.
// On-brand: dimmed scrim + opaque surface panel (no bleed-through), brand-token styled.
const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn('fixed inset-0 z-[58] bg-black/40 backdrop-blur-md dark:bg-black/70', className)}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

interface DialogContentProps extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  // Above a sheet that is already open (a confirmation over a drawer): the scrim then dims the sheet too.
  raised?: boolean;
  // Extra classes for the scrim and for the centring layer around the panel (its padding, say).
  overlayClassName?: string;
  containerClassName?: string;
}

const DialogContent = React.forwardRef<React.ComponentRef<typeof DialogPrimitive.Content>, DialogContentProps>(
  ({ className, children, onCloseAutoFocus, raised = false, overlayClassName, containerClassName, ...props }, ref) => {
    const { t } = useTranslation('common');
    const returnFocus = useReturnFocus(onCloseAutoFocus);

    return (
      <DialogPortal>
        <DialogOverlay className={cn(raised && 'z-[60]', overlayClassName)} />
        {/* Grid-center the panel on whole pixels instead of `translate(-50%,-50%)`: a percentage translate
          lands the box on a half-pixel at some viewport widths / zoom / DPR, which blurs antialiased text.
          `pointer-events-none` lets outside clicks fall through to the overlay so Radix still closes. */}
        <div
          className={cn(
            'dark pointer-events-none fixed inset-0 grid place-items-center overflow-y-auto p-4',
            raised ? 'z-[61]' : 'z-[59]',
            containerClassName
          )}
        >
          <DialogPrimitive.Content
            ref={ref}
            onCloseAutoFocus={returnFocus}
            className={cn(
              'rise-in pointer-events-auto relative grid w-full max-w-lg gap-1 rounded-2xl border border-divider bg-surface p-6 shadow-[var(--shadow-lg)] focus:outline-none',
              className
            )}
            {...props}
          >
            {children}
            <DialogPrimitive.Close
              aria-label={t('actions.close')}
              className="tap cursor-pointer absolute right-3 top-3 grid h-10 w-10 place-items-center rounded-full text-gray-400 transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 before:absolute before:-inset-1.5 before:content-[''] before:cursor-pointer"
            >
              <X className="h-5 w-5" />
            </DialogPrimitive.Close>
          </DialogPrimitive.Content>
        </div>
      </DialogPortal>
    );
  }
);
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('mb-4 flex flex-col gap-1', className)} {...props} />
);

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />
);

const DialogTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('font-display text-2xl font-bold text-foreground', className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn('text-sm text-gray-400', className)} {...props} />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogClose,
  DialogOverlay,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
