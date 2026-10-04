// Pure orchestration for native drag-and-drop onto the section canvas. A dragged source (a library
// animation/image card, or an already-placed element row) is serialized through dataTransfer as a
// DropPayload; on drop, resolveCanvasDrop turns it + the drop point into an immutable section patch
// plus the ref to select. No React/DOM here — SectionCanvas reads the payload + computes the frame
// fraction, EditorMonitor applies the patch.
import {
  animationDefaultsForUrl,
  type AnimationOverlay,
  type EditorSection,
  type ImageOverlay,
  type MediaChoice,
  type Orientation,
  type TextOverlay,
  type BackgroundLayer,
} from '../templateEditorModel';
import { clampFraction } from '../overlayGeometry';
import { resolveOverlayRect, positionFromFraction } from './imageAnimationDrag';
import { percentToExpr } from '../editor/layerGeometry';
import { addElement } from './sectionElements';
import type { ElementRef, SectionSelectionState } from './useSectionSelection';

// dataTransfer MIME under which the JSON payload travels (kept app-specific so foreign drags are ignored).
export const CANVAS_DND_MIME = 'application/x-leclap-element';

export type DropPayload =
  | { source: 'library'; element: 'image'; choice: MediaChoice }
  | { source: 'library'; element: 'animation'; url: string; label?: string }
  | { source: 'element-row'; ref: ElementRef };

// The drop location as a 0..1 fraction of the frame on each axis.
export interface DropPoint {
  fracX: number;
  fracY: number;
}

export interface CanvasDropResult {
  patch: Partial<EditorSection>;
  selectRef: ElementRef | null;
}

const ELEMENT_KINDS = ['text', 'layer', 'image', 'animation'] as const;

const isElementKind = (value: unknown): value is ElementRef['kind'] =>
  typeof value === 'string' && (ELEMENT_KINDS as ReadonlyArray<string>).includes(value);

const isElementRef = (value: unknown): value is ElementRef => {
  if (typeof value !== 'object' || value === null) return false;

  const ref = value as Record<string, unknown>;

  return isElementKind(ref.kind) && typeof ref.index === 'number';
};

// Validate a parsed dataTransfer value into a DropPayload (returns null on any shape mismatch).
export const parseDropPayload = (value: unknown): DropPayload | null => {
  if (typeof value !== 'object' || value === null) return null;

  const p = value as Record<string, unknown>;

  if (p.source === 'element-row') return isElementRef(p.ref) ? { source: 'element-row', ref: p.ref } : null;

  if (p.source !== 'library') return null;

  if (p.element === 'image' && typeof p.choice === 'object' && p.choice !== null) {
    return { source: 'library', element: 'image', choice: p.choice as MediaChoice };
  }

  if (p.element === 'animation' && typeof p.url === 'string') {
    const label = typeof p.label === 'string' ? p.label : undefined;

    return { source: 'library', element: 'animation', url: p.url, label };
  }

  return null;
};

// Read a section's element array for a kind (empty when the array is absent).
const arrayFor = (section: EditorSection, field: 'overlays' | 'images' | 'animations' | 'layers'): unknown[] => {
  const value = (section as Record<string, unknown>)[field];

  return Array.isArray(value) ? value : [];
};

// The output-px "x:y" origin centred on the drop point for the media item at `index` (its current
// size drives the centring; a fresh item falls back to its natural/frame size).
const mediaPosition = (
  items: ReadonlyArray<{ position?: string; scale?: string }>,
  index: number,
  point: DropPoint,
  orientation: Orientation
): string => {
  const item = items[index];
  const rect = resolveOverlayRect(item.position, item.scale, null, orientation);

  return positionFromFraction(point.fracX, point.fracY, rect.width, rect.height, orientation);
};

const moveText = (section: EditorSection, index: number, point: DropPoint): CanvasDropResult => {
  const overlays = arrayFor(section, 'overlays') as TextOverlay[];
  const next = overlays.map((o, i) =>
    i === index ? { ...o, x: clampFraction(point.fracX, 1), y: clampFraction(point.fracY, 1) } : o
  );

  return { patch: { overlays: next }, selectRef: { kind: 'text', index } };
};

const moveMedia = (
  section: EditorSection,
  field: 'images' | 'animations',
  index: number,
  point: DropPoint,
  orientation: Orientation
): CanvasDropResult => {
  const items = arrayFor(section, field) as Array<ImageOverlay | AnimationOverlay>;
  const position = mediaPosition(items, index, point, orientation);
  const next = items.map((item, i) => (i === index ? { ...item, position } : item));

  return {
    patch: { [field]: next },
    selectRef: { kind: field === 'images' ? 'image' : 'animation', index },
  };
};

const moveLayer = (section: EditorSection, index: number, point: DropPoint): CanvasDropResult => {
  const layers = arrayFor(section, 'layers') as BackgroundLayer[];
  const x = percentToExpr('x', clampFraction(point.fracX, 1) * 100);
  const y = percentToExpr('y', clampFraction(point.fracY, 1) * 100);
  const next = layers.map((layer, i) => (i === index ? { ...layer, x, y } : layer));

  return { patch: { layers: next }, selectRef: { kind: 'layer', index } };
};

// Move an already-placed element to the drop point. The base background layer (index 0) is full-bleed
// and carries no geometry, so it is never moved.
const moveElement = (
  section: EditorSection,
  ref: ElementRef,
  point: DropPoint,
  orientation: Orientation
): CanvasDropResult | null => {
  if (ref.kind === 'text') return moveText(section, ref.index, point);

  if (ref.kind === 'image') return moveMedia(section, 'images', ref.index, point, orientation);

  if (ref.kind === 'animation') return moveMedia(section, 'animations', ref.index, point, orientation);

  if (ref.index === 0) return null;

  return moveLayer(section, ref.index, point);
};

type LibraryPayload = Extract<DropPayload, { source: 'library' }>;

// The full context of a library drop, threaded as one object so the helpers stay within the param budget.
interface LibraryDrop {
  payload: LibraryPayload;
  point: DropPoint;
  orientation: Orientation;
}

const mediaField = (payload: LibraryPayload): 'images' | 'animations' =>
  payload.element === 'image' ? 'images' : 'animations';

// Merge a library source + drop position into one item of a freshly-built patch array (the item lives
// at `index`). Returns the patched array under the same field.
const applyLibrarySource = (
  items: Array<ImageOverlay | AnimationOverlay>,
  index: number,
  drop: LibraryDrop
): Partial<EditorSection> => {
  const { payload, point, orientation } = drop;
  const source = payload.element === 'image' ? { choice: payload.choice } : { url: payload.url, label: payload.label };
  const defaults =
    payload.element === 'animation' && 'url' in items[index] && !items[index].url
      ? animationDefaultsForUrl(payload.url)
      : {};
  const sized = items.map((item, i) => (i === index ? { ...item, ...defaults, ...source } : item));
  const position = mediaPosition(sized, index, point, orientation);
  const next = sized.map((item, i) => (i === index ? { ...item, position } : item));

  return { [mediaField(payload)]: next };
};

// Apply a dropped library card to the COMPATIBLE already-selected element (same kind) in place.
const applyToSelected = (section: EditorSection, ref: ElementRef, drop: LibraryDrop): CanvasDropResult => {
  const items = arrayFor(section, mediaField(drop.payload)) as Array<ImageOverlay | AnimationOverlay>;

  return { patch: applyLibrarySource(items, ref.index, drop), selectRef: ref };
};

// Create a NEW element of the card's kind with that source, placed at the drop point.
const createFromLibrary = (section: EditorSection, drop: LibraryDrop): CanvasDropResult | null => {
  const added = addElement(section, drop.payload.element);

  if (!added) return null;

  const created = (added.patch as Record<string, unknown>)[mediaField(drop.payload)] as Array<
    ImageOverlay | AnimationOverlay
  >;

  return { patch: applyLibrarySource(created, added.ref.index, drop), selectRef: added.ref };
};

const resolveLibraryDrop = (
  section: EditorSection,
  selection: SectionSelectionState,
  drop: LibraryDrop
): CanvasDropResult | null => {
  const selected = selection.element;

  if (selected && selected.kind === drop.payload.element) {
    return applyToSelected(section, selected, drop);
  }

  return createFromLibrary(section, drop);
};

// Turn a drop payload + point into an immutable section patch and the ref to select. Returns null when
// the drop is a no-op (e.g. the section can't own the dropped kind, or the base layer was targeted).
export const resolveCanvasDrop = (
  section: EditorSection,
  selection: SectionSelectionState,
  payload: DropPayload,
  point: DropPoint,
  orientation: Orientation
): CanvasDropResult | null => {
  if (payload.source === 'element-row') return moveElement(section, payload.ref, point, orientation);

  return resolveLibraryDrop(section, selection, { payload, point, orientation });
};
