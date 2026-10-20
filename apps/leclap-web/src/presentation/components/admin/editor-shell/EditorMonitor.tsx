import { useTranslation } from 'react-i18next';
import { SectionCanvas, type CanvasBackground } from './SectionCanvas';
import { useClipPreviewUrl } from './use-clip-preview-url';
import { PartialPreview } from './PartialPreview';
import { FRAME_STAGE_CLASS } from './frame-fit';
import { previewEnvOf, sectionGraphics, selectedEffect } from './fx-preview/preview-env';
import type { FxPreviewLayerProps } from './fx-preview/LazyFxPreview';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { resolveCanvasDrop, type DropPayload, type DropPoint } from './canvasDrop';
import { htmlPreviewEnv } from './html-layer/html-layer-env';
import type { ElementRef, SectionSelectionState } from './useSectionSelection';
import { newBaseLayer } from '../editor/layerGeometry';
import { findBackground, BACKGROUND_LIBRARY } from '@/data/mediaCatalog';
import { MusicStagePreview } from './music-stage-preview';
import { FormStagePreview } from './form-stage-preview';
import {
  collectVariables,
  type BackgroundLayer,
  type EditorSection,
  type EditorState,
  type TextOverlay,
} from '../templateEditorModel';

// The picture an image_background section will show: its first allowed background, else any bundled one.
const imageSectionUrl = (allowed: string[]): string | undefined =>
  findBackground(allowed.at(0) ?? '')?.url ?? BACKGROUND_LIBRARY.at(0)?.url;

// A color section's layer stack to edit on the canvas: its authored layers, or a single base layer
// synthesized from the picked colour when none have been added yet.
const colorLayers = (section: Extract<EditorSection, { kind: 'color' }>): BackgroundLayer[] =>
  section.layers && section.layers.length > 0 ? section.layers : [newBaseLayer(section.color)];

// Sections whose preview is the WYSIWYG overlay canvas (a real backdrop + draggable text overlays).
const hasOverlayCanvas = (
  section: EditorSection
): section is Extract<EditorSection, { kind: 'video' | 'color' | 'image' }> =>
  section.kind === 'video' || section.kind === 'color' || section.kind === 'image';

interface EditorMonitorProps {
  state: EditorState;
  section: EditorSection | null;
  onPatchSection: (partial: Partial<EditorSection>) => void;
  selection: SectionSelectionState;
  onSelectElement: (ref: ElementRef | null) => void;
  onBeginEdit: () => void;
  onEndEdit: () => void;
}

// A muted empty state, shown when no section is selected.
const EmptyState = ({ label }: { label: string }) => (
  <div className="grid h-full place-items-center p-6 text-center text-sm font-medium text-muted-foreground">
    {label}
  </div>
);

// The selected effect's live preview props, or undefined when no engine effect is selected.
const effectPreview = (
  state: EditorState,
  section: EditorSection,
  selection: SectionSelectionState,
  reduced: boolean
): FxPreviewLayerProps | undefined => {
  const only = selectedEffect(section, selection);

  return only === undefined
    ? undefined
    : { graphics: sectionGraphics(section), only, env: previewEnvOf(state, section, reduced) };
};

function EditorMonitorCanvas({
  state,
  section,
  selection,
  onPatchSection,
  onSelectElement,
  onBeginEdit,
  onEndEdit,
  clipPreviewUrl,
  reduced,
}: EditorMonitorProps & {
  clipPreviewUrl?: string;
  reduced: boolean;
  section: Extract<EditorSection, { kind: 'video' | 'color' | 'image' }>;
}) {
  const onCanvasDrop = (payload: DropPayload, point: DropPoint) => {
    const result = resolveCanvasDrop(section, selection, payload, point, state.orientation);

    if (!result) return;
    onPatchSection(result.patch);
    onSelectElement(result.selectRef);
  };

  const canvasBackground = (): CanvasBackground | undefined => {
    if (section.kind === 'image') return { imageUrl: imageSectionUrl(section.allowed) };

    if (section.kind === 'video' && clipPreviewUrl) return { videoUrl: clipPreviewUrl };

    return undefined;
  };

  return (
    <div className={`${FRAME_STAGE_CLASS} overflow-auto`}>
      <SectionCanvas
        overlays={section.overlays}
        orientation={state.orientation}
        background={canvasBackground()}
        backgroundFit={section.kind === 'color' ? undefined : section.fit}
        layers={
          section.kind === 'color'
            ? {
                items: colorLayers(section),
                onChange: (layers) => {
                  onPatchSection({ layers });
                },
              }
            : undefined
        }
        images={section.images}
        animations={section.animations}
        htmlLayers={section.htmlLayers}
        htmlEnv={htmlPreviewEnv(state)}
        look={section.look}
        grade={section.grade}
        globalLook={state.globalLook}
        globalGrade={state.globalGrade}
        caption={section.caption}
        titleCard={section.kind === 'color' ? section.titleCard : undefined}
        lowerThird={section.kind === 'video' ? section.lowerThird : undefined}
        onChangeCaption={(caption) => {
          onPatchSection({ caption });
        }}
        onChangeTitleCard={
          section.kind === 'color'
            ? (titleCard) => {
                onPatchSection({ titleCard });
              }
            : undefined
        }
        onChangeLowerThird={
          section.kind === 'video'
            ? (lowerThird) => {
                onPatchSection({ lowerThird });
              }
            : undefined
        }
        variables={collectVariables(state)}
        selection={selection}
        onSelectElement={onSelectElement}
        onBeginEdit={onBeginEdit}
        onEndEdit={onEndEdit}
        onChange={(overlays: TextOverlay[]) => {
          onPatchSection({ overlays });
        }}
        onChangeImages={(images) => {
          onPatchSection({ images });
        }}
        onChangeAnimations={(animations) => {
          onPatchSection({ animations });
        }}
        onChangeHtmlLayers={(htmlLayers) => {
          onPatchSection({ htmlLayers });
        }}
        onCanvasDrop={onCanvasDrop}
        fx={effectPreview(state, section, selection, reduced)}
      />
    </div>
  );
}

// The selected section's editable preview, rendered inside ProgramMonitor's children slot. A thin
// dispatcher: no section → empty state; visual sections → the centered WYSIWYG SectionCanvas (real
// backdrop + draggable text overlays) wired back through patchSection; other kinds → a labelled frame.
// The center canvas is now the ONLY draggable surface — its text styling controls live in the left
// OverlayInspector, sharing this `selection`.
export const EditorMonitor = ({
  state,
  section,
  onPatchSection,
  selection,
  onSelectElement,
  onBeginEdit,
  onEndEdit,
}: EditorMonitorProps) => {
  const { t } = useTranslation('admin');
  // Asset-backed video sections preview their fixed clip as the canvas backdrop (mirrors the render's
  // base layer); camera sections keep the neutral frame. Resolved before any early return (hooks rule).
  const clipPreviewUrl = useClipPreviewUrl(section?.kind === 'video' ? section.videoUrl : undefined);
  const reduced = useReducedMotion();

  if (!section) return <EmptyState label={t('shell.monitorEmpty')} />;

  if (section.kind === 'partial') return <PartialPreview section={section} />;

  if (section.kind === 'music') return <MusicStagePreview section={section} />;

  if (section.kind === 'form') return <FormStagePreview section={section} sections={state.sections} />;

  if (!hasOverlayCanvas(section)) return <EmptyState label={t('shell.monitorEmpty')} />;

  return (
    <EditorMonitorCanvas
      state={state}
      section={section}
      selection={selection}
      onPatchSection={onPatchSection}
      onSelectElement={onSelectElement}
      onBeginEdit={onBeginEdit}
      onEndEdit={onEndEdit}
      clipPreviewUrl={clipPreviewUrl}
      reduced={reduced}
    />
  );
};
