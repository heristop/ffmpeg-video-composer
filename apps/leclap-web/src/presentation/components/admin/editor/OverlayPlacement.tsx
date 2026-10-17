// Shared placement panel for a draggable overlay (animation or still image). Renders the drag/resize/rotate
// AnimationFrameCanvas with a switchable preview background, plus the canvas-free PlacementFields column
// (Position/Scale/Opacity/Rotation + reset). The preview-bg toggle state lives here. Playback-only controls
// (loop / keep-last-frame) stay with the animation caller — they don't apply to a still image. The
// PlacementFields column (and its PairField/AxisInput helpers) lives in placementFields so the canvas-less
// inspector reuses the exact same controls instead of carrying a copy.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { cn } from '@/lib/utils';
import type { Orientation } from '../templateEditorModel';
import { PREVIEW_BG_CLASS, type PreviewBg } from './animationOverlay';
import { AnimationFrameCanvas } from './AnimationFrameCanvas';
import { PlacementFields, type OverlayPlacementValue } from './placementFields';

export type { OverlayPlacementValue } from './placementFields';

interface OverlayPlacementProps {
  orientation: Orientation;
  /** Resolved, previewable URL for the canvas (animation file or resolved image source). */
  url: string;
  value: OverlayPlacementValue;
  onChange: (patch: OverlayPlacementValue) => void;
}

// Canvas + PlacementFields, with its own preview-bg toggle above the canvas.
export const OverlayPlacement = ({ orientation, url, value, onChange }: OverlayPlacementProps) => {
  const { t } = useTranslation('admin');
  const [previewBg, setPreviewBg] = useState<PreviewBg>('checker');

  return (
    <div>
      <div className="mb-1.5 flex justify-end">
        <PreviewBgToggle value={previewBg} onChange={setPreviewBg} t={t} />
      </div>

      <div className="flex flex-wrap items-start gap-3">
        <div>
          <AnimationFrameCanvas
            orientation={orientation}
            bg={previewBg}
            url={url}
            position={value.position}
            scale={value.scale}
            rotation={value.rotation}
            flip={value.flip}
            onChange={onChange}
          />
          <p className="mt-1 text-center text-[0.6rem] text-gray-400">{t('animation.dragHint')}</p>
        </div>

        <PlacementFields value={value} onChange={onChange} />
      </div>
    </div>
  );
};

// Three-way preview background switch (checker / dark / light) so transparent or white overlays stay
// readable on the canvas. Owned here because the placement panel owns the preview-bg state.
export const PreviewBgToggle = ({
  value,
  onChange,
  t,
}: {
  value: PreviewBg;
  onChange: (bg: PreviewBg) => void;
  t: TFunction<'admin'>;
}) => {
  const options: Array<{ key: PreviewBg; title: string }> = [
    { key: 'checker', title: t('animation.bgChecker') },
    { key: 'dark', title: t('animation.bgDark') },
    { key: 'light', title: t('animation.bgLight') },
  ];

  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label={t('animation.previewBg')}>
      {options.map(({ key, title }) => (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={value === key}
          aria-label={title}
          title={title}
          onClick={() => {
            onChange(key);
          }}
          className={cn(
            'size-5 rounded-full border transition-all hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
            PREVIEW_BG_CLASS[key],
            value === key ? 'border-brand-500 ring-1 ring-brand-500/40' : 'border-foreground/20'
          )}
        />
      ))}
    </div>
  );
};
