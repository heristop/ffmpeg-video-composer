// The left panel's cross-kind element list: one ordered, selectable row per visual element of the
// selected section (background layers, text, image overlays, animations), driven by ElementDescriptor.
// Each row mirrors the canvas selection ring (aria-pressed), and carries move-up / move-down / delete
// controls. This generalizes OverlayInspector's text-only list to descriptor-driven rows, reusing the
// same kind→icon mapping as AddElementMenu so the list and the add menu stay in agreement.
import { useState, type ComponentType, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useIconHover } from '@/presentation/components/icons/useIconHover';
import { Image, Plus, Square, Trash2, Type } from '@/presentation/components/icons';
import { ChevronDownIcon } from '@/presentation/components/icons/chevron-down';
import { ChevronUpIcon } from '@/presentation/components/icons/chevron-up';
import { cn } from '@/lib/utils';
import { FamilyTile, familyNameKey } from '../editor/animationKinds';
import type { ElementRef } from './useSectionSelection';
import type { ElementDescriptor } from './sectionElements';
import { CANVAS_DND_MIME } from './canvasDrop';

// Shared with AddElementMenu's KIND_ICON so list rows and add-menu items use the same glyph per kind.
// The text-sugar singletons reuse the text glyph — they are styled text blocks, differentiated by label.
// Effects and animation files carry their family tile instead (FamilyTile: lavender sparkles vs rose
// film); an animation slot with nothing picked yet reads as a plain "+".
const KIND_ICON: Record<ElementRef['kind'], ComponentType<{ className?: string }>> = {
  layer: Square,
  text: Type,
  image: Image,
  animation: Plus,
  effect: Plus,
  caption: Type,
  titleCard: Type,
  lowerThird: Type,
};

// Two refs point at the same element when both kind and index match.
const sameRef = (a: ElementRef, b: ElementRef | null): boolean => {
  if (b === null) return false;

  return a.kind === b.kind && a.index === b.index;
};

// Decode a dragged element-row payload (the same JSON the canvas drop reads), or null when the drag
// is not a reorderable element row.
function parseElementRowDrag(raw: string): { ref: ElementRef } | null {
  try {
    const payload = JSON.parse(raw) as { source?: string; ref?: ElementRef };

    if (payload.source === 'element-row' && payload.ref) return { ref: payload.ref };
  } catch {
    // Not a JSON element-row payload — ignore.
  }

  return null;
}

interface ElementListProps {
  elements: ElementDescriptor[];
  activeRef: ElementRef | null;
  onSelect: (ref: ElementRef) => void;
  onDelete: (ref: ElementRef) => void;
  onMove: (ref: ElementRef, delta: number) => void;
}

export const ElementList = ({ elements, activeRef, onSelect, onDelete, onMove }: ElementListProps) => {
  const { t } = useTranslation('admin');

  // Reorder is scoped per kind (text / image / animation / layer each live in their own array, and the
  // engine composites the kinds in a fixed order), so the move arrows must reflect each element's
  // position WITHIN its kind — not its index in the flattened list — or they read as enabled while
  // doing nothing (e.g. a lone text above a lone image).
  const countByKind = elements.reduce<Partial<Record<ElementRef['kind'], number>>>((acc, { kind }) => {
    acc[kind] = (acc[kind] ?? 0) + 1;

    return acc;
  }, {});

  // Which kind is currently being dragged (set on dragStart, cleared on dragEnd). Rows use it to
  // highlight only same-kind drop targets and show a "can't drop here" cursor on the rest — so the
  // per-kind reorder scope is legible mid-drag instead of a silent no-op.
  const [draggingKind, setDraggingKind] = useState<ElementRef['kind'] | null>(null);

  if (elements.length === 0) {
    return (
      // The "Elements" header (label + "+ Add") is owned by ElementBlock so the list starts at its
      // rows; the empty state is a dashed drop-zone-styled hint pointing at that Add menu.
      <p className="rounded-lg border border-dashed border-foreground/15 px-3 py-2.5 text-center text-xs text-gray-500 dark:text-gray-400">
        {t('element.empty')}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <ul className="space-y-1">
        {elements.map((descriptor) => {
          // Reorder only exists between siblings of the same kind; a lone element of its kind shows no
          // move arrows at all (dim, permanently-disabled arrows on every row read as "broken").
          const reorderable = (countByKind[descriptor.kind] ?? 1) > 1;

          return (
            <Row
              key={`${descriptor.kind}:${descriptor.ref.index}`}
              descriptor={descriptor}
              active={sameRef(descriptor.ref, activeRef)}
              first={descriptor.ref.index === 0}
              last={descriptor.ref.index === (countByKind[descriptor.kind] ?? 1) - 1}
              reorderable={reorderable}
              draggingKind={draggingKind}
              onDragKind={setDraggingKind}
              onSelect={onSelect}
              onDelete={onDelete}
              onMove={onMove}
            />
          );
        })}
      </ul>
      {/* One line demystifying the model: layering is by type, arrows/drag reorder within a type. */}
      <p className="px-1 text-xs leading-snug text-gray-500 dark:text-gray-400">{t('element.reorderHint')}</p>
    </div>
  );
};

interface RowProps {
  descriptor: ElementDescriptor;
  active: boolean;
  first: boolean;
  last: boolean;
  reorderable: boolean;
  draggingKind: ElementRef['kind'] | null;
  onDragKind: (kind: ElementRef['kind'] | null) => void;
  onSelect: (ref: ElementRef) => void;
  onDelete: (ref: ElementRef) => void;
  onMove: (ref: ElementRef, delta: number) => void;
}

const Row = ({
  descriptor,
  active,
  first,
  last,
  reorderable,
  draggingKind,
  onDragKind,
  onSelect,
  onDelete,
  onMove,
}: RowProps) => {
  const { t } = useTranslation('admin');
  const { ref, family } = descriptor;
  const { ref: chevronUpRef, hoverProps: chevronUpHoverProps } = useIconHover();
  const { ref: chevronDownRef, hoverProps: chevronDownHoverProps } = useIconHover();
  const [dropTarget, setDropTarget] = useState(false);

  // A drag is a valid reorder target only for a DIFFERENT row of the SAME kind (kinds live in separate
  // arrays and can't interleave). Knowing the dragged kind up front lets the row show accept vs. reject
  // feedback during the drag, instead of accepting the drop then silently discarding it.
  const dragActive = draggingKind !== null;
  const acceptsDrag = dragActive && draggingKind === ref.kind;

  // A row dragged onto ANOTHER row reorders the list (same kind only). The same draggable also feeds the
  // canvas (effectAllowed copyMove), so dropping on the canvas still adds the element; dropping on a
  // same-kind row moves it.
  const onRowDrop = (event: React.DragEvent<HTMLLIElement>): void => {
    setDropTarget(false);
    const raw = event.dataTransfer.getData(CANVAS_DND_MIME);

    if (!raw) return;
    event.preventDefault();
    event.stopPropagation();

    const payload = parseElementRowDrag(raw);

    if (!payload || payload.ref.kind !== ref.kind) return;
    onMove(payload.ref, ref.index - payload.ref.index);
  };

  return (
    <li
      // cursor-grab on the row gaps hints that rows are draggable (buttons keep their own cursor); a
      // no-drop cursor over an incompatible-kind row while dragging teaches the per-kind reorder scope.
      className={cn(
        'flex items-center gap-1 rounded-lg',
        reorderable ? 'cursor-grab active:cursor-grabbing' : 'cursor-default',
        dropTarget && acceptsDrag && 'ring-2 ring-brand-500/50',
        dragActive && !acceptsDrag && 'cursor-no-drop opacity-60'
      )}
      draggable={reorderable}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'copyMove';
        event.dataTransfer.setData(CANVAS_DND_MIME, JSON.stringify({ source: 'element-row', ref }));
        onDragKind(ref.kind);
      }}
      onDragEnd={() => {
        onDragKind(null);
        setDropTarget(false);
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(CANVAS_DND_MIME)) return;
        // Only a same-kind row is a real drop target; leave incompatible rows to the browser's
        // default "no-drop" so the reject is visible rather than a fake highlight.
        if (!acceptsDrag) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setDropTarget(true);
      }}
      onDragLeave={() => {
        setDropTarget(false);
      }}
      onDrop={onRowDrop}
    >
      <button
        type="button"
        aria-pressed={active}
        // The preview text truncates in the narrow panel; the title surfaces the full text on hover.
        title={descriptor.previewText}
        // An effect or a file states its kind first ("Effect: Sheen", "Animation file: confetti.apng").
        aria-label={family ? rowAriaLabel(t, descriptor) : undefined}
        onClick={() => {
          onSelect(ref);
        }}
        className={cn(
          'tap flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
          active ? 'bg-brand-500/15 text-foreground' : 'text-gray-600 hover:bg-foreground/5 dark:text-gray-300'
        )}
      >
        <RowIcon descriptor={descriptor} />
        <span className="shrink-0">{t(descriptor.labelKey, descriptor.labelParams)}</span>
        {descriptor.previewKey ? (
          <span className="truncate text-gray-400 dark:text-gray-500">{t(descriptor.previewKey)}</span>
        ) : null}
        {descriptor.previewText && (
          <span className="truncate text-gray-400 dark:text-gray-500">{descriptor.previewText}</span>
        )}
      </button>
      {reorderable && (
        <>
          <IconButton
            label={t('element.moveUp')}
            disabled={first}
            onClick={() => {
              onMove(ref, -1);
            }}
            hoverProps={chevronUpHoverProps}
          >
            <ChevronUpIcon ref={chevronUpRef} size={14} />
          </IconButton>
          <IconButton
            label={t('element.moveDown')}
            disabled={last}
            onClick={() => {
              onMove(ref, 1);
            }}
            hoverProps={chevronDownHoverProps}
          >
            <ChevronDownIcon ref={chevronDownRef} size={14} />
          </IconButton>
        </>
      )}
      <IconButton
        label={t('element.delete')}
        danger
        onClick={() => {
          onDelete(ref);
        }}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </IconButton>
    </li>
  );
};

// The family tile of an effect / animation file row (a touch smaller than the picker's), else the kind glyph.
const RowIcon = ({ descriptor }: { descriptor: ElementDescriptor }) => {
  if (descriptor.family) return <FamilyTile family={descriptor.family} className="h-5 w-5 rounded-[0.3rem]" />;

  const Icon = KIND_ICON[descriptor.kind];

  return <Icon className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden />;
};

function rowAriaLabel(t: TFunction<'admin'>, descriptor: ElementDescriptor): string {
  const kind = t(familyNameKey(descriptor.family ?? 'file'));
  const name = descriptor.previewKey ? t(descriptor.previewKey) : descriptor.previewText;

  return name ? t('element.kindLabel', { kind, name }) : kind;
}

interface IconButtonProps {
  label: string;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
  hoverProps?: { onMouseEnter: () => void; onMouseLeave: () => void };
  children: ReactNode;
}

const IconButton = ({ label, disabled, danger, onClick, hoverProps, children }: IconButtonProps) => (
  <button
    type="button"
    aria-label={label}
    disabled={disabled}
    onClick={onClick}
    className={cn(
      'tap rounded-lg p-1.5 text-gray-500 transition-colors focus-visible:outline-none focus-visible:ring-2 active:scale-90 disabled:pointer-events-none disabled:opacity-30',
      danger
        ? 'hover:bg-foreground/5 hover:text-[var(--color-error)] focus-visible:ring-[var(--color-error)]/40'
        : 'hover:bg-foreground/5 hover:text-foreground focus-visible:ring-brand-500/40'
    )}
    {...hoverProps}
  >
    {children}
  </button>
);
