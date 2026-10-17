import { useEffect, useId, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronDownIcon } from '@/presentation/components/icons/chevron-down';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { cn } from '@/lib/utils';
import { DocNavList, NAV_LABEL } from './doc-nav-list';
import { docPageAt } from './doc-nav.logic';
import { docNav } from './docNav';
import { TocList } from './doc-toc';
import type { TocItem } from './use-doc-toc';

interface DocMobileBarProps {
  items: readonly TocItem[];
  activeId: string | null;
}

const MobileBarSection = ({ section }: { section: TocItem | undefined }) =>
  section ? (
    <>
      <span aria-hidden="true" className="text-gray-600">
        /
      </span>
      <span className={cn('min-w-0 truncate text-gray-400', section.code && 'font-mono text-[0.8rem]')}>
        {section.label}
      </span>
    </>
  ) : null;

const MobileBarPanel = ({
  open,
  reduced,
  panelId,
  items,
  activeId,
  close,
}: {
  open: boolean;
  reduced: boolean;
  panelId: string;
  items: readonly TocItem[];
  activeId: string | null;
  close: () => void;
}) =>
  open ? (
    <motion.div
      key="panel"
      id={panelId}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, y: -4 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      className="absolute inset-x-0 top-full max-h-[calc(100dvh-10rem)] overflow-y-auto overscroll-contain border-b border-divider bg-surface px-4 pb-6 pt-5 shadow-[var(--shadow-lg)]"
    >
      {items.length > 1 ? (
        <nav aria-labelledby={`${panelId}-toc`} className="mb-7">
          <p id={`${panelId}-toc`} className={cn(NAV_LABEL, 'mb-2.5')}>
            On this page
          </p>
          <TocList items={items} activeId={activeId} roomy onNavigate={close} />
        </nav>
      ) : null}
      <nav aria-label="Documentation" className="lg:hidden">
        <DocNavList roomy onNavigate={close} />
      </nav>
    </motion.div>
  ) : null;

// Below `lg` the docs navigation is a bar pinned under the site header: the page you are on and the
// section you are reading, one tap from every page and every section. It replaces a sideways-scrolling
// chip rail that scrolled away with the page and could park the current chip off-screen. Between `lg`
// and `xl` — a laptop too narrow for the "On this page" rail — it stays for the outline alone, since
// the sidebar already lists the pages.
//
// `top` tucks it a hair under the header's scrolled height (a steady 3.67–3.69rem at every width, since
// the header is rem-sized), so the two meet without a sliver of page showing between them. The
// toggle's negative scroll margin is for keyboard focus: pinned at 3.6rem it sits inside html's 5rem
// scroll-padding, so tabbing onto it made the browser "reveal" it by scrolling the page 22px. It is
// keyed by route in DocLayout, so a page change always arrives with the menu closed.
export const DocMobileBar = ({ items, activeId }: DocMobileBarProps) => {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const reduced = useReducedMotion();
  const page = docPageAt(docNav, pathname);
  const section = items.find((item) => item.id === activeId);

  // A disclosure, not a modal: the page stays scrollable underneath, Escape or any tap outside
  // closes it, and Escape hands focus back to the toggle it came from.
  useEffect(() => {
    if (!open) return () => {};

    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;

      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;

      setOpen(false);
      toggleRef.current?.focus();
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
  };

  return (
    <div
      ref={rootRef}
      className={cn(
        'sticky top-[3.625rem] z-30 -mx-4 mb-8 border-b border-divider bg-background/85 backdrop-blur-md',
        // From `lg` the sidebar carries the pages, so the bar stays only while there is an outline to
        // offer and no rail to show it: up to `xl`.
        items.length > 1 ? 'xl:hidden' : 'lg:hidden'
      )}
    >
      <button
        ref={toggleRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setOpen((value) => !value);
        }}
        className="flex min-h-12 w-full touch-manipulation items-center gap-2 px-4 text-left text-sm [scroll-margin-top:-1.5rem] transition-colors active:bg-foreground/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/50"
      >
        <span className="sr-only">Documentation menu: </span>
        <span className="shrink-0 font-medium text-foreground">{page?.label ?? 'Documentation'}</span>
        <MobileBarSection section={section} />
        <ChevronDownIcon
          size={16}
          aria-hidden="true"
          className={cn(
            'ml-auto shrink-0 text-gray-400 transition-transform duration-200 ease-[var(--ease-out-expo)]',
            open && 'rotate-180'
          )}
        />
      </button>

      <AnimatePresence>
        <MobileBarPanel
          open={open}
          reduced={reduced}
          panelId={panelId}
          items={items}
          activeId={activeId}
          close={close}
        />
      </AnimatePresence>
    </div>
  );
};
