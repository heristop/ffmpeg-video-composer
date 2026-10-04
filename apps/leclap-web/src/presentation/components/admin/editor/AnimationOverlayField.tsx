// Manage a visual section's animated overlays: a list of animations, each picked from the bundled
// library (or uploaded) and dragged/resized on the preview. Reuses AnimationGallery for the per-overlay
// pick + placement (one row each) and adds a trailing gallery to append more. The image counterpart is
// ImageOverlayField; both share the same add / remove / drag-resize shape.
import { useTranslation } from 'react-i18next';
import type { AnimationAsset } from '@/data/mediaCatalog';
import {
  ANIMATION_EFFECT_PRESETS,
  makeTemplateId,
  type AnimationOverlay,
  type Orientation,
} from '../templateEditorModel';
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
      {library ? null : (
        <div className="mb-4 space-y-2">
          <span className="text-xs font-semibold text-foreground">{t('animation.effects.label')}</span>
          <div className="grid gap-2 sm:grid-cols-3">
            {ANIMATION_EFFECT_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => {
                  onChange([
                    ...animations,
                    ...preset.build(orientation).map((animation) => ({ ...animation, id: makeTemplateId() })),
                  ]);
                }}
                className="rounded-lg border border-border bg-surface-2 p-3 text-left hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="block text-sm font-semibold text-foreground">{t(preset.nameKey)}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{t(preset.descriptionKey)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
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
