// The left inspector's per-kind dispatcher: given the section + the single shared selection, render the
// right SETTINGS control for the selected element (text / background layer / image / animation / engine
// effect) by reusing the existing extracted controls. Array surgery for layer move/remove reuses
// sectionElements. Picking an engine primitive in an animation's library swaps that animation for the
// primitive (a `graphics[]` entry drafted for this section) and selects it, which opens its parameter panel.
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { Graphic } from 'ffmpeg-video-composer/src/schemas/graphics.schemas.ts';
import {
  draftGraphic,
  type AnimationEffectPreset,
  type EditorSection,
  type EngineLibraryEntry,
  type TextOverlay,
  type BackgroundLayer,
  type ImageOverlay,
  type AnimationOverlay,
  type Orientation,
} from '../templateEditorModel';
import { FxParamPanel } from '../editor/FxParamPanel';
import { Button } from '@/presentation/components/ui';
import { SelectedControls } from './overlayControls';
import { LayerRow } from '../editor/LayerRow';
import { PlacementControls } from './placementControls';
import { CaptionField } from '../editor/SectionFields/CaptionField';
import { TitleCardField } from '../editor/SectionFields/TitleCardField';
import { LowerThirdField } from '../editor/SectionFields/LowerThirdField';
import { EDITOR_INPUT_CLASS } from '../editor/editorStyles';
import { removeElement, reorderElement, type SugarKind } from './sectionElements';
import type { AnimationPickMode } from '../editor/animationSource';
import { sugarToOverlays } from './sugarToOverlays';
import type { ElementRef } from './useSectionSelection';

interface ElementInspectorProps {
  section: EditorSection;
  activeRef: ElementRef | null;
  variables: string[];
  orientation: Orientation;
  /** global.theme (the theme colours an effect's colour tokens resolve to). */
  theme?: unknown;
  /** Mixed into a fresh effect's seed (the section's index), so placements in different sections differ. */
  salt?: number;
  onPatchSection: (patch: Partial<EditorSection>) => void;
  onSelectElement: (ref: ElementRef | null) => void;
  /** The picker side a freshly added animation slot opens on (the add menu's "Effect" vs "Animation file"). */
  slotMode?: { index: number; mode: AnimationPickMode } | null;
}

// Immutable single-index patch shared by every array-backed kind.
function patchAt<T>(arr: T[], index: number, patch: Partial<T>): T[] {
  return arr.map((item, i) => (i === index ? { ...item, ...patch } : item));
}

// Read a section's element array for a kind without `any`. The kind guards in the dispatcher ensure the
// element actually has the requested shape, so a localized cast at the read site is safe.
function readArray<T>(section: EditorSection, field: string): T[] {
  const value = (section as Record<string, unknown>)[field];

  if (!Array.isArray(value)) return [];

  return value as T[];
}

// Indexed access that honestly returns `T | undefined`, so the out-of-range guard at each call site is
// a real check the type-checker respects (the tsconfig does not enable noUncheckedIndexedAccess).
function elementAt<T>(arr: T[], index: number): T | undefined {
  return index >= 0 && index < arr.length ? arr[index] : undefined;
}

export const ElementInspector = ({
  section,
  activeRef,
  variables,
  orientation,
  theme,
  salt,
  onPatchSection,
  onSelectElement,
  slotMode,
}: ElementInspectorProps) => {
  const { t } = useTranslation('admin');

  if (!activeRef) return <Hint label={t('element.selectHint')} />;

  if (activeRef.kind === 'effect') {
    return (
      <EffectSettings
        section={section}
        activeRef={activeRef}
        theme={theme}
        t={t}
        onPatchSection={onPatchSection}
        onSelectElement={onSelectElement}
      />
    );
  }

  if (activeRef.kind === 'text') {
    return (
      <TextSettings
        section={section}
        activeRef={activeRef}
        variables={variables}
        t={t}
        onPatchSection={onPatchSection}
        onSelectElement={onSelectElement}
      />
    );
  }

  if (activeRef.kind === 'layer') {
    return (
      <LayerSettings
        section={section}
        activeRef={activeRef}
        t={t}
        onPatchSection={onPatchSection}
        onSelectElement={onSelectElement}
      />
    );
  }

  if (activeRef.kind === 'image') {
    return (
      <ImageSettings
        section={section}
        activeRef={activeRef}
        orientation={orientation}
        t={t}
        onPatchSection={onPatchSection}
      />
    );
  }

  if (activeRef.kind === 'caption' || activeRef.kind === 'titleCard' || activeRef.kind === 'lowerThird') {
    return (
      <SugarSettings
        kind={activeRef.kind}
        section={section}
        variables={variables}
        orientation={orientation}
        t={t}
        onPatchSection={onPatchSection}
        onSelectElement={onSelectElement}
      />
    );
  }

  return (
    <AnimationSettings
      // Keyed by index so each animation keeps its own picker state (side, tab) instead of inheriting it.
      key={activeRef.index}
      initialMode={slotMode?.index === activeRef.index ? slotMode.mode : undefined}
      section={section}
      activeRef={activeRef}
      orientation={orientation}
      salt={salt}
      t={t}
      onPatchSection={onPatchSection}
      onSelectElement={onSelectElement}
    />
  );
};

interface SugarSettingsProps {
  kind: 'caption' | 'titleCard' | 'lowerThird';
  section: EditorSection;
  variables: string[];
  orientation: Orientation;
  t: TFunction<'admin'>;
  onPatchSection: (patch: Partial<EditorSection>) => void;
  onSelectElement: (ref: ElementRef | null) => void;
}

// The text-sugar singletons (caption / titleCard / lowerThird) reuse the scene-field editors, so
// clicking the sugar on the canvas edits the exact same model the Scenes panel edits. Each branch
// guards on the section kind that can carry the sugar (see the editor model). Below each editor,
// "Detach into text elements" converts the block into regular overlays (sugarToOverlays).
const SugarSettings = ({
  kind,
  section,
  variables,
  orientation,
  t,
  onPatchSection,
  onSelectElement,
}: SugarSettingsProps) => {
  const detachSugar = (sugarKind: SugarKind, sugar: Parameters<typeof sugarToOverlays>[1]) => {
    const converted = sugarToOverlays(sugarKind, sugar, orientation);

    if (converted.length === 0) return;

    const overlays = readArray<TextOverlay>(section, 'overlays');

    onPatchSection({ [sugarKind]: undefined, overlays: [...overlays, ...converted] });
    onSelectElement({ kind: 'text', index: overlays.length });
  };

  if (kind === 'caption') {
    if (section.kind !== 'video' && section.kind !== 'color' && section.kind !== 'image') {
      return <Hint label={t('element.selectHint')} />;
    }

    return (
      <Card>
        <CaptionField
          caption={section.caption}
          onChange={(caption) => {
            onPatchSection({ caption });
          }}
          inputCls={EDITOR_INPUT_CLASS}
        />
        <DetachSugar
          t={t}
          onDetach={() => {
            detachSugar('caption', section.caption);
          }}
        />
      </Card>
    );
  }

  if (kind === 'titleCard') {
    if (section.kind !== 'color') return <Hint label={t('element.selectHint')} />;

    return (
      <Card>
        <TitleCardField
          titleCard={section.titleCard}
          onChange={(titleCard) => {
            onPatchSection({ titleCard });
          }}
          variables={variables}
          inputCls={EDITOR_INPUT_CLASS}
        />
        <DetachSugar
          t={t}
          onDetach={() => {
            detachSugar('titleCard', section.titleCard);
          }}
        />
      </Card>
    );
  }

  if (section.kind !== 'video') return <Hint label={t('element.selectHint')} />;

  return (
    <Card>
      <LowerThirdField
        lowerThird={section.lowerThird}
        onChange={(lowerThird) => {
          onPatchSection({ lowerThird });
        }}
        variables={variables}
        inputCls={EDITOR_INPUT_CLASS}
      />
      <DetachSugar
        t={t}
        onDetach={() => {
          detachSugar('lowerThird', section.lowerThird);
        }}
      />
    </Card>
  );
};

interface TextSettingsProps {
  section: EditorSection;
  activeRef: ElementRef;
  variables: string[];
  t: TFunction<'admin'>;
  onPatchSection: (patch: Partial<EditorSection>) => void;
  onSelectElement: (ref: ElementRef | null) => void;
}

const TextSettings = ({ section, activeRef, variables, t, onPatchSection, onSelectElement }: TextSettingsProps) => {
  const overlays = readArray<TextOverlay>(section, 'overlays');
  const overlay = elementAt(overlays, activeRef.index);

  if (!overlay) return <Hint label={t('element.selectHint')} />;

  return (
    <Card>
      <SelectedControls
        overlay={overlay}
        t={t}
        variables={variables}
        onPatch={(patch) => {
          onPatchSection({ overlays: patchAt(overlays, activeRef.index, patch) });
        }}
        onInsertVariable={(name) => {
          const text = `${overlay.text}{{ ${name} }}`;
          onPatchSection({ overlays: patchAt(overlays, activeRef.index, { text }) });
        }}
        onDelete={() => {
          onSelectElement(null);
          onPatchSection(removeElement(section, activeRef));
        }}
      />
    </Card>
  );
};

interface LayerSettingsProps {
  section: EditorSection;
  activeRef: ElementRef;
  t: TFunction<'admin'>;
  onPatchSection: (patch: Partial<EditorSection>) => void;
  onSelectElement: (ref: ElementRef | null) => void;
}

const LayerSettings = ({ section, activeRef, t, onPatchSection, onSelectElement }: LayerSettingsProps) => {
  const layers = readArray<BackgroundLayer>(section, 'layers');
  const layer = elementAt(layers, activeRef.index);

  if (!layer) return <Hint label={t('element.selectHint')} />;

  return (
    <LayerRow
      layer={layer}
      index={activeRef.index}
      isBase={activeRef.index === 0}
      canMoveUp={activeRef.index > 0}
      canMoveDown={activeRef.index < layers.length - 1}
      onPatch={(patch) => {
        onPatchSection({ layers: patchAt(layers, activeRef.index, patch) });
      }}
      onMove={(delta) => {
        onPatchSection(reorderElement(section, activeRef, delta));
      }}
      onRemove={() => {
        onSelectElement(null);
        onPatchSection(removeElement(section, activeRef));
      }}
    />
  );
};

interface PlacementSettingsProps {
  section: EditorSection;
  activeRef: ElementRef;
  orientation: Orientation;
  t: TFunction<'admin'>;
  onPatchSection: (patch: Partial<EditorSection>) => void;
}

const ImageSettings = ({ section, activeRef, orientation, t, onPatchSection }: PlacementSettingsProps) => {
  const images = readArray<ImageOverlay>(section, 'images');
  const image = elementAt(images, activeRef.index);

  if (!image) return <Hint label={t('element.selectHint')} />;

  return (
    <Card>
      <PlacementControls
        kind="image"
        orientation={orientation}
        value={image}
        onChange={(patch) => {
          onPatchSection({ images: patchAt(images, activeRef.index, patch) });
        }}
      />
    </Card>
  );
};

interface AnimationSettingsProps extends PlacementSettingsProps {
  salt?: number;
  initialMode?: AnimationPickMode;
  onSelectElement: (ref: ElementRef | null) => void;
}

// The animation element's settings: its library (engine primitives + samples) and, for a sample, its
// placement and playback. An engine pick replaces this overlay with the drafted graphic(s) and selects the
// first one, so its parameter panel opens in place.
const AnimationSettings = ({
  section,
  activeRef,
  orientation,
  salt,
  initialMode,
  t,
  onPatchSection,
  onSelectElement,
}: AnimationSettingsProps) => {
  const animations = readArray<AnimationOverlay>(section, 'animations');
  const animation = elementAt(animations, activeRef.index);

  if (!animation) return <Hint label={t('element.selectHint')} />;

  const replaceWith = (build: (context: { section: EditorSection }) => Graphic[]) => {
    const remaining = animations.filter((_, index) => index !== activeRef.index);
    const base = { ...section, animations: remaining } as EditorSection;
    const graphics = readArray<Graphic>(section, 'graphics');
    const added = build({ section: base });

    onPatchSection({ animations: remaining.length > 0 ? remaining : undefined, graphics: [...graphics, ...added] });
    onSelectElement({ kind: 'effect', index: graphics.length });
  };

  return (
    <Card>
      <PlacementControls
        kind="animation"
        orientation={orientation}
        value={animation}
        initialMode={initialMode}
        onChange={(patch) => {
          onPatchSection({ animations: patchAt(animations, activeRef.index, patch) });
        }}
        onPickEngine={(entry: EngineLibraryEntry) => {
          replaceWith(({ section: base }) => [draftGraphic(entry, { section: base, orientation, salt })]);
        }}
        onPickRecipe={(preset: AnimationEffectPreset) => {
          replaceWith(({ section: base }) => preset.build({ section: base, orientation, salt }));
        }}
      />
    </Card>
  );
};

interface EffectSettingsProps {
  section: EditorSection;
  activeRef: ElementRef;
  theme?: unknown;
  t: TFunction<'admin'>;
  onPatchSection: (patch: Partial<EditorSection>) => void;
  onSelectElement: (ref: ElementRef | null) => void;
}

// An engine effect (section.graphics[i]): its generated parameter panel.
const EffectSettings = ({ section, activeRef, theme, t, onPatchSection, onSelectElement }: EffectSettingsProps) => {
  const graphics = readArray<Graphic>(section, 'graphics');
  const graphic = elementAt(graphics, activeRef.index);

  if (!graphic) return <Hint label={t('element.selectHint')} />;

  return (
    <Card>
      <FxParamPanel
        graphic={graphic}
        section={section}
        theme={theme}
        onChange={(next) => {
          onPatchSection({ graphics: graphics.map((item, index) => (index === activeRef.index ? next : item)) });
        }}
        onRemove={() => {
          onSelectElement(null);
          onPatchSection(removeElement(section, activeRef));
        }}
      />
    </Card>
  );
};

// The muted "select an element" placeholder — the same dashed affordance as ElementList's empty
// state, so every "nothing here yet, act on the list above" moment reads as one visual family.
const Hint = ({ label }: { label: string }) => (
  <p className="rounded-lg border border-dashed border-foreground/15 px-3 py-2.5 text-center text-xs text-gray-500 dark:text-gray-400">
    {label}
  </p>
);

// The inspector card — the same surface OverlayInspector draws around SelectedControls, so every
// per-element settings block reads as one consistent panel under the element list. The layer kind
// skips it (LayerRow already renders its own card).
const Card = ({ children }: { children: ReactNode }) => (
  <div className="space-y-3 rounded-xl border border-foreground/10 bg-surface-2/50 p-3">{children}</div>
);

// "Detach into text elements": the escape hatch from structural sugar to free overlays. Secondary
// styling + an explicit trade-off hint, since the conversion drops the block's automatic layout
// (and its band/accent-bar decorations).
const DetachSugar = ({ t, onDetach }: { t: TFunction<'admin'>; onDetach: () => void }) => (
  <div className="space-y-1.5 border-t border-foreground/10 pt-3">
    <Button type="button" variant="secondary" size="sm" onClick={onDetach}>
      {t('element.detach')}
    </Button>
    <p className="text-xs text-gray-500 dark:text-gray-400">{t('element.detachHint')}</p>
  </div>
);
