import { Fragment } from 'react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Copy, Move, Trash2 } from '@/presentation/components/icons';
import { SceneCell } from '@/presentation/components/editor-shell';
import { usePointerReorder } from '@/presentation/components/editor-shell/usePointerReorder';
import { SECTION_ICON, type SectionKind } from '@/lib/sectionMeta';
import { displayFromTokens } from '@/lib/variableSyntax';
import type { DefaultTransition, EditorSection, SectionTransition } from '../templateEditorModel';
import { TransitionPicker } from '../editor/TransitionPicker';
import { AddSceneMenu } from './AddSceneMenu';
import { isPristineTimeline } from './timelinePristine';
import { cn } from '@/lib/utils';

interface EditorSceneTimelineProps {
  sections: EditorSection[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onAdd: (kind: SectionKind) => void;
  onDuplicate: (index: number) => void;
  onDelete: (index: number) => void;
  onReorder: (from: number, to: number) => void;
  onTransition: (index: number, transition: SectionTransition | undefined) => void;
  // The template-wide default transition unset boundaries inherit — the chips show it as the
  // effective transition so the lane never claims "Cut" while the render fades.
  defaultTransition?: DefaultTransition;
  sectionTitle: (section: EditorSection, index: number) => string;
  sectionKindLabel: (section: EditorSection) => string;
  // Restricts the add-scene menu to these kinds (partials allow only video/form/color/image).
  addKinds?: readonly SectionKind[];
  // When set, an untouched cold-start timeline shows a "browse starter templates" hint that calls this.
  onBrowsePresets?: () => void;
  // Scenes a browser agent just changed: ringed for a moment (a static ring under reduced motion).
  highlighted?: ReadonlySet<number>;
}

const VISUAL_KINDS: ReadonlySet<EditorSection['kind']> = new Set(['video', 'color', 'image']);

// True when section `i` is visual AND some later section is visual too — the boundary that earns a
// transition control. The last visual section never gets one (the validator rejects a dangling one).
const hasVisualAfter = (sections: EditorSection[], i: number): boolean =>
  VISUAL_KINDS.has(sections[i].kind) && sections.slice(i + 1).some((s) => VISUAL_KINDS.has(s.kind));

// Stable per-section key so framer `layout` can FLIP-animate cards as they reorder. The reorder op moves
// the same section objects, so a WeakMap id stays stable across moves (lets the spring track each card).
const sceneKeys = new WeakMap<EditorSection, string>();
let sceneKeyCounter = 0;
const keyOf = (section: EditorSection): string => {
  const existing = sceneKeys.get(section);

  if (existing) return existing;

  const key = `scene-${(sceneKeyCounter += 1)}`;
  sceneKeys.set(section, key);

  return key;
};

// Snappy spring for the make-room reflow as cards slide aside.
const REORDER_SPRING = { type: 'spring' as const, stiffness: 700, damping: 42 };

// Ghost/skeleton placeholder marking the drop slot while a card is carried; matches a SceneCell's
// footprint (poster + eyebrow + title) so the lane keeps its rhythm as cards spring around it.
const SceneSkeleton = () => (
  <motion.div
    layout
    initial={{ opacity: 0, scale: 0.96 }}
    animate={{ opacity: 1, scale: 1 }}
    transition={REORDER_SPRING}
    aria-hidden
    className="flex w-28 shrink-0 flex-col gap-1.5 rounded-xl border-2 border-dashed border-brand-400/70 bg-brand-500/10 p-2 sm:w-32"
  >
    <div className="h-16 w-full rounded-lg bg-brand-500/15" />
    <div className="h-2 w-1/2 rounded bg-foreground/10" />
    <div className="h-3 w-3/4 rounded bg-foreground/15" />
  </motion.div>
);

// The bottom scene lane for the template editor: one SceneCell per section in order, drag-reorderable
// with pointer events (mouse + touch via usePointerReorder) — the cards spring aside (framer `layout`)
// and the dragged card shows as a ghost placeholder at its drop slot. Per-cell duplicate/delete on the
// active cell, inline transition pickers between visual sections, and a kind picker to add scenes.
export const EditorSceneTimeline = ({
  sections,
  selectedIndex,
  onSelect,
  onAdd,
  onDuplicate,
  onDelete,
  onReorder,
  onTransition,
  defaultTransition,
  sectionTitle,
  sectionKindLabel,
  addKinds,
  onBrowsePresets,
  highlighted,
}: EditorSceneTimelineProps) => {
  const { t } = useTranslation('admin');
  const { containerRef, draggingIndex, overIndex, itemPointerDown } = usePointerReorder(onReorder);
  const canDelete = sections.length > 1;
  const pristine = Boolean(onBrowsePresets) && isPristineTimeline(sections);

  return (
    <div
      ref={containerRef}
      role="toolbar"
      aria-label={t('shell.scenes')}
      className="track-edge-fade flex flex-1 items-stretch gap-2 overflow-x-auto overscroll-x-contain px-3 py-2.5 [scrollbar-width:thin]"
    >
      {/* Tells the user the cards are reorderable; hidden mid-drag to declutter, and on phones, where
          it would take a third of the strip from the scenes themselves. */}
      {sections.length > 1 && draggingIndex === null && (
        <span className="hidden shrink-0 select-none items-center gap-1.5 self-center pr-1 text-[0.62rem] font-semibold uppercase tracking-wide text-gray-500 sm:flex">
          <Move className="size-3.5" aria-hidden />
          {t('shell.dragToReorder')}
        </span>
      )}
      {sections.map((section, i) => {
        // The carried card is lifted out of flow + glued to the pointer by the hook (layout off so framer
        // doesn't fight its fixed position); a skeleton marks where it will drop and the rest spring aside.
        const carried = draggingIndex === i;
        const ringed = highlighted?.has(i) === true;

        return (
          <Fragment key={keyOf(section)}>
            {draggingIndex !== null && !carried && overIndex === i && <SceneSkeleton />}
            <motion.div
              layout={!carried}
              transition={REORDER_SPRING}
              data-reorder-index={i}
              data-agent-highlight={ringed ? '' : undefined}
              onPointerDown={itemPointerDown(i)}
              className={cn(
                'cursor-grab touch-pan-x rounded-xl active:cursor-grabbing',
                ringed && 'agent-highlight ring-2 ring-brand-400 ring-offset-2 ring-offset-background'
              )}
            >
              <SceneCell
                index={i}
                role="button"
                title={displayFromTokens(sectionTitle(section, i))}
                eyebrow={sectionKindLabel(section)}
                icon={SECTION_ICON[section.kind]}
                active={i === selectedIndex}
                tabIndex={i === selectedIndex ? 0 : -1}
                onSelect={() => {
                  onSelect(i);
                }}
                trailing={
                  i === selectedIndex ? (
                    <CellActions
                      canDelete={canDelete}
                      onDuplicate={() => {
                        onDuplicate(i);
                      }}
                      onDelete={() => {
                        onDelete(i);
                      }}
                      t={t}
                    />
                  ) : undefined
                }
              />
            </motion.div>
            {/* Transition chips are hidden mid-drag; `layout` springs the gap closed so it stays smooth. */}
            {draggingIndex === null && hasVisualAfter(sections, i) && (
              <span className="grid shrink-0 place-items-center" aria-label={t('shell.transitionAfter')}>
                <TransitionPicker
                  transition={'transitionAfter' in section ? section.transitionAfter : undefined}
                  defaultTransition={defaultTransition}
                  onChange={(transition) => {
                    onTransition(i, transition);
                  }}
                />
              </span>
            )}
          </Fragment>
        );
      })}
      <motion.div layout transition={REORDER_SPRING} className="flex">
        <AddSceneMenu onAdd={onAdd} kinds={addKinds} />
      </motion.div>
      {/* Cold-start guidance: while the lane is the untouched default, point at the add-scene menu and
          offer the starter-preset picker again. Disappears at the first real edit. */}
      {pristine && (
        <div className="flex shrink-0 select-none flex-col justify-center gap-0.5 self-stretch rounded-xl border-2 border-dashed border-foreground/15 px-4 text-xs">
          <span className="font-semibold text-gray-500">{t('shell.timelineEmptyTitle')}</span>
          <button
            type="button"
            onClick={onBrowsePresets}
            className="tap cursor-pointer text-left font-medium text-brand-600 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-brand-400"
          >
            {t('shell.timelineEmptyCta')}
          </button>
        </div>
      )}
    </div>
  );
};

interface CellActionsProps {
  canDelete: boolean;
  onDuplicate: () => void;
  onDelete: () => void;
  t: (key: string) => string;
}

// Duplicate + delete affordances overlaid on the active cell via SceneCell's `trailing` slot. The
// ::before overlays pad each 28px button toward a comfortable thumb target without growing the chip.
const CellActions = ({ canDelete, onDuplicate, onDelete, t }: CellActionsProps) => (
  <div className="absolute right-1.5 top-1.5 z-10 flex gap-1.5">
    <button
      type="button"
      aria-label={t('shell.duplicateScene')}
      onClick={onDuplicate}
      className="tap relative grid size-7 place-items-center rounded-md bg-black/55 text-white transition-colors before:absolute before:-inset-1 before:content-[''] hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
    >
      <Copy className="size-3.5" />
    </button>
    <button
      type="button"
      aria-label={t('shell.deleteScene')}
      disabled={!canDelete}
      onClick={onDelete}
      className="tap relative grid size-7 place-items-center rounded-md bg-black/55 text-white transition-colors before:absolute before:-inset-1 before:content-[''] hover:bg-[var(--color-error)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-error)]/60 disabled:pointer-events-none disabled:opacity-40"
    >
      <Trash2 className="size-3.5" />
    </button>
  </div>
);
