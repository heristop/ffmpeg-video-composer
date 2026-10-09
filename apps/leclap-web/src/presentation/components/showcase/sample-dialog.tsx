import { useRef, useState, type CSSProperties } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/presentation/components/ui/dialog';
import { ShowcasePlayer } from './ShowcasePlayer';
import { SampleFacts } from './sample-facts';
import { SHAPE_RATIO, sampleShape, type ShowcaseSample } from './catalog';
import { tileSelector } from './sample-dialog.logic';

type ScreenStyle = CSSProperties & { '--sample-ratio': number };

// A sample played in place, over the library: the page keeps its scroll, and the dialog keeps the sample's own
// shape, sized to fit the viewport (showcase.css). Its film starts at once, with the page's one sound (muted
// until the visitor turns it on), pauses the moment the dialog starts closing and unmounts once it has.
// Focus goes to the panel, so a screen reader starts at its title, and comes back to the sample's card.
export function SampleDialog({ sample, onClose }: { sample: ShowcaseSample | undefined; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  // The last sample shown stays on screen while the dialog plays its way out.
  const [shown, setShown] = useState(sample);

  if (sample && sample !== shown) setShown(sample);

  if (!shown) return null;

  const open = sample !== undefined;
  const style: ScreenStyle = { '--sample-ratio': SHAPE_RATIO[sampleShape(shown)] };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        ref={panelRef}
        overlayClassName="showcase-dialog-overlay bg-black/70"
        containerClassName="showcase-dialog-viewport"
        className="showcase-dialog my-auto w-auto max-w-none gap-0 self-start overflow-hidden p-0 grid-cols-[min-content] lg:grid-cols-[min-content_20rem] lg:grid-rows-[auto_minmax(0,1fr)]"
        style={style}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          panelRef.current?.focus({ preventScroll: true });
        }}
        onCloseAutoFocus={(event) => {
          const tile = document.querySelector<HTMLElement>(tileSelector(shown.id));

          if (!tile) return;

          event.preventDefault();
          tile.focus({ preventScroll: true });
        }}
      >
        <header className="px-4 pb-1 pr-14 pt-4 sm:px-5 lg:col-start-2 lg:row-start-1 lg:pt-5">
          <DialogTitle className="font-sans text-xl font-medium leading-snug sm:text-2xl">{shown.title}</DialogTitle>
        </header>
        <div className="p-3 sm:p-4 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <div className="showcase-dialog-screen mx-auto">
            <ShowcasePlayer key={shown.id} sample={shown} requested suspended={!open} still />
          </div>
        </div>
        <div className="flex flex-col gap-5 px-4 pb-5 pt-1 [contain:inline-size] sm:px-5 lg:col-start-2 lg:row-start-2 lg:min-h-0 lg:overflow-y-auto">
          <DialogDescription className="text-base leading-relaxed text-muted-foreground">
            {shown.description}
          </DialogDescription>
          <SampleFacts sample={shown} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
