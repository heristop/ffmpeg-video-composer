import { useTranslation } from 'react-i18next';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/presentation/components/ui';
import { ClappyReaction, ClappyRunner } from '@/presentation/components/clappy';
import { fraction } from './player.logic';
import type { MediaState } from './use-media-state';

// Loading and failure, in the app's own voice. A stall shows the render loader the studio uses: Clappy running his
// lane over the brand meter, the meter filling with what has buffered (after a beat, so a quick stall never
// flashes it). A failure shows Clappy calling "cut" over what went wrong, and a retry as the app's primary button.
// Mini frames keep the meter and the message, without Clappy. Reduced motion stands Clappy still.

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
        <ClappyRunner
          progress={loaded}
          size={56}
          followPointer={false}
          clapOnClick={false}
          className="@max-[22rem]/player:hidden"
        />
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
