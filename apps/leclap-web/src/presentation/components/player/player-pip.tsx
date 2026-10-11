import { useTranslation } from 'react-i18next';
import { PictureInPicture, PictureInPicture2 } from 'lucide-react';
import { PlayerButton } from './player-controls';
import type { PlayerPip } from './use-pip';

// Picture-in-Picture: the control, and what the local frame shows while the video floats in its own window.

/** Opens or closes the floating window; lit lavender while the video floats in it. Hidden where there is no API. */
export function PlayerPipButton({ pip }: { pip: PlayerPip }) {
  const { t } = useTranslation('player');

  if (!pip.available) return null;

  return (
    <PlayerButton
      label={pip.active ? t('exitPip') : t('pip')}
      aria-pressed={pip.active}
      onClick={pip.toggle}
      data-player-pip=""
      className="aria-pressed:bg-brand-500/30 aria-pressed:text-brand-50"
    >
      {pip.active ? <PictureInPicture aria-hidden="true" /> : <PictureInPicture2 aria-hidden="true" />}
    </PlayerButton>
  );
}

/** While the video floats in its window: the frame says so, over the player's ink, in the brand's voice. */
export function PlayerPipCover() {
  const { t } = useTranslation('player');

  return (
    <div className="pointer-events-none absolute inset-0 z-[8] grid place-items-center bg-player-ink/90 p-4 text-center">
      <div className="flex flex-col items-center gap-2 text-player-fg">
        <span className="grid size-14 place-items-center rounded-full bg-brand-500/25 text-brand-100 ring-1 ring-brand-300/40 [&_svg]:size-7">
          <PictureInPicture2 aria-hidden="true" />
        </span>
        <p role="status" className="font-display text-lg font-semibold uppercase tracking-[0.02em]">
          {t('pipActive')}
        </p>
        <p className="max-w-[28ch] text-xs text-player-fg/70 @max-[22rem]/player:hidden">{t('pipActiveHint')}</p>
      </div>
    </div>
  );
}
