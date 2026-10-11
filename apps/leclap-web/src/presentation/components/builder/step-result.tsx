import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExportPanel } from '@/presentation/components/ExportPanel';
import { VideoPreview } from '@/presentation/components/VideoPreview';
import { ClappyCheer } from '@/presentation/components/clappy';
import { ArrowLeftIcon } from '@/presentation/components/icons/arrow-left';
import { ArrowRightIcon } from '@/presentation/components/icons/arrow-right';
import { useIconHover } from '@/presentation/components/icons/useIconHover';
import { Button } from '@/presentation/components/ui';
import { cn } from '@/lib/utils';
import { withViewTransition } from '@/lib/viewTransition';
import type { ProcessedVideo } from '@/hooks/useVideoProcessing';
import type { Orientation } from './editorPanels';
import { downloadName } from './download-name';

interface StepResultProps {
  processedVideo: ProcessedVideo;
  // The project title: names the saved file and the share sheet.
  title: string;
  // The template's frame, so the player is shaped like the video before its metadata arrives.
  orientation: Orientation;
  onBack: () => void;
  onReset: () => void;
}

// The player box, shaped like the render and as large as the viewport allows: the width is capped by
// the available height (`--result-h`) times the aspect, so a portrait video is never pillar-boxed in a
// wide black frame nor pushes Download below the fold. Phones leave room above for the heading and
// below for Download; from `lg` the actions sit in the side rail, so the video takes the full height.
const FRAME: Record<Orientation, string> = {
  landscape: 'aspect-video w-[min(100%,calc(var(--result-h)*16/9))]',
  portrait: 'aspect-[9/16] w-[min(100%,calc(var(--result-h)*9/16))]',
  square: 'aspect-square w-[min(100%,var(--result-h))]',
};

// The builder's last screen, laid out like the render monitor it replaces — the stage on the left now
// plays what it rendered, the rail on the right holds what to do with it: Download first, then the two
// ways on (back into the same edit, or a new video). On phones it stacks heading → video → actions; a
// phone held sideways (`short`) has the width for the rail and none of the height to stack, so it gets
// the side-by-side layout too.
export const StepResult = ({ processedVideo, title, orientation, onBack, onReset }: StepResultProps) => {
  const { t } = useTranslation('builder');
  const [frame, setFrame] = useState<{ width: number; height: number } | null>(null);
  const { ref: backRef, hoverProps: backHoverProps } = useIconHover();
  const { ref: resetRef, hoverProps: resetHoverProps } = useIconHover();

  return (
    <div className="fade-in grid gap-5 short:grid-cols-[minmax(0,1fr)_15rem] short:grid-rows-[auto_1fr] short:gap-x-5 short:gap-y-3 lg:grid-cols-[minmax(0,1fr)_18rem] lg:grid-rows-[auto_1fr] lg:gap-x-6 lg:gap-y-6">
      <header className="flex items-center gap-4 short:col-start-2 short:row-start-1 short:gap-3 lg:col-start-2 lg:row-start-1 lg:flex-col lg:items-start lg:gap-3">
        {/* A finished render gets its clap: Clappy slams the clapper, with the clack when the sound is on. */}
        <ClappyCheer size={72} className="shrink-0" />
        <div className="min-w-0">
          <h2 className="font-display text-3xl font-bold leading-tight text-foreground text-balance short:text-2xl sm:text-4xl">
            {t('stepResult.title')}
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground short:hidden">
            {t('stepResult.subtitle')}
          </p>
        </div>
      </header>

      <section
        aria-label={title}
        className="studio-stage grid place-items-center overflow-hidden rounded-2xl border border-foreground/10 p-3 [--result-h:52dvh] sm:p-6 short:col-start-1 short:row-span-2 short:row-start-1 short:p-2 short:[--result-h:calc(100dvh-8rem)] lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:[--result-h:calc(100dvh-16rem)]"
      >
        <div className={cn('max-h-full', FRAME[orientation])}>
          <VideoPreview
            url={processedVideo.url}
            fill
            label={null}
            title={title}
            onMetadata={({ width, height }) => {
              if (width > 0 && height > 0) setFrame({ width, height });
            }}
          />
        </div>
      </section>

      <div className="space-y-5 short:col-start-2 short:row-start-2 short:space-y-3 lg:col-start-2 lg:row-start-2">
        <ExportPanel
          processedVideo={processedVideo}
          fileName={downloadName(title, new Date())}
          title={title}
          frame={frame}
        />
        <div className="flex items-center justify-between gap-2 border-t border-foreground/10 pt-4">
          <Button variant="ghost" size="sm" onClick={onBack} className="-ml-3 [&_svg]:size-4" {...backHoverProps}>
            <ArrowLeftIcon ref={backRef} size={16} />
            {t('stepResult.editProject')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              withViewTransition(onReset);
            }}
            className="-mr-3 [&_svg]:size-4"
            {...resetHoverProps}
          >
            {t('stepResult.createAnother')}
            <ArrowRightIcon ref={resetRef} size={16} />
          </Button>
        </div>
      </div>
    </div>
  );
};
