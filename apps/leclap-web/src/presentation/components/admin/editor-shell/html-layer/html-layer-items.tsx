// The section's HTML layers on the canvas, over its images and animations: each its own live preview in
// a draggable box, selected through the shared section selection like every other element.
import type { HtmlLayer, Orientation } from '../../templateEditorModel';
import type { ElementRef, SectionSelectionState } from '../useSectionSelection';
import type { HtmlPreviewEnv } from './html-layer-env';
import { HtmlLayerCanvasItem } from './html-layer-canvas-item';

interface HtmlLayerItemsProps {
  layers?: HtmlLayer[];
  env?: HtmlPreviewEnv;
  orientation: Orientation;
  selection: SectionSelectionState;
  frameRect: () => DOMRect | undefined;
  onSelectElement: (ref: ElementRef | null) => void;
  onChange?: (layers: HtmlLayer[]) => void;
}

export const HtmlLayerItems = ({
  layers,
  env,
  orientation,
  selection,
  frameRect,
  onSelectElement,
  onChange,
}: HtmlLayerItemsProps) => {
  if (!layers || !env) return null;

  const active = selection.element?.kind === 'html' ? selection.element.index : null;

  const patch = (index: number, change: Partial<HtmlLayer>) => {
    onChange?.(layers.map((layer, i) => (i === index ? { ...layer, ...change } : layer)));
  };

  const remove = (index: number) => {
    onSelectElement(null);
    onChange?.(layers.filter((_, i) => i !== index));
  };

  return layers.map((layer, index) => (
    <HtmlLayerCanvasItem
      key={layer.id}
      value={layer}
      index={index}
      env={env}
      orientation={orientation}
      active={index === active}
      frameRect={frameRect}
      onPatch={patch}
      onSelect={(i) => {
        onSelectElement({ kind: 'html', index: i });
      }}
      onDelete={remove}
    />
  ));
};
