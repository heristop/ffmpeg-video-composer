import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { VideoPlayer } from '@/presentation/components/player/video-player';

interface VideoPreviewProps {
  url: string;
  /** The clip's length when the caller knows it; the player reads it off the element either way. */
  duration?: number;
  // Recorded-clip review (the camera preview) wants the take to start playing on its own and loop;
  // the export/result players keep the default click-to-play. Muted lets autoplay through unblocked.
  autoPlay?: boolean;
  loop?: boolean;
  muted?: boolean;
  // Fill the parent box instead of sizing to the clip. The camera review stage is a fixed-height
  // area, and the default `max-h` cap leaves a portrait take pillar-boxed inside a much wider
  // player; filling lets `object-contain` use the whole stage instead.
  fill?: boolean;
  // The chip over the corner. Defaults to "Rendered video"; null drops it where that would be
  // untrue or redundant (a raw camera take, a result whose screen already names it).
  label?: string | null;
  // The title card's title on the poster and in fullscreen (the project's name); defaults to the chip's caption.
  title?: string;
  // The clip's facts once its metadata has loaded, for callers that list them.
  onMetadata?: (meta: { duration: number; width: number; height: number }) => void;
}

// Two sizing modes for the frame + the clip inside it: `fill` (fills whatever box the parent gives it — the camera
// review stage, the studio result's shaped box), and the default, which sizes to the clip under a cap. That cap is
// viewport-relative on phones so a portrait clip can't push the surrounding panel — modal title, download/next
// actions — off-screen; desktop keeps a fixed 24rem. Fullscreen is the player's own (video-player.tsx).
const frameClass = (fill: boolean): string =>
  fill ? 'flex h-full w-full items-center justify-center rounded-xl' : 'rounded-xl';

const clipClass = (fill: boolean): string =>
  fill ? 'h-full max-h-full w-full' : 'h-auto max-h-[45dvh] w-full sm:max-h-96';

// A render made here: the studio result, the onboarding's first video, a template's test render and a camera take.
// It plays in the LeClap player; being a local blob, it never offers the embed code.
export const VideoPreview = ({
  url,
  autoPlay = false,
  loop = false,
  muted = false,
  fill = false,
  label,
  title,
  onMetadata,
}: VideoPreviewProps) => {
  const { t } = useTranslation('process');
  const caption = label === undefined ? t('export.preview.label') : label;

  return (
    <VideoPlayer
      src={url}
      title={t('export.preview.videoAriaLabel')}
      autoPlay={autoPlay}
      loop={loop}
      muted={muted}
      label={caption ?? undefined}
      cardTitle={title ?? caption ?? undefined}
      onMetadata={onMetadata}
      className={cn('shadow-[var(--shadow-lg)] ring-1 ring-foreground/10', frameClass(fill))}
      videoClassName={clipClass(fill)}
    />
  );
};
