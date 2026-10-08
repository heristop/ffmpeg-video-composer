// The center monitor's WYSIWYG surface: the aspect-correct frame, the background (image backdrop or
// editable color-layer stack), and the draggable/resizable overlays (text, image, animation). Canvas
// ONLY — every font/size/color/box control lives in the left OverlayInspector. ALL selection is lifted
// to the shell via the `selection` prop + `onSelectElement`, so clicking an overlay here drives the
// inspector and vice-versa; the canvas keeps no selection state of its own.
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type {
  AnimationOverlay,
  EditorCaption,
  Grade,
  HtmlLayer,
  ImageOverlay,
  LowerThird,
  TextOverlay,
  TitleCard,
  Orientation,
  BackgroundLayer,
  SectionFit,
} from '../templateEditorModel';
import { clampFraction, fontSizeFromResize } from '../overlayGeometry';
import { BackgroundLayerBoxes } from '../BackgroundLayerBoxes';
import { combinedLookGradeFilter } from '../editor/lookFilters';
import type { ElementRef, SectionSelectionState } from './useSectionSelection';
import { FRAME_FIT_CLASS } from './frame-fit';
import { OverlayBox } from './sectionCanvasBox';
import { AnimationOverlayItem, ImageOverlayItem } from './sectionCanvasMediaItems';
import { SugarPreviewLayer } from './SugarPreviewLayer';
import type { DropPayload, DropPoint } from './canvasDrop';
import { useCanvasDropTarget } from './useCanvasDropTarget';
import { LazyFxPreview, type FxPreviewLayerProps } from './fx-preview/LazyFxPreview';
import { HtmlLayerItems } from './html-layer/html-layer-items';
import type { HtmlPreviewEnv } from './html-layer/html-layer-env';

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

// The frame's backdrop (an image_background's picture, or an asset-backed video section's clip,
// previewed as a muted looping <video>). When absent and no editable layers are supplied, a
// neutral dark frame is shown instead.
export interface CanvasBackground {
  imageUrl?: string;
  videoUrl?: string;
}

// An editable background-layer stack (color_background): the base plus draggable/resizable extra
// layers, painted behind the text overlays and written back on every gesture.
export interface CanvasLayers {
  items: BackgroundLayer[];
  onChange: (layers: BackgroundLayer[]) => void;
}

// Geometry patches a media box emits (a subset of the overlay fields).
type MediaPatch = { position: string } | { scale: string } | { rotation: number };

// CSS approximation of the section's source-footage fit (SegmentBuilder.prependScaleFilters):
// cover = scale+crop (object-cover), letterbox = scale+pad with black bars (object-contain on a
// black element box — ffmpeg's pad default is black; blur previews the same way), off = no conform scaling at all, so the frame
// simply follows the source; filling the preview frame is the closest static approximation.
const backdropFitClass: Record<SectionFit, string> = {
  cover: 'object-cover',
  letterbox: 'bg-black object-contain',
  // The blurred fill is approximated by a contained frame on the dark backdrop.
  blur: 'bg-black object-contain',
  off: 'object-fill',
};

// The frame's non-interactive backdrop media: the neutral dark frame when nothing is set, an
// image_background's picture, or an asset-backed video section's clip as a muted looping <video>.
const BackdropMedia = ({
  background,
  hasBackground,
  fit,
}: {
  background?: CanvasBackground;
  hasBackground: boolean;
  fit?: SectionFit;
}) => (
  <>
    {!hasBackground && (
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(120%_120%_at_50%_0%,#2b2b3a,#15151f)]" />
    )}
    {background?.imageUrl && (
      <img
        aria-hidden
        alt=""
        src={background.imageUrl}
        className={cn('pointer-events-none absolute inset-0 h-full w-full', backdropFitClass[fit ?? 'cover'])}
      />
    )}
    {background?.videoUrl && (
      <video
        key={background.videoUrl}
        aria-hidden
        src={background.videoUrl}
        muted
        loop
        autoPlay
        playsInline
        className={cn('pointer-events-none absolute inset-0 h-full w-full', backdropFitClass[fit ?? 'cover'])}
      />
    )}
  </>
);

// Replace one overlay in a fresh array (immutable update for onChange).
const withOverlay = (overlays: TextOverlay[], index: number, patch: Partial<TextOverlay>): TextOverlay[] =>
  overlays.map((o, i) => (i === index ? { ...o, ...patch } : o));

// The overlay's centre in client pixels, from its [0,1] fractions and the frame rect.
const overlayCenter = (overlay: TextOverlay, rect: DOMRect): { cx: number; cy: number } => ({
  cx: rect.left + overlay.x * rect.width,
  cy: rect.top + overlay.y * rect.height,
});

// Merge a media patch into one item of its array (immutable update for image/animation overlays).
const withMedia = <T extends ImageOverlay | AnimationOverlay>(items: T[], index: number, patch: MediaPatch): T[] =>
  items.map((o, i) => (i === index ? { ...o, ...patch } : o));

interface SectionCanvasProps {
  overlays: TextOverlay[];
  orientation: Orientation;
  background?: CanvasBackground;
  // How the backdrop media maps into the frame (the section's source-footage fit); omitted = cover.
  backgroundFit?: SectionFit;
  layers?: CanvasLayers;
  images?: ImageOverlay[];
  animations?: AnimationOverlay[];
  // HTML layers, drawn by the engine's rasteriser (live preview) with the template's theme and values.
  htmlLayers?: HtmlLayer[];
  htmlEnv?: HtmlPreviewEnv;
  // The section's colour treatment, previewed as a CSS filter on the backdrop group only — the
  // engine bakes look/grade into the linear chain BEFORE the text sugar and the authored drawtext
  // overlays (SegmentBuilder.injectSugarFilters), so text must stay ungraded here too.
  look?: string;
  grade?: Grade;
  // The whole-video treatment (EditorState.globalLook/globalGrade) — the engine bakes it into every
  // section's base frame AFTER the section's own look/grade, so it chains onto the same backdrop filter.
  globalLook?: string;
  globalGrade?: Grade;
  // The section's text sugar, rendered as a WYSIWYG layer with direct manipulation
  // (SugarPreviewLayer): click-select, double-click line edit, drag-snap, caption resize.
  caption?: EditorCaption;
  titleCard?: TitleCard;
  lowerThird?: LowerThird;
  onChangeCaption?: (caption: EditorCaption | undefined) => void;
  onChangeTitleCard?: (titleCard: TitleCard | undefined) => void;
  onChangeLowerThird?: (lowerThird: LowerThird | undefined) => void;
  // Variable names in scope for the inline editors' `#` autocomplete (same list the panel gets).
  variables?: string[];
  selection: SectionSelectionState;
  onSelectElement: (ref: ElementRef | null) => void;
  onBeginEdit: () => void;
  onEndEdit: () => void;
  onChange: (overlays: TextOverlay[]) => void;
  onChangeImages?: (images: ImageOverlay[]) => void;
  onChangeAnimations?: (animations: AnimationOverlay[]) => void;
  onChangeHtmlLayers?: (htmlLayers: HtmlLayer[]) => void;
  onCanvasDrop?: (payload: DropPayload, point: DropPoint) => void;
  // The selected engine effect, drawn live by the browser (lazy layer): an approximation of the render.
  fx?: FxPreviewLayerProps;
}

// Read the active index for a given element kind from the shared selection (null when another kind,
// or nothing, is selected).
const activeIndex = (selection: SectionSelectionState, kind: ElementRef['kind']): number | null =>
  selection.element?.kind === kind ? selection.element.index : null;

// Corner-handle proportional resize: record the pointer's radial distance from the box centre at grab
// time, then scale the font by the drag ratio in ANY direction — dragging a one-line box's corner
// horizontally (the natural gesture) works, where mapping to vertical travel alone did nothing.
function useOverlayResize(
  overlays: TextOverlay[],
  frameRect: () => DOMRect | undefined,
  onChange: (overlays: TextOverlay[]) => void
) {
  const startRef = useRef<{ dist: number; fontsize: number } | null>(null);

  const resizeStart = (index: number, clientX: number, clientY: number) => {
    const rect = frameRect();

    if (!rect) return;
    const overlay = overlays[index];
    const { cx, cy } = overlayCenter(overlay, rect);
    startRef.current = { dist: Math.hypot(clientX - cx, clientY - cy) || 1, fontsize: overlay.fontsize };
  };

  const resizeTo = (index: number, clientX: number, clientY: number) => {
    const rect = frameRect();
    const start = startRef.current;

    if (!rect || !start) return;
    const overlay = overlays[index];
    const { cx, cy } = overlayCenter(overlay, rect);
    const dist = Math.hypot(clientX - cx, clientY - cy);
    const fontsize = fontSizeFromResize(start.fontsize, start.dist, dist);
    onChange(withOverlay(overlays, index, { fontsize }));
  };

  return { resizeStart, resizeTo };
}

export const SectionCanvas = ({
  overlays,
  orientation,
  background,
  backgroundFit,
  layers,
  images,
  animations,
  htmlLayers,
  htmlEnv,
  look,
  grade,
  globalLook,
  globalGrade,
  caption,
  titleCard,
  lowerThird,
  onChangeCaption,
  onChangeTitleCard,
  onChangeLowerThird,
  variables,
  selection,
  onSelectElement,
  onBeginEdit,
  onEndEdit,
  onChange,
  onChangeImages,
  onChangeAnimations,
  onChangeHtmlLayers,
  onCanvasDrop,
  fx,
}: SectionCanvasProps) => {
  const { t } = useTranslation('admin');
  const frameRef = useRef<HTMLDivElement>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const frameRect = (): DOMRect | undefined => frameRef.current?.getBoundingClientRect();
  const drop = useCanvasDropTarget({ frameRect, onCanvasDrop });

  const active = {
    text: activeIndex(selection, 'text'),
    layer: activeIndex(selection, 'layer'),
    image: activeIndex(selection, 'image'),
    animation: activeIndex(selection, 'animation'),
  };
  const hasBackground = Boolean(background?.imageUrl ?? background?.videoUrl ?? layers?.items.length);
  const imageList = images ?? [];
  const animationList = animations ?? [];
  // CSS approximation of the section's look + grade chained with the whole-video one, applied to
  // the backdrop group only (combinedLookGradeFilter mirrors the engine's section-then-global order).
  const gradeCss = combinedLookGradeFilter({ look, grade }, { look: globalLook, grade: globalGrade });
  const backdropFilter = gradeCss ? { filter: gradeCss } : undefined;

  const moveTo = (index: number, clientX: number, clientY: number) => {
    const rect = frameRect();

    if (!rect) return;
    const x = clampFraction(clientX - rect.left, rect.width);
    const y = clampFraction(clientY - rect.top, rect.height);
    onChange(withOverlay(overlays, index, { x, y }));
  };

  const { resizeStart, resizeTo } = useOverlayResize(overlays, frameRect, onChange);

  const nudge = (index: number, dx: number, dy: number) => {
    const overlay = overlays[index];
    onChange(withOverlay(overlays, index, { x: clamp01(overlay.x + dx), y: clamp01(overlay.y + dy) }));
  };

  const removeAt = (index: number) => {
    onSelectElement(null);
    onChange(overlays.filter((_, i) => i !== index));
  };

  const patchImage = (index: number, patch: MediaPatch) => {
    onChangeImages?.(withMedia(imageList, index, patch));
  };

  const removeImage = (index: number) => {
    onSelectElement(null);
    onChangeImages?.(imageList.filter((_, i) => i !== index));
  };

  const patchAnimation = (index: number, patch: MediaPatch) => {
    onChangeAnimations?.(withMedia(animationList, index, patch));
  };

  const removeAnimation = (index: number) => {
    onSelectElement(null);
    onChangeAnimations?.(animationList.filter((_, i) => i !== index));
  };

  return (
    <div
      ref={frameRef}
      onPointerDown={(e) => {
        if (e.target !== e.currentTarget) return;
        onSelectElement(null);
      }}
      onDragOver={drop.onDragOver}
      onDragLeave={drop.onDragLeave}
      onDrop={drop.onDrop}
      className={cn(
        'relative touch-none overflow-hidden rounded-xl border border-foreground/10 select-none',
        drop.dragOver && 'ring-2 ring-brand-500/60',
        FRAME_FIT_CLASS[orientation]
      )}
    >
      {/* Backdrop group: everything the engine grades (the base frame) lives under one CSS filter.
          The engine bakes look/grade BEFORE the sugar text and the authored drawtext overlays, so
          only this group is filtered — text and media overlays above stay untinted, like the render.
          pointer-events-none lets empty-area clicks reach the frame (deselect); the interactive
          layer boxes re-enable their own pointer events. */}
      <div className="pointer-events-none absolute inset-0" style={backdropFilter}>
        <BackdropMedia background={background} hasBackground={hasBackground} fit={backgroundFit} />
        {layers && (
          <BackgroundLayerBoxes
            layers={layers.items}
            onChange={layers.onChange}
            frameRect={frameRect}
            frameRef={frameRef}
            orientation={orientation}
            selectedIndex={active.layer}
            onSelect={(index) => {
              onSelectElement({ kind: 'layer', index });
            }}
          />
        )}
      </div>
      {imageList.map((image, index) => (
        <ImageOverlayItem
          key={image.id}
          value={image}
          index={index}
          orientation={orientation}
          active={index === active.image}
          frameRect={frameRect}
          onPatch={patchImage}
          onSelect={(i) => {
            onSelectElement({ kind: 'image', index: i });
          }}
          onDelete={removeImage}
        />
      ))}
      {animationList.map((animation, index) => (
        <AnimationOverlayItem
          key={animation.id ?? index}
          value={animation}
          index={index}
          orientation={orientation}
          active={index === active.animation}
          frameRect={frameRect}
          onPatch={patchAnimation}
          onSelect={(i) => {
            onSelectElement({ kind: 'animation', index: i });
          }}
          onDelete={removeAnimation}
        />
      ))}
      <HtmlLayerItems
        layers={htmlLayers}
        env={htmlEnv}
        orientation={orientation}
        selection={selection}
        frameRect={frameRect}
        onSelectElement={onSelectElement}
        onChange={onChangeHtmlLayers}
      />
      {/* The selected engine effect, live: drawn over the composited media, below the editable text. */}
      {fx ? <LazyFxPreview {...fx} annotate /> : null}
      {/* Text sugar draws above the composited media, below the draggable overlays — the engine's
          z-order (overlay-class sugar chains onto the final map; authored drawtext comes after). */}
      <SugarPreviewLayer
        caption={caption}
        titleCard={titleCard}
        lowerThird={lowerThird}
        orientation={orientation}
        frameRef={frameRef}
        selection={selection}
        onSelectElement={onSelectElement}
        onBeginEdit={onBeginEdit}
        onEndEdit={onEndEdit}
        onChangeCaption={onChangeCaption}
        onChangeTitleCard={onChangeTitleCard}
        onChangeLowerThird={onChangeLowerThird}
        variables={variables}
      />
      {overlays.map((overlay, index) => (
        <OverlayBox
          key={index}
          overlay={overlay}
          index={index}
          t={t}
          orientation={orientation}
          active={index === active.text}
          editing={index === active.text && selection.editing}
          variables={variables}
          editRef={editRef}
          frameRect={frameRect}
          onSelect={(i) => {
            onSelectElement({ kind: 'text', index: i });
          }}
          onEdit={onBeginEdit}
          onMove={moveTo}
          onResizeStart={resizeStart}
          onResize={resizeTo}
          onNudge={nudge}
          onDelete={removeAt}
          onCommitText={(text) => {
            onChange(withOverlay(overlays, index, { text }));
          }}
          onCaret={() => {
            // Caret tracking for at-cursor variable insertion is a later phase; the inspector appends
            // the variable token for now (see OverlayInspector).
          }}
          onEndEdit={onEndEdit}
        />
      ))}
    </div>
  );
};
