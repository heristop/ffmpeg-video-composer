// The unified "+ Add" menu for the editor's left panel: a trigger button that opens a popover of the
// element kinds the selected section actually supports (gated by `canAddElement`). Picking an item
// closes the menu and emits its kind to the parent, which appends the element. Sections that own no
// addable elements (music/form/partial) render nothing. The popover interaction mirrors
// overlayControls' VariableMenu (outside-click + Escape).
import { useEffect, useRef, useState, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { Circle, Image, Square, Type } from '@/presentation/components/icons';
import { PlusIcon } from '@/presentation/components/icons/plus';
import { Button } from '@/presentation/components/ui';
import { useIconHover } from '@/presentation/components/icons/useIconHover';
import { cn } from '@/lib/utils';
import type { EditorSection } from '../templateEditorModel';
import { canAddElement, type AddableKind } from './sectionElements';
import { FAMILY_ICON, FAMILY_TONE, type AnimationFamily } from '../editor/animationKinds';

// Canonical add order: background layer → text → image overlay → shapes → effect → animation file →
// structured text sugar. The shape entries (rectangle/circle) lower to image overlays carrying a shape
// recipe. "Effect" and "Animation file" are two distinct entries: both open the picker, on its own side.
const ADD_ORDER: ReadonlyArray<AddableKind> = [
  'layer',
  'text',
  'image',
  'shapeRect',
  'shapeEllipse',
  'effect',
  'animation',
  'caption',
  'titleCard',
  'lowerThird',
];

// The element kinds the section supports, in canonical order. Empty for sections with no elements.
export function addableKinds(section: EditorSection): AddableKind[] {
  return ADD_ORDER.filter((kind) => canAddElement(section, kind));
}

// Icon + i18n label-key per addable kind.
const KIND_ICON: Record<AddableKind, ComponentType<{ className?: string }>> = {
  layer: Square,
  text: Type,
  image: Image,
  shapeRect: Square,
  shapeEllipse: Circle,
  effect: FAMILY_ICON.effect,
  animation: FAMILY_ICON.file,
  caption: Type,
  titleCard: Type,
  lowerThird: Type,
};

const KIND_LABEL: Record<AddableKind, string> = {
  layer: 'element.addBackgroundColor',
  text: 'element.addText',
  image: 'element.addImageOverlay',
  shapeRect: 'element.addShapeRect',
  shapeEllipse: 'element.addShapeEllipse',
  effect: 'element.addEffect',
  animation: 'element.addAnimation',
  caption: 'element.addCaption',
  titleCard: 'element.addTitleCard',
  lowerThird: 'element.addLowerThird',
};

// The two animation entries carry their family's tone and a one-line hint, so "drawn by the engine and
// adjustable" vs "a file played as-is" is clear before anything is added.
const FAMILY_OF: Partial<Record<AddableKind, AnimationFamily>> = { effect: 'effect', animation: 'file' };

// The structured text-sugar kinds render after a labelled divider ("Ready-made text") so the nine
// otherwise-flat entries scan as two groups: free elements vs auto-laid-out text blocks.
const SUGAR_KINDS: ReadonlySet<AddableKind> = new Set(['caption', 'titleCard', 'lowerThird']);

interface AddElementMenuProps {
  section: EditorSection;
  onAdd: (kind: AddableKind) => void;
}

// Estimated per-item height for the flip-up heuristic (44px touch-target rows), plus the divider
// heading and the popover padding.
const MENU_ITEM_PX = 44;
const MENU_EXTRA_PX = 40;

// The bottom edge the dropdown must not cross: the nearest scrollable ancestor's viewport (the left
// panel clips the menu well before the window does), else the window.
function clipBottom(from: HTMLElement): number {
  let node: HTMLElement | null = from.parentElement;

  while (node) {
    const { overflowY } = getComputedStyle(node);

    if (overflowY === 'auto' || overflowY === 'scroll') return node.getBoundingClientRect().bottom;

    node = node.parentElement;
  }

  return window.innerHeight;
}

export const AddElementMenu = ({ section, onAdd }: AddElementMenuProps) => {
  const { t } = useTranslation('admin');
  const [open, setOpen] = useState(false);
  // Drop the menu upward when the trigger sits too close to the viewport bottom — otherwise the
  // trailing entries (the sugar kinds) clip under the panel edge and read as missing.
  const [dropUp, setDropUp] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const kinds = addableKinds(section);
  const { ref: plusRef, hoverProps: plusHoverProps } = useIconHover();

  useEffect(() => {
    const onPointer = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;

      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;

      setOpen(false);
      // Hand focus back to the trigger so keyboard users don't drop to the document body.
      rootRef.current?.querySelector('button')?.focus();
    };

    if (open) {
      document.addEventListener('mousedown', onPointer);
      document.addEventListener('keydown', onKey);
    }

    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (kinds.length === 0) return null;

  const pick = (kind: AddableKind) => {
    onAdd(kind);
    setOpen(false);
    // The clicked menu item unmounts with the popover; without this, focus falls to <body>.
    rootRef.current?.querySelector('button')?.focus();
  };

  return (
    <div className="relative" ref={rootRef}>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('element.add')}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setDropUp(clipBottom(event.currentTarget) - rect.bottom < kinds.length * MENU_ITEM_PX + MENU_EXTRA_PX);
          setOpen((v) => !v);
        }}
        {...plusHoverProps}
      >
        <PlusIcon ref={plusRef} size={14} /> {t('element.add')}
      </Button>
      {open && (
        <div
          role="menu"
          className={cn(
            // Right-anchored: the trigger sits at the right edge of the Elements header, so a
            // left-anchored popover would overflow the 320px panel. Max-height keeps every entry
            // reachable (scroll) on short viewports.
            'absolute right-0 z-10 max-h-[min(20rem,60vh)] min-w-[12rem] overflow-auto rounded-xl border border-divider bg-surface p-1 shadow-[var(--shadow-lg)]',
            dropUp ? 'bottom-full mb-1' : 'mt-1'
          )}
        >
          {kinds.map((kind, index) => {
            const Icon = KIND_ICON[kind];
            // The divider heading sits before the FIRST sugar kind — but only when free elements
            // precede it (a sugar-only menu needs no group of one).
            const startsSugarGroup = SUGAR_KINDS.has(kind) && index > 0 && !SUGAR_KINDS.has(kinds[index - 1]);

            return (
              <div key={kind} role="presentation">
                {startsSugarGroup && (
                  <div className="mx-2 mb-1 mt-1.5 border-t border-foreground/10 pt-1.5 text-[0.65rem] font-semibold uppercase tracking-widest text-gray-400">
                    {t('element.sugarGroup')}
                  </div>
                )}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    pick(kind);
                  }}
                  className="tap flex min-h-11 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-brand-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/40"
                >
                  <MenuItemLabel kind={kind} Icon={Icon} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const MenuItemLabel = ({ kind, Icon }: { kind: AddableKind; Icon: ComponentType<{ className?: string }> }) => {
  const { t } = useTranslation('admin');
  const family = FAMILY_OF[kind];

  if (!family) {
    return (
      <>
        <Icon className="h-3.5 w-3.5 text-gray-400" aria-hidden /> {t(KIND_LABEL[kind])}
      </>
    );
  }

  return (
    <>
      <Icon className={cn('h-3.5 w-3.5 shrink-0', FAMILY_TONE[family].text)} aria-hidden />
      <span className="flex min-w-0 flex-col leading-tight">
        <span>{t(KIND_LABEL[kind])}</span>
        <span className="text-[0.65rem] text-gray-500 dark:text-gray-400">{t(`element.${kind}AddHint`)}</span>
      </span>
    </>
  );
};
