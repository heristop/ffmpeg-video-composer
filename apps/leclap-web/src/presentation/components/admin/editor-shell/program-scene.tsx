// One scene rendered for PLAYBACK inside the live program monitor: the same backdrop, look/grade
// filter, text sugar and overlay typography as the edit canvas (single-sourced via layerPreview /
// SugarPreviewLayer / boxStyle) — but display-only (the whole tree is pointer-events-none) and with
// each text overlay wrapped in an animation div the rAF clock mutates directly (reveal/exit,
// Ken Burns). Still-image / SHAPE overlays render too, each in an animation wrapper the clock
// samples via imageVisibilityAt (show window + `motion` entrance); background layers get a wrapper
// sampled via layerVisibilityAt (`reveal`). Animation files play as-is in wrappers sampled via
// animationVisibilityAt (start / duration / motion), and the engine effects draw live on the program clock.
import { forwardRef, useImperativeHandle, useRef, type CSSProperties, type RefObject } from 'react';
import { flipCssTransform, type ColorVariableMap } from '@leclap/creative-kit/editor';
import { displayFromTokens } from '@/lib/variableSyntax';
import { useColorVariables } from '@/presentation/components/ui';
import { findBackground, BACKGROUND_LIBRARY } from '@/data/mediaCatalog';
import {
  type BackgroundLayer,
  type EditorSection,
  type ImageOverlay,
  type Orientation,
  type TextOverlay,
} from '../templateEditorModel';
import { newBaseLayer } from '../editor/layerGeometry';
import { cssLayerBackground } from '../editor/layerPreview';
import { combinedLookGradeFilter, type LookGradeTreatment } from '../editor/lookFilters';
import { useChoicePreviewUrl } from '../editor/useChoicePreviewUrl';
import { resolveOverlayRect } from './imageAnimationDrag';
import { boxStyle, OverlayAccentBar } from './sectionCanvasBox';
import { previewScale } from './sugarPreviewGeometry';
import { SugarPreviewLayer } from './SugarPreviewLayer';
import { initialSectionSelection } from './useSectionSelection';
import { LazyFxPreview, type FxPreviewLayerProps } from './fx-preview/LazyFxPreview';
import { sectionGraphics } from './fx-preview/preview-env';
import { ProgramAnimations, sceneAnimations } from './program-animations';

export type VisualSection = Extract<EditorSection, { kind: 'video' | 'color' | 'image' }>;

// The handles the player's paint loop writes to every frame — raw DOM, never React state.
export interface ProgramSceneHandles {
  backdrop: HTMLDivElement | null;
  overlays: Array<HTMLDivElement | null>;
  // Per-image animation wrappers (still-image / shape overlays), aligned with sceneImages(section).
  images: Array<HTMLDivElement | null>;
  // Per-layer animation wrappers (color sections), aligned with sceneLayers(section).
  layers: Array<HTMLDivElement | null>;
  // Per-file wrappers (animation files), aligned with sceneAnimations(section).
  animations: Array<HTMLDivElement | null>;
}

// The still-image / shape overlays a scene composites, in paint order. Shared with the player's
// paint loop so the sampled array and the rendered wrappers always line up.
export const sceneImages = (section: VisualSection): ImageOverlay[] =>
  'images' in section ? (section.images ?? []) : [];

// The picture an image_background section will show (same rule as EditorMonitor): first allowed
// library background, else any bundled one.
const imageSectionUrl = (allowed: string[]): string | undefined =>
  findBackground(allowed.at(0) ?? '')?.url ?? BACKGROUND_LIBRARY.at(0)?.url;

// A scene's background layer stack (same rule as EditorMonitor): authored layers, else a single
// base layer synthesized from the picked colour; only color sections carry layers. Shared with the
// player's paint loop so the sampled array and the rendered wrappers always line up.
export const sceneLayers = (section: VisualSection): BackgroundLayer[] => {
  if (section.kind !== 'color') return [];

  return section.layers && section.layers.length > 0 ? section.layers : [newBaseLayer(section.color)];
};

// The engine grades the base frame BEFORE sugar and drawtext overlays, so only the backdrop group
// carries the CSS look/grade filter (mirrors SectionCanvas), with the whole-video treatment
// (EditorState.globalLook/globalGrade) chained after the section's own — the engine's order.
const backdropFilter = (section: VisualSection, globalTreatment: LookGradeTreatment): CSSProperties => {
  const css = combinedLookGradeFilter({ look: section.look, grade: section.grade }, globalTreatment);

  return css ? { filter: css } : {};
};

const Backdrop = ({
  section,
  colorVars,
  borderScale,
  layerRef,
}: {
  section: VisualSection;
  colorVars: ColorVariableMap;
  /** Preview px per engine px — rescales a layer's border stroke (authored in engine px) to the frame. */
  borderScale: number;
  /** Collects each layer's animation wrapper for the clock's reveal sampling (layerVisibilityAt). */
  layerRef: (index: number, el: HTMLDivElement | null) => void;
}) => {
  if (section.kind === 'image') {
    const url = imageSectionUrl(section.allowed);

    if (!url) return null;

    return <img aria-hidden alt="" src={url} className="absolute inset-0 h-full w-full object-cover" />;
  }

  if (section.kind === 'color') {
    return (
      <>
        {sceneLayers(section).map((layer, i) => (
          <div
            key={i}
            ref={(el) => {
              layerRef(i, el);
            }}
            aria-hidden
            className="absolute inset-0"
          >
            <div style={cssLayerBackground(layer, i === 0, colorVars, borderScale)} />
          </div>
        ))}
      </>
    );
  }

  // A video scene has no asset at authoring time — the same dark placeholder frame as the canvas.
  return <div aria-hidden className="absolute inset-0 bg-[radial-gradient(120%_120%_at_50%_0%,#2b2b3a,#15151f)]" />;
};

// One still-image / shape overlay at its RESTING placement (the same geometry math as the edit
// canvas's media box: engine px from resolveOverlayRect, rescaled by the preview factor, rotation
// around the centre with the mirror flip applied first). The animation wrapper AROUND this box is
// what the clock mutates, so the resting transform here never fights the sampled translate.
const ProgramImageBox = ({
  image,
  orientation,
  previewH,
}: {
  image: ImageOverlay;
  orientation: Orientation;
  previewH: number;
}) => {
  const url = useChoicePreviewUrl(image.choice);

  if (url === '') return null;

  const rect = resolveOverlayRect(image.position, image.scale, null, orientation);
  const k = previewScale(previewH, orientation);
  const transform = [image.rotation ? `rotate(${image.rotation}deg)` : '', flipCssTransform(image.flip)]
    .filter(Boolean)
    .join(' ');
  const style: CSSProperties = {
    left: rect.left * k,
    top: rect.top * k,
    width: rect.width * k,
    height: rect.height * k,
    transform: transform || undefined,
    opacity: image.opacity ?? 1,
  };

  return (
    <div aria-hidden className="absolute" style={style}>
      <img alt="" src={url} className="absolute inset-0 h-full w-full object-fill select-none" />
    </div>
  );
};

interface ProgramSceneProps {
  section: VisualSection;
  orientation: Orientation;
  frameRef: RefObject<HTMLDivElement | null>;
  previewH: number;
  // The whole-video look/grade (EditorState.globalLook/globalGrade), chained onto every scene's backdrop.
  globalTreatment: LookGradeTreatment;
  // The scene's engine effects, drawn live on the program clock (lazy layer); absent = none drawn.
  fx?: Pick<FxPreviewLayerProps, 'env' | 'subscribe'>;
}

// Renders one scene; exposes the backdrop + per-overlay wrapper elements for the clock's paint loop.
export const ProgramScene = forwardRef<ProgramSceneHandles, ProgramSceneProps>(
  ({ section, orientation, frameRef, previewH, globalTreatment, fx }, ref) => {
    const backdropRef = useRef<HTMLDivElement>(null);
    const overlayRefs = useRef<Array<HTMLDivElement | null>>([]);
    const imageRefs = useRef<Array<HTMLDivElement | null>>([]);
    const layerRefs = useRef<Array<HTMLDivElement | null>>([]);
    const animationRefs = useRef<Array<HTMLDivElement | null>>([]);
    const overlays: TextOverlay[] = section.overlays;
    const images = sceneImages(section);
    const graphics = sectionGraphics(section);
    overlayRefs.current.length = overlays.length;
    imageRefs.current.length = images.length;
    layerRefs.current.length = sceneLayers(section).length;
    // Resolve '{{ variable }}' colour tokens so playback matches the compiled colours.
    const { variables: colorVars } = useColorVariables();

    useImperativeHandle(ref, () => ({
      get backdrop() {
        return backdropRef.current;
      },
      get overlays() {
        return overlayRefs.current;
      },
      get images() {
        return imageRefs.current;
      },
      get layers() {
        return layerRefs.current;
      },
      get animations() {
        return animationRefs.current;
      },
    }));

    return (
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {/* Backdrop group: graded + Ken Burns'd as one unit (transform written by the clock). */}
        <div ref={backdropRef} className="absolute inset-0" style={backdropFilter(section, globalTreatment)}>
          <Backdrop
            section={section}
            colorVars={colorVars}
            borderScale={previewScale(previewH, orientation)}
            layerRef={(i, el) => {
              layerRefs.current[i] = el;
            }}
          />
        </div>
        {/* Engine effects draw over the graded base frame, under the text (their default z-order). */}
        {fx && graphics.length > 0 ? <LazyFxPreview graphics={graphics} {...fx} /> : null}
        <SugarPreviewLayer
          caption={section.caption}
          titleCard={section.kind === 'color' ? section.titleCard : undefined}
          lowerThird={section.kind === 'video' ? section.lowerThird : undefined}
          orientation={orientation}
          frameRef={frameRef}
          selection={initialSectionSelection}
          onSelectElement={() => {}}
        />
        {overlays.map((overlay, index) => (
          <div
            key={index}
            ref={(el) => {
              overlayRefs.current[index] = el;
            }}
            className="absolute inset-0"
          >
            <span className="absolute whitespace-pre" style={boxStyle(overlay, previewH, orientation, colorVars)}>
              {displayFromTokens(overlay.text)}
              <OverlayAccentBar overlay={overlay} vars={colorVars} />
            </span>
          </div>
        ))}
        {/* Still-image / shape overlays paint ABOVE the text, mirroring the engine (overlay maps
            composite after the section's drawtext filters). Each wrapper is sampled by the clock
            via imageVisibilityAt (show window + motion). */}
        {images.map((image, index) => (
          <div
            key={image.id}
            ref={(el) => {
              imageRefs.current[index] = el;
            }}
            className="absolute inset-0"
          >
            <ProgramImageBox image={image} orientation={orientation} previewH={previewH} />
          </div>
        ))}
        {/* Animation files play as-is above the stills, each wrapper sampled via animationVisibilityAt. */}
        <ProgramAnimations
          animations={sceneAnimations(section)}
          orientation={orientation}
          previewH={previewH}
          wrappers={animationRefs}
        />
      </div>
    );
  }
);
ProgramScene.displayName = 'ProgramScene';
