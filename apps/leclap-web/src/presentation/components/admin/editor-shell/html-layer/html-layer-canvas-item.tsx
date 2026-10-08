// One HTML layer on the section canvas: its live preview (the engine's own drawing of it) in the same
// draggable/resizable/rotatable box as images and animations. Dragging the corner resizes the layer's box,
// so the content lays out again at the new size, rather than stretching the drawn still.
import { HTML_LAYER_MAX_SIZE } from 'ffmpeg-video-composer/src/core/html/limits.ts';
import type { HtmlLayer, Orientation } from '../../templateEditorModel';
import { parsePair, toNum } from '../../editor/animationOverlay';
import { SectionCanvasMediaBox } from '../sectionCanvasMediaBox';
import type { HtmlPreviewEnv } from './html-layer-env';
import { useHtmlLayerPreview } from './use-html-layer-preview';

interface HtmlLayerCanvasItemProps {
  value: HtmlLayer;
  index: number;
  env: HtmlPreviewEnv;
  orientation: Orientation;
  active: boolean;
  frameRect: () => DOMRect | undefined;
  onPatch: (index: number, patch: Partial<HtmlLayer>) => void;
  onSelect: (index: number) => void;
  onDelete: (index: number) => void;
}

const side = (value: number | undefined, fallback: number): number =>
  Math.min(HTML_LAYER_MAX_SIZE, Math.max(16, Math.round(value ?? fallback)));

/** A resize grip's `w:h` scale as the layer's new box. */
export const boxFromScale = (scale: string, layer: HtmlLayer): Pick<HtmlLayer, 'width' | 'height' | 'scale'> => {
  const [w, h] = parsePair(scale);

  return { width: side(toNum(w), layer.width), height: side(toNum(h), layer.height), scale: undefined };
};

export const HtmlLayerCanvasItem = ({
  value,
  index,
  env,
  orientation,
  active,
  frameRect,
  onPatch,
  onSelect,
  onDelete,
}: HtmlLayerCanvasItemProps) => {
  const preview = useHtmlLayerPreview(value, env);

  if (!preview.url) return null;

  return (
    <SectionCanvasMediaBox
      value={{ ...value, scale: value.scale ?? `${value.width}:${value.height}` }}
      url={preview.url}
      kind="html"
      orientation={orientation}
      active={active}
      frameRect={frameRect}
      onSelect={() => {
        onSelect(index);
      }}
      onMove={(patch) => {
        onPatch(index, patch);
      }}
      onResize={(patch) => {
        onPatch(index, boxFromScale(patch.scale, value));
      }}
      onRotate={(patch) => {
        onPatch(index, patch);
      }}
      onNudge={(patch) => {
        onPatch(index, patch);
      }}
      onDelete={() => {
        onDelete(index);
      }}
    />
  );
};
