import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, type PanInfo } from 'motion/react';
import clsx from 'clsx';

// Past this drag distance (px) or downward velocity (px/s) on release, the sheet dismisses;
// below it, the sheet springs back to its open position.
const CLOSE_OFFSET = 90;
const CLOSE_VELOCITY = 480;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Visible, tabbable descendants of the panel — the ring the focus trap cycles through.
const focusablesOf = (panel: HTMLElement | null): HTMLElement[] => {
  if (!panel) return [];

  return [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((node) => node.offsetParent !== null);
};

type BottomSheetProps = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Responsive class hiding the whole sheet above its breakpoint, e.g. "sm:hidden" or "md:hidden". */
  hideClassName?: string;
  /** Extra classes for the sheet panel (spacing, etc.). */
  panelClassName?: string;
  role?: 'dialog' | 'menu';
  ariaLabel?: string;
  id?: string;
};

/**
 * Mobile bottom sheet: a scrim plus a panel that springs up from the bottom edge and can be
 * flicked or dragged down to dismiss (grab handle included). Closes on scrim tap too. Desktop
 * variants of a control should render separately and hide this with `hideClassName`.
 *
 * Focus is trapped while open (the header menu / language picker): on open the first focusable in the
 * panel takes focus, Tab / Shift+Tab wrap within it, Escape closes, and focus returns to whatever was
 * focused before it opened (the trigger).
 */
export const BottomSheet = ({
  open,
  onClose,
  children,
  hideClassName,
  panelClassName,
  role = 'dialog',
  ariaLabel,
  id,
}: BottomSheetProps) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  // Portal to <body> so the fixed scrim/panel escape any ancestor containing block — the header's
  // scrolled `backdrop-blur` would otherwise anchor `position: fixed` to the header, not the viewport,
  // pinning the sheet under the header instead of covering the screen from the bottom. Mount-gated for
  // SSR/prerender (no `document` on the server).
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setMounted(true);
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!open) return () => {};

    // Remember the trigger, then move focus into the panel (first focusable, else the panel itself).
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    const first = focusablesOf(panelRef.current).at(0);
    (first ?? panelRef.current)?.focus();

    return () => {
      returnFocusRef.current?.focus();
    };
  }, [open]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();

      return;
    }

    if (e.key !== 'Tab') return;

    const focusables = focusablesOf(panelRef.current);
    const first = focusables.at(0);
    const last = focusables.at(-1);

    if (!first || !last) {
      e.preventDefault();

      return;
    }

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();

      return;
    }

    if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className={hideClassName}>
          <motion.div
            aria-hidden="true"
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          />
          <motion.div
            ref={panelRef}
            id={id}
            role={role}
            aria-label={ariaLabel}
            aria-modal="true"
            tabIndex={-1}
            onKeyDown={onKeyDown}
            className={clsx(
              'fixed inset-x-0 bottom-0 z-50 touch-none rounded-t-2xl border border-foreground/10 bg-surface/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[var(--shadow-lg)] backdrop-blur-xl focus:outline-none',
              panelClassName
            )}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 32, stiffness: 320 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.55 }}
            onDragEnd={(_event, info: PanInfo) => {
              if (info.offset.y > CLOSE_OFFSET || info.velocity.y > CLOSE_VELOCITY) {
                onClose();
              }
            }}
          >
            {/* Grab handle — drag target and sheet affordance. */}
            <div
              aria-hidden="true"
              className="mx-auto mb-2 h-1.5 w-10 cursor-grab rounded-full bg-foreground/20 active:cursor-grabbing"
            />
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
};
