// Manage a list of animation FILES (clips played as-is): each picked from the stock files (or uploaded, or
// by URL) and dragged/resized on the preview. Reuses AnimationGallery for the per-overlay pick + placement
// (one row each) and adds a trailing gallery to append more. The image counterpart is ImageOverlayField;
// both share the same add / remove / drag-resize shape. It hosts the whole-video overlays, which cannot
// hold section graphics, so it only ever shows the "Animation files" side of the picker (engine effects
// and their recipes are picked per scene, from the element inspector).
import { useTranslation } from 'react-i18next';
import type { AnimationAsset } from '@/data/mediaCatalog';
import { makeTemplateId, type AnimationOverlay, type Orientation } from '../templateEditorModel';
import { AnimationGallery } from './AnimationGallery';
import { OverlayLayer } from './OverlayLayer';

interface AnimationOverlayFieldProps {
  value: AnimationOverlay[] | undefined;
  orientation: Orientation;
  onChange: (value: AnimationOverlay[] | undefined) => void;
  /** Override the dynamic library with a curated list (config-driven). */
  library?: AnimationAsset[];
}

export const AnimationOverlayField = ({ value, orientation, onChange, library }: AnimationOverlayFieldProps) => {
  const { t } = useTranslation('admin');
  const animations = value ?? [];

  const replaceAt = (index: number, next: AnimationOverlay) => {
    onChange(animations.map((animation, i) => (i === index ? next : animation)));
  };

  const removeAt = (index: number) => {
    const next = animations.filter((_, i) => i !== index);

    onChange(next.length > 0 ? next : undefined);
  };

  const add = (animation: AnimationOverlay) => {
    onChange([...animations, { ...animation, id: makeTemplateId() }]);
  };

  return (
    <div>
      {animations.map((animation, index) => (
        <OverlayLayer
          key={animation.id ?? `animation-${index}`}
          index={index}
          label={t('animationOverlay.label')}
          removeLabel={t('animationOverlay.remove')}
          onRemove={() => {
            removeAt(index);
          }}
        >
          <AnimationGallery
            value={animation}
            orientation={orientation}
            library={library}
            onChange={(next) => {
              if (!next) {
                removeAt(index);

                return;
              }

              replaceAt(index, { ...next, id: animation.id });
            }}
          />
        </OverlayLayer>
      ))}
      <div className={animations.length > 0 ? 'mt-4 space-y-1.5 border-t border-foreground/10 pt-4' : 'space-y-1.5'}>
        <span className="block text-xs font-semibold uppercase tracking-widest text-gray-400">
          {t('animationOverlay.add')}
        </span>
        <AnimationGallery
          value={undefined}
          orientation={orientation}
          library={library}
          onChange={(next) => {
            if (next) add(next);
          }}
        />
      </div>
    </div>
  );
};
