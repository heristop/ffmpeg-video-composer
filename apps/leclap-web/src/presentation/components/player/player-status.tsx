import { useTranslation } from 'react-i18next';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/presentation/components/ui';
import { ClappyReaction } from '@/presentation/components/clappy';
import { LogoMark } from '@/presentation/components/LogoMark';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { fraction } from './player.logic';
import type { MediaState } from './use-media-state';

// Loading and failure, in the app's own voice. A stall shows the header's LeClap mark clapping once a beat over the
// brand meter, the meter filling with what has buffered (after a beat, so a quick stall never flashes it). A failure
// shows Clappy calling "cut" over what went wrong, and a retry as the app's primary button. Mini frames keep the
// meter and the message, without the mark or Clappy. Reduced motion holds the mark still.

export function PlayerStatus({
  media,
  labels,
  onRetry,
}: {
  media: MediaState;
  /** The surface's own wording, where it has one (a showcase sample's); the player's otherwise. */
  labels?: Partial<{ loading: string; error: string; retry: string }>;
  onRetry: () => void;
}) {
  const { t } = useTranslation('player');
  const reducedMotion = useReducedMotion();

  if (media.failed) {
    return (
      <div className="dark absolute inset-0 z-20 grid place-items-center bg-player-ink/80 p-4 backdrop-blur-sm">
        <div role="alert" className="flex max-w-xs flex-col items-center gap-3 text-center text-player-fg">
          <ClappyReaction reaction="cut" size={84} followPointer={false} className="@max-[22rem]/player:hidden" />
          <p className="text-sm font-medium leading-snug text-balance">{labels?.error ?? t('error')}</p>
          <Button size="sm" onClick={onRetry} className="min-h-11 rounded-full px-4 [&_svg]:size-4">
            <RotateCcw aria-hidden="true" />
            {labels?.retry ?? t('retry')}
          </Button>
        </div>
      </div>
    );
  }

  if (!media.waiting) return null;

  const loaded = Math.max(0.06, fraction(media.buffered, media.duration));

  return (
    <div role="status" className="player-delayed pointer-events-none absolute inset-0 z-10 grid place-items-center">
      <div className="flex w-56 flex-col gap-2 rounded-2xl bg-player-ink/70 px-7 pb-4 pt-3 ring-1 ring-player-fg/15 backdrop-blur-md @max-[22rem]/player:w-40 @max-[22rem]/player:px-4">
        <span data-player-loader="logo" className="mx-auto block @max-[22rem]/player:hidden">
          <LogoMark loop={!reducedMotion} className="size-12 [filter:drop-shadow(0_6px_14px_rgba(91,97,214,0.35))]" />
        </span>
        <span className="relative block h-1.5 overflow-hidden rounded-full bg-brand-300/20">
          <span
            className="brand-gradient absolute inset-y-0 left-0 rounded-full transition-[width] duration-300 ease-[var(--ease-out-expo)]"
            style={{ width: `${loaded * 100}%` }}
          />
          <span className="player-shimmer absolute inset-0" />
        </span>
        <span className="sr-only">{labels?.loading ?? t('loading')}</span>
      </div>
    </div>
  );
}
