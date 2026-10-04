import { describe, it, expect } from 'vitest';
import {
  newSection,
  newOverlay,
  type EditorSection,
  type AnimationOverlay,
  type ImageOverlay,
} from '../templateEditorModel';
import { newExtraLayer } from '../editor/layerGeometry';
import { resolveCanvasDrop, parseDropPayload, type DropPayload } from './canvasDrop';
import type { SectionSelectionState } from './useSectionSelection';

const NO_SELECTION: SectionSelectionState = { element: null, editing: false };
const selecting = (element: SectionSelectionState['element']): SectionSelectionState => ({ element, editing: false });

function field<T>(patch: Partial<EditorSection>, name: string): T[] {
  return (patch as Record<string, unknown>)[name] as T[];
}

// A video section with one text overlay, one image, and one animation already placed.
function videoSection(): EditorSection {
  const base = newSection('video');

  if (base.kind !== 'video') throw new Error('expected video');

  return {
    ...base,
    overlays: [{ ...newOverlay(), text: 'a', x: 0, y: 0 }],
    images: [{ id: 'img-1', choice: { source: 'library', id: 'old' }, position: '0:0', scale: '100:100' }],
    animations: [{ id: 'anim-1', url: '/old.apng', position: '0:0', scale: '100:100' }],
  };
}

function colorSection(): EditorSection {
  const base = newSection('color');

  if (base.kind !== 'color') throw new Error('expected color');

  return { ...base, layers: [newExtraLayer(), newExtraLayer()] };
}

describe('parseDropPayload', () => {
  it('accepts the three valid shapes and rejects junk', () => {
    expect(parseDropPayload({ source: 'element-row', ref: { kind: 'image', index: 2 } })).toEqual({
      source: 'element-row',
      ref: { kind: 'image', index: 2 },
    });
    expect(parseDropPayload({ source: 'library', element: 'animation', url: '/x.apng', label: 'X' })).toEqual({
      source: 'library',
      element: 'animation',
      url: '/x.apng',
      label: 'X',
    });
    expect(parseDropPayload({ source: 'library', element: 'image', choice: { source: 'library', id: 'p' } })).toEqual({
      source: 'library',
      element: 'image',
      choice: { source: 'library', id: 'p' },
    });
    expect(parseDropPayload(null)).toBeNull();
    expect(parseDropPayload({ source: 'library', element: 'music' })).toBeNull();
    expect(parseDropPayload({ source: 'element-row', ref: { kind: 'nope', index: 0 } })).toBeNull();
  });
});

describe('resolveCanvasDrop element-row move', () => {
  const center = { fracX: 0.5, fracY: 0.5 };

  it('moves a text overlay to the drop fraction', () => {
    const payload: DropPayload = { source: 'element-row', ref: { kind: 'text', index: 0 } };
    const result = resolveCanvasDrop(videoSection(), NO_SELECTION, payload, { fracX: 0.25, fracY: 0.75 }, 'portrait');

    expect(result?.selectRef).toEqual({ kind: 'text', index: 0 });
    expect(field(result!.patch, 'overlays')[0]).toMatchObject({ x: 0.25, y: 0.75 });
  });

  it('moves an image overlay, centring the box on the cursor (portrait frame 720x1280)', () => {
    const payload: DropPayload = { source: 'element-row', ref: { kind: 'image', index: 0 } };
    const result = resolveCanvasDrop(videoSection(), NO_SELECTION, payload, center, 'portrait');

    // 100x100 box centred at (360,640) → origin (310,590).
    expect(field<ImageOverlay>(result!.patch, 'images')[0].position).toBe('310:590');
    expect(result?.selectRef).toEqual({ kind: 'image', index: 0 });
  });

  it('moves an animation overlay', () => {
    const payload: DropPayload = { source: 'element-row', ref: { kind: 'animation', index: 0 } };
    const result = resolveCanvasDrop(videoSection(), NO_SELECTION, payload, center, 'portrait');

    expect(field<AnimationOverlay>(result!.patch, 'animations')[0].position).toBe('310:590');
  });

  it('moves an extra background layer as an iw/ih expression', () => {
    const payload: DropPayload = { source: 'element-row', ref: { kind: 'layer', index: 1 } };
    const result = resolveCanvasDrop(colorSection(), NO_SELECTION, payload, { fracX: 0.2, fracY: 0.4 }, 'square');

    expect(field(result!.patch, 'layers')[1]).toMatchObject({ x: 'iw*0.2000', y: 'ih*0.4000' });
  });

  it('never moves the full-bleed base layer (index 0)', () => {
    const payload: DropPayload = { source: 'element-row', ref: { kind: 'layer', index: 0 } };
    const result = resolveCanvasDrop(colorSection(), NO_SELECTION, payload, center, 'square');

    expect(result).toBeNull();
  });
});

describe('resolveCanvasDrop library', () => {
  const center = { fracX: 0.5, fracY: 0.5 };

  it('applies a dropped image card to the selected image element + moves it', () => {
    const payload: DropPayload = { source: 'library', element: 'image', choice: { source: 'library', id: 'new' } };
    const selection = selecting({ kind: 'image', index: 0 });
    const result = resolveCanvasDrop(videoSection(), selection, payload, center, 'portrait');

    expect(result?.selectRef).toEqual({ kind: 'image', index: 0 });
    const img = field<ImageOverlay>(result!.patch, 'images')[0];
    expect(img.choice).toEqual({ source: 'library', id: 'new' });
    expect(img.position).toBe('310:590');
    expect(field<ImageOverlay>(result!.patch, 'images')).toHaveLength(1);
  });

  it('applies a dropped animation card to the selected animation', () => {
    const payload: DropPayload = { source: 'library', element: 'animation', url: '/new.apng', label: 'New' };
    const selection = selecting({ kind: 'animation', index: 0 });
    const result = resolveCanvasDrop(videoSection(), selection, payload, center, 'portrait');

    const anim = field<AnimationOverlay>(result!.patch, 'animations')[0];
    expect(anim).toMatchObject({ url: '/new.apng', label: 'New' });
  });

  it('creates a new image element when nothing compatible is selected', () => {
    const payload: DropPayload = { source: 'library', element: 'image', choice: { source: 'library', id: 'new' } };
    const result = resolveCanvasDrop(videoSection(), NO_SELECTION, payload, center, 'portrait');

    const images = field<ImageOverlay>(result!.patch, 'images');
    expect(images).toHaveLength(2);
    expect(images[1].choice).toEqual({ source: 'library', id: 'new' });
    expect(images[1].position).toBeDefined();
    expect(result?.selectRef).toEqual({ kind: 'image', index: 1 });
  });

  it('creates a new element when a DIFFERENT-kind element is selected', () => {
    const payload: DropPayload = { source: 'library', element: 'animation', url: '/new.apng' };
    const selection = selecting({ kind: 'image', index: 0 });
    const result = resolveCanvasDrop(videoSection(), selection, payload, center, 'portrait');

    expect(field<AnimationOverlay>(result!.patch, 'animations')).toHaveLength(2);
    expect(result?.selectRef).toEqual({ kind: 'animation', index: 1 });
  });

  it('returns null when the section cannot own the dropped kind', () => {
    const payload: DropPayload = { source: 'library', element: 'image', choice: { source: 'library', id: 'x' } };
    const result = resolveCanvasDrop(newSection('music'), NO_SELECTION, payload, center, 'portrait');

    expect(result).toBeNull();
  });
});

it('newly dropped tap cues play once and disappear instead of freezing on the UI', () => {
  const result = resolveCanvasDrop(
    videoSection(),
    NO_SELECTION,
    { source: 'library', element: 'animation', url: '/assets/animations/tap_pulse.apng' },
    { fracX: 0.5, fracY: 0.5 },
    'landscape'
  );
  const overlays = field<AnimationOverlay>(result!.patch, 'animations');
  expect(overlays.at(-1)).toMatchObject({ loop: false, loops: 1, persistent: false });
});
