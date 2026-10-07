// The Generate-with-AI drawer's frame: a sheet docked to the right edge on wide screens (the builder
// stays in view beside it) and to the bottom on phones, with a pinned header (title, subtitle, close),
// a body that is the only thing that scrolls, and a pinned footer for the run's status and primary
// action. The body scrolls inside the sheet (never the page or the sheet itself), so its scrollbar
// sits between the two bars and a focused field can never hide under the footer. A hairline and a
// soft shadow appear on a bar only while content is scrolled under it. ⌘/Ctrl+Enter runs `onSubmit`.
import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useMediaQuery } from '@/hooks/use-media-query';
import { Sheet, SheetContent, SheetDescription, SheetTitle, type SheetSide } from '@/presentation/components/ui';

interface AiDialogFrameProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle: string;
  footer: ReactNode;
  children: ReactNode;
  // The keyboard shortcut's action (⌘/Ctrl+Enter), or undefined while it has nothing to do.
  onSubmit?: () => void;
}

type Edges = { top: boolean; bottom: boolean };

const noop = (): void => {};

// Wide enough for a ~30rem side panel with the builder still readable beside it.
const SIDE_PANEL_QUERY = '(min-width: 40rem)';

// Whether content is hidden above / below the scroll body, kept current on scroll and resize.
function useScrollEdges(): [Edges, (node: HTMLDivElement | null) => void] {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [under, setUnder] = useState({ top: false, bottom: false });

  useEffect(() => {
    if (!node) return noop;

    const measure = (): void => {
      const top = node.scrollTop > 1;
      const bottom = node.scrollTop + node.clientHeight < node.scrollHeight - 1;
      setUnder((prev) => (prev.top === top && prev.bottom === bottom ? prev : { top, bottom }));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(node);

    for (const child of node.children) observer.observe(child);

    node.addEventListener('scroll', measure, { passive: true });
    measure();

    return () => {
      observer.disconnect();
      node.removeEventListener('scroll', measure);
    };
  }, [node]);

  return [under, setNode];
}

function isSubmitShortcut(event: KeyboardEvent): boolean {
  return event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing;
}

const BAR = 'relative z-10 shrink-0 border-transparent transition-[border-color,box-shadow] duration-200';

export const AiDialogFrame = ({ open, onClose, title, subtitle, footer, children, onSubmit }: AiDialogFrameProps) => {
  const [under, trackScroll] = useScrollEdges();

  const side: SheetSide = useMediaQuery(SIDE_PANEL_QUERY) ? 'right' : 'bottom';

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent
        side={side}
        // Opened from the starter presets (gone by close), focus lands on the titlebar button instead.
        returnFocusTo="[data-ai-trigger]"
        className="overflow-hidden"
        onKeyDown={(event) => {
          if (!isSubmitShortcut(event) || !onSubmit) return;

          event.preventDefault();
          onSubmit();
        }}
      >
        <header
          className={cn(
            BAR,
            'grid gap-1 border-b px-5 pb-4 sm:px-6',
            side === 'bottom' ? 'pt-2' : 'pt-5 sm:pt-6',
            under.top && 'border-divider shadow-[0_6px_12px_-10px_oklch(0_0_0/0.6)]'
          )}
        >
          <SheetTitle className="pr-10 text-xl leading-tight tracking-tight sm:text-2xl">{title}</SheetTitle>
          <SheetDescription className="max-w-[60ch] pr-6 text-[0.8125rem] leading-snug text-pretty text-muted-foreground">
            {subtitle}
          </SheetDescription>
        </header>
        <div
          ref={trackScroll}
          data-ai-scroll=""
          className="ai-scroll-body @container min-h-0 flex-1 overflow-y-auto overscroll-contain py-5 pl-5 pr-2.5 sm:pl-6 sm:pr-4"
        >
          {children}
        </div>
        <div
          className={cn(
            BAR,
            'border-t bg-surface px-5 py-4 sm:px-6',
            under.bottom && 'border-divider shadow-[0_-6px_12px_-10px_oklch(0_0_0/0.6)]'
          )}
        >
          {footer}
        </div>
      </SheetContent>
    </Sheet>
  );
};
