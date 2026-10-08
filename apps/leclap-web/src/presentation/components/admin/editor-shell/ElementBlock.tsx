// The unified left-panel element block shared by both panel switches: the "+ Add" menu, the
// cross-kind element list, and the per-element settings inspector, all driven by the section's shared
// selection. Section-level fields render above this; this block owns every per-element editor.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { collectVariables, type EditorSection, type EditorState } from '../templateEditorModel';
import { AddElementMenu } from './AddElementMenu';
import { ElementList } from './ElementList';
import { ElementInspector } from './ElementInspector';
import { addElement, listSectionElements, removeElement, reorderElement } from './sectionElements';
import type { ElementRef, SectionSelectionState } from './useSectionSelection';
import type { AnimationPickMode } from '../editor/animationSource';
import { htmlPreviewEnv } from './html-layer/html-layer-env';

interface ElementBlockProps {
  state: EditorState;
  section: EditorSection;
  selection: SectionSelectionState;
  patchSection: (p: Partial<EditorSection>) => void;
  onSelectElement: (ref: ElementRef | null) => void;
}

export const ElementBlock = ({ state, section, selection, patchSection, onSelectElement }: ElementBlockProps) => {
  const { t } = useTranslation('admin');
  const elements = listSectionElements(section);
  // The picker side a freshly added animation slot opens on: "Effect" and "Animation file" in the add menu
  // create the same empty slot, so the choice rides along until something is picked there.
  const [slotMode, setSlotMode] = useState<{ index: number; mode: AnimationPickMode } | null>(null);

  return (
    <div className="mt-4 space-y-3 border-t border-foreground/10 pt-4">
      {/* One header row — list label left, "+ Add" right — mirroring OverlayInspector's header so
          the label and the action that feeds the list read as a single group. A count badge keeps
          the section's element total readable even while the list scrolls off short viewports. */}
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-gray-400">
          {t('element.list')}
          {elements.length > 0 && (
            <span className="rounded-md bg-foreground/[0.06] px-1.5 py-0.5 text-[0.65rem] font-semibold normal-case tabular-nums tracking-normal text-gray-500 dark:text-gray-400">
              {elements.length}
            </span>
          )}
        </span>
        <AddElementMenu
          section={section}
          onAdd={(kind) => {
            // Orientation sizes/centres a fresh shape's raster box; other kinds ignore it.
            const added = addElement(section, kind, state.orientation);

            if (!added) return;

            if (added.ref.kind === 'animation') {
              setSlotMode({ index: added.ref.index, mode: kind === 'effect' ? 'effect' : 'file' });
            }

            patchSection(added.patch);
            onSelectElement(added.ref);
          }}
        />
      </div>
      <ElementList
        elements={elements}
        activeRef={selection.element}
        onSelect={onSelectElement}
        onDelete={(ref) => {
          onSelectElement(null);
          patchSection(removeElement(section, ref));
        }}
        onMove={(ref, delta) => {
          patchSection(reorderElement(section, ref, delta));
        }}
      />
      <ElementInspector
        section={section}
        activeRef={selection.element}
        variables={collectVariables(state)}
        orientation={state.orientation}
        theme={state.motion?.theme}
        htmlEnv={htmlPreviewEnv(state)}
        salt={state.sections.indexOf(section)}
        slotMode={slotMode}
        onPatchSection={patchSection}
        onSelectElement={onSelectElement}
      />
    </div>
  );
};
