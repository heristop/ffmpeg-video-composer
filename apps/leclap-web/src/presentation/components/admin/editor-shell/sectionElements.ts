// Pure, React-free model that flattens a section's visual elements into one ordered, labelled list
// and supports add / remove / reorder across kinds. The unified left panel renders this list and an
// "Add element" menu drives `canAddElement` / `addElement`. No react-i18next here: descriptors carry
// an i18n key (e.g. `element.text`) + params, and the component translates them.
//
// Per-kind array ownership (confirmed against the editor model):
//   - text overlays (`overlays`):    video, color, image
//   - background layers (`layers`):  color only
//   - image overlays (`images`):     video, color, image
//   - animation overlays (`animations`): video, color, image
//   - engine effects (`graphics`: fx lights and stroke graphics): video, color, image — always inserted from
//     the picker's Effects side (a library entry). The "+ Add" menu's "Effect" opens an empty slot on that
//     side; its "Animation file" opens the same kind of slot on the files side.
//
// NOTE: a section-level background image is NOT a per-index array element (image/color sections carry
// a single `color`/picked background, not an `image` ElementRef), so background-image is OUT of scope
// here. AddElementMenu will handle background-image as a section-level toggle separately.
import {
  makeTemplateId,
  newOverlay,
  type EditorSection,
  type EditorCaption,
  type Orientation,
  type TextOverlay,
  type TitleCard,
  type ImageOverlay,
  type AnimationOverlay,
  type BackgroundLayer,
  type LowerThird,
} from '../templateEditorModel';
import { libraryEntryOfGraphic, libraryLabelKey } from '@leclap/creative-kit/editor';
import type { Graphic } from 'ffmpeg-video-composer/src/schemas/graphics.schemas.ts';
import { newExtraLayer } from '../editor/layerGeometry';
import { animationFileName } from '../editor/animationOverlay';
import { newShapeImage } from './shape-image';
import { translationText } from './sugarPreviewGeometry';
import type { ElementRef } from './useSectionSelection';

export interface ElementDescriptor {
  ref: ElementRef;
  labelKey: string;
  labelParams?: Record<string, string | number>;
  kind: ElementRef['kind'];
  // A short content preview (the overlay text, a logo/animation filename) shown next to the kind label
  // so rows are distinguishable and a reorder is visible. Absent when the element has no content yet.
  previewText?: string;
  // An i18n key for the preview instead (an engine effect reads as its library label, e.g. "Sheen").
  previewKey?: string;
  // Which of the two "animation" kinds the row is: an engine effect or an animation file played as-is.
  // Absent on every other kind and on an empty slot whose picker has not been used yet.
  family?: 'effect' | 'file';
}

type ArrayField = 'layers' | 'overlays' | 'images' | 'animations' | 'graphics';

// The kinds backed by an ordered per-section array, vs the SINGLETON text-sugar kinds
// (caption/titleCard/lowerThird — at most one per section, always ElementRef index 0). Sugar is
// authored via the scene fields / its inspector, never added or reordered like array elements.
type ArrayKind = 'layer' | 'text' | 'image' | 'animation' | 'effect';
export type SugarKind = 'caption' | 'titleCard' | 'lowerThird';

// Everything the "+ Add" menu can offer: the selectable element kinds plus the two shape entries.
// Shapes are NOT an ElementRef kind — a shape is an ImageOverlay carrying a `shape` recipe, so the
// menu entries lower to an `images` append and select as `{ kind: 'image' }`.
// "effect" adds no blank graphic: it opens an empty animation slot on the picker's Effects side, and the
// effect picked there replaces the slot (an engine effect always starts from a library entry).
export type AddableKind = ElementRef['kind'] | 'shapeRect' | 'shapeEllipse';

type ShapeAddKind = 'shapeRect' | 'shapeEllipse';

function isShapeKind(kind: AddableKind): kind is ShapeAddKind {
  return kind === 'shapeRect' || kind === 'shapeEllipse';
}

export function isSugarKind(kind: ElementRef['kind']): kind is SugarKind {
  return kind === 'caption' || kind === 'titleCard' || kind === 'lowerThird';
}

// The array field that backs each array-backed ElementRef kind.
const FIELD_FOR_KIND: Record<ArrayKind, ArrayField> = {
  layer: 'layers',
  text: 'overlays',
  image: 'images',
  animation: 'animations',
  effect: 'graphics',
};

// Which element kinds each section kind owns. The arrays are optional on the model (absent when
// empty), so ownership is keyed by section kind here rather than inferred from a present field.
const OWNED_KINDS: Record<EditorSection['kind'], ReadonlyArray<ElementRef['kind']>> = {
  video: ['text', 'image', 'animation', 'effect'],
  color: ['layer', 'text', 'image', 'animation', 'effect'],
  image: ['text', 'image', 'animation', 'effect'],
  music: [],
  form: [],
  partial: [],
};

// Which section kinds may carry each sugar singleton (mirrors the editor model: titleCard lives on
// color sections, lowerThird on video sections, caption on every visual section).
const SUGAR_OWNERS: Record<SugarKind, ReadonlyArray<EditorSection['kind']>> = {
  caption: ['video', 'color', 'image'],
  titleCard: ['color'],
  lowerThird: ['video'],
};

// Stable flatten order: background layers, then text overlays, then image overlays, then animations,
// then engine effects.
const KIND_ORDER: ReadonlyArray<ArrayKind> = ['layer', 'text', 'image', 'animation', 'effect'];

// Sugar rows follow the array elements, in the engine's overlay draw order (registry 50/55/58).
const SUGAR_ORDER: ReadonlyArray<SugarKind> = ['caption', 'titleCard', 'lowerThird'];

// The sugar value a section carries for `kind`, or undefined when unowned/absent.
function sugarValue(section: EditorSection, kind: SugarKind): unknown {
  if (!SUGAR_OWNERS[kind].includes(section.kind)) return undefined;

  return (section as Record<string, unknown>)[kind];
}

// The element array a section carries for `kind`, defaulting to [] for an owned-but-absent array.
// Sugar kinds are not array-backed, so they read as "no array" here.
function sectionArray(section: EditorSection, kind: ElementRef['kind']): unknown[] | undefined {
  if (isSugarKind(kind)) return undefined;

  if (!OWNED_KINDS[section.kind].includes(kind)) return undefined;

  const value = (section as Record<string, unknown>)[FIELD_FOR_KIND[kind]];

  if (!Array.isArray(value)) return [];

  return value;
}

// True when the section can gain an element of `kind`: array kinds need the owning section kind;
// a sugar singleton is addable only where owned AND while still absent (at most one per section).
// The shape entries ride the images array, so they are gated by image ownership.
export function canAddElement(section: EditorSection, kind: AddableKind): boolean {
  if (isShapeKind(kind)) return OWNED_KINDS[section.kind].includes('image');

  if (isSugarKind(kind)) {
    return SUGAR_OWNERS[kind].includes(section.kind) && sugarValue(section, kind) === undefined;
  }

  return OWNED_KINDS[section.kind].includes(kind);
}

// The basename of a URL/path (drop directories + query), so an image/animation row reads as its file.
function fileLabel(url: string | undefined): string | undefined {
  const trimmed = (url ?? '').split(/[?#]/)[0].replace(/\/+$/, '');
  const base = trimmed.split('/').pop();

  return base ? decodeURIComponent(base) : undefined;
}

// A label for a picked media choice — the url/upload filename, or the library asset id.
function mediaChoiceLabel(choice: ImageOverlay['choice']): string | undefined {
  if (choice.source === 'url') return fileLabel(choice.url);

  if (choice.source === 'upload') return choice.label;

  return choice.id;
}

// A short, identity-bearing content preview for an element row — the overlay text or the asset
// filename — truncated. Undefined when the element has no content to show yet. A shape's identity
// is its fill colour (its data: URL basename would be base64 noise).
function elementPreview(element: unknown, kind: ArrayKind): string | undefined {
  const raw = ((): string | undefined => {
    if (kind === 'text') return displayVariables((element as TextOverlay).text.trim()) || undefined;

    if (kind === 'image') {
      const image = element as ImageOverlay;

      if (image.shape) return image.shape.color;

      return mediaChoiceLabel(image.choice);
    }

    if (kind === 'animation') return animationFileName(element as AnimationOverlay);

    // A graphic the library does not offer (flash, bars…) reads as its type.
    if (kind === 'effect') return (element as Graphic).type;

    return undefined;
  })();

  return truncatePreview(raw);
}

// The row label key: shape-bearing images read as "Shape", an animation slot with nothing picked yet as
// "Effect or file", everything else as its kind.
function elementLabelKey(element: unknown, kind: ArrayKind): string {
  if (kind === 'image' && (element as ImageOverlay).shape) return 'element.shape';

  if (kind === 'animation' && !(element as AnimationOverlay).url) return 'element.animationPending';

  return `element.${kind}`;
}

// Display `{{ variable }}` placeholders as a compact `#variable` chip. Applied only to authored TEXT
// (caption/overlay/sugar content), never to asset filenames — a file literally named `photo{{2}}.jpg`
// carries no template syntax and must show verbatim. The engine's mustache stays in the template; this
// is a builder-display nicety only.
function displayVariables(raw: string): string {
  return raw.replace(/\{\{\s*([^}]+?)\s*\}\}/g, '#$1');
}

function truncatePreview(raw: string | undefined): string | undefined {
  if (!raw) return undefined;

  return raw.length > 24 ? `${raw.slice(0, 24)}…` : raw;
}

// The animation family of an effect row or a chosen animation file (see ElementDescriptor.family).
function familyOf(element: unknown, kind: ArrayKind): Pick<ElementDescriptor, 'family'> {
  if (kind === 'effect') return { family: 'effect' };

  if (kind === 'animation' && (element as AnimationOverlay).url) return { family: 'file' };

  return {};
}

function descriptorsFor(section: EditorSection, kind: ArrayKind): ElementDescriptor[] {
  const list = sectionArray(section, kind);

  if (!list) return [];

  return list.map((element, index) => {
    const entry = kind === 'effect' ? libraryEntryOfGraphic(element as Graphic) : undefined;

    return {
      ref: { kind, index },
      kind,
      labelKey: elementLabelKey(element, kind),
      labelParams: { n: index + 1 },
      ...familyOf(element, kind),
      ...(entry ? { previewKey: libraryLabelKey(entry.id) } : { previewText: elementPreview(element, kind) }),
    };
  });
}

// The identity-bearing line of a sugar singleton for its list row (the caption text, the card
// headline, the band title), resolved like the canvas preview resolves translations.
function sugarPreview(value: unknown, kind: SugarKind): string | undefined {
  const raw = ((): string | undefined => {
    if (kind === 'caption') return (value as EditorCaption).text.trim() || undefined;

    if (kind === 'titleCard') {
      const card = value as TitleCard;

      return [card.headline, card.kicker, card.subtitle].map(translationText).find((line) => line.trim() !== '');
    }

    const third = value as LowerThird;

    return [third.title, third.subtitle, third.badge].map(translationText).find((line) => line.trim() !== '');
  })();

  return raw ? displayVariables(raw) : undefined;
}

// One index-0 descriptor per sugar singleton the section currently carries. `labelParams` is omitted
// on purpose: a singleton row reads as "Caption", never "Caption 1".
function sugarDescriptors(section: EditorSection): ElementDescriptor[] {
  return SUGAR_ORDER.flatMap((kind) => {
    const value = sugarValue(section, kind);

    if (!value) return [];

    return [
      {
        ref: { kind, index: 0 },
        kind,
        labelKey: `element.${kind}`,
        previewText: truncatePreview(sugarPreview(value, kind)),
      },
    ];
  });
}

// Flatten a section's elements into the documented order with one descriptor per indexed element,
// followed by the sugar singletons so they are selectable from the panel like anything else.
export function listSectionElements(section: EditorSection): ElementDescriptor[] {
  return [...KIND_ORDER.flatMap((kind) => descriptorsFor(section, kind)), ...sugarDescriptors(section)];
}

// A fresh default element for `kind`, reusing the model's real factories.
function newElement(
  kind: Exclude<ArrayKind, 'effect'>
): TextOverlay | BackgroundLayer | ImageOverlay | AnimationOverlay {
  if (kind === 'text') return newOverlay();

  if (kind === 'layer') return newExtraLayer();

  if (kind === 'image') return { id: makeTemplateId(), choice: { source: 'url', url: '' } };

  return { id: makeTemplateId(), url: '' };
}

// A fresh, immediately-visible default for a sugar singleton — seeded with placeholder text (like
// the form-field factory's 'Label') because an empty sugar renders nothing on the canvas.
function newSugar(kind: SugarKind): Partial<EditorSection> {
  if (kind === 'caption') {
    return { caption: { text: 'Your caption', style: 'subtle', position: 'bottom' } };
  }

  if (kind === 'titleCard') {
    return { titleCard: { headline: { en: 'Your headline' } } };
  }

  return { lowerThird: { title: { en: 'Your title' } } };
}

// Append a default element to the matching array (ref at the new last index), or seed an absent
// sugar singleton (ref at index 0). Null when the section can't gain that kind. A shape entry
// appends a freshly rasterized shape overlay to `images` (orientation sizes/centres it) and selects
// it as a regular image element.
export function addElement(
  section: EditorSection,
  kind: AddableKind,
  orientation: Orientation = 'portrait'
): { patch: Partial<EditorSection>; ref: ElementRef } | null {
  if (isShapeKind(kind)) {
    const list = sectionArray(section, 'image');

    if (!list) return null;

    const shape = newShapeImage(kind === 'shapeRect' ? 'rect' : 'ellipse', orientation);

    return {
      patch: { images: [...list, shape] } as Partial<EditorSection>,
      ref: { kind: 'image', index: list.length },
    };
  }

  if (isSugarKind(kind)) {
    if (!canAddElement(section, kind)) return null;

    return { patch: newSugar(kind), ref: { kind, index: 0 } };
  }

  // An effect starts as an empty animation slot (see AddableKind); gated on effect ownership above.
  const slot = kind === 'effect' ? 'animation' : kind;

  if (!canAddElement(section, kind)) return null;

  const list = sectionArray(section, slot);

  if (!list) return null;

  const next = [...list, newElement(slot)];
  const field = FIELD_FOR_KIND[slot];

  return {
    patch: { [field]: next } as Partial<EditorSection>,
    ref: { kind: slot, index: list.length },
  };
}

// Drop the referenced index from the matching array. A sugar ref clears its singleton field instead
// (patchSection merges `{ lowerThird: undefined }` over the section). No-op patch when unowned.
export function removeElement(section: EditorSection, ref: ElementRef): Partial<EditorSection> {
  if (isSugarKind(ref.kind)) {
    if (sugarValue(section, ref.kind) === undefined) return {};

    return { [ref.kind]: undefined };
  }

  const list = sectionArray(section, ref.kind);

  if (!list) return {};

  const field = FIELD_FOR_KIND[ref.kind];
  const next = list.filter((_, index) => index !== ref.index);

  // The section's graphics are carried in descriptor shape: no effects left means no `graphics` field.
  if (field === 'graphics' && next.length === 0) return { graphics: undefined };

  return { [field]: next };
}

// Move the referenced element by `delta`, clamped in-bounds (no-op patch at an edge / missing array
// / a sugar singleton, which has no order to change).
export function reorderElement(section: EditorSection, ref: ElementRef, delta: number): Partial<EditorSection> {
  if (isSugarKind(ref.kind)) return {};

  const list = sectionArray(section, ref.kind);

  if (!list) return {};

  const to = ref.index + delta;

  if (to < 0 || to >= list.length) return {};

  // Insert-move (not swap) so a multi-position drag lands the element at `to` and shifts the rest —
  // for an adjacent ±1 step (the arrow buttons) this is identical to a swap.
  const next = [...list];
  const [moved] = next.splice(ref.index, 1);
  next.splice(to, 0, moved);
  const field = FIELD_FOR_KIND[ref.kind];

  return { [field]: next };
}
