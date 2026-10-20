import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LayersIcon } from '@/presentation/components/icons/layers';
import { FileTextIcon } from '@/presentation/components/icons/file-text';
import type { TemplatePartial } from '@leclap/creative-kit/partials';
import { Monitor } from '@/presentation/components/icons';
import { ShellChrome, ToolDock, ProgramMonitor, type ViewTab } from '@/presentation/components/editor-shell';
import { ColorVariablesProvider } from '@/presentation/components/ui';
import type { EditorSection } from '../templateEditorModel';
import { ConfirmDialog } from '../confirm-dialog';
import { EditorMonitor } from './EditorMonitor';
import { EditorSceneTimeline } from './EditorSceneTimeline';
import { PARTIAL_PICKER_ID, PartialTitlebar } from './PartialTitlebar';
import { PartialPanelSwitch } from './PartialPanelSwitch';
import { usePartialEditorState } from './usePartialEditorState';
import { useSectionSelection } from './useSectionSelection';
import { sectionTitle } from './section-label';

const EDITABLE_PARTIAL_KINDS: readonly EditorSection['kind'][] = ['video', 'form', 'color', 'image'];

interface PartialEditorShellProps {
  initialDraft?: TemplatePartial | null;
}

// The partials authoring editor re-housed in the same studio shell as the template creator. Reuses the
// editor-shell kit (ShellChrome · ToolDock · ProgramMonitor · EditorMonitor · EditorSceneTimeline) and
// the partial draft state (via usePartialEditorState), composing them into the shared
// dock·panel·monitor·timeline frame. Built-ins are read-only; the titlebar owns picker/new/delete/save.
export const PartialEditorShell = ({ initialDraft = null }: PartialEditorShellProps) => {
  const { t } = useTranslation('admin');
  const editor = usePartialEditorState(initialDraft, t);
  const { draftState, sel, ops, dispatch } = editor;
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Shared text-overlay selection for the current section, threaded to the center canvas and the left
  // inspector (the same lift as the template shell). Keyed by section index so it resets on scene swap.
  const sectionSelection = useSectionSelection(String(sel.selectedIndex));

  const tools = [
    { id: 'scenes' as const, icon: LayersIcon, label: t('shell.scenes') },
    { id: 'basics' as const, icon: FileTextIcon, label: t('shell.basics') },
  ];

  const activeToolItem = tools.find((tool) => tool.id === editor.activeTool) ?? tools[0];
  const viewTabs: [ViewTab, ViewTab] = [
    { id: 'panel', icon: activeToolItem.icon, label: activeToolItem.label },
    { id: 'monitor', icon: Monitor, label: t('shell.preview') },
  ];

  return (
    // Colour fields anywhere in the shell resolve and offer the draft's {{ variable }} colour tokens,
    // including the {{ colorN }} slots when the partial's descriptor carries a colorsList palette.
    <ColorVariablesProvider variables={draftState.globalVariables} colorsList={draftState.colorsList}>
      <ShellChrome
        resizeLabel={t('shell.resizePanels')}
        viewTabs={viewTabs}
        viewTabsLabel={t('shell.mobileView')}
        panelFocusKey={`${editor.activeTool}:${String(sel.selectedIndex)}`}
        titlebar={
          <PartialTitlebar
            id={draftState.id}
            selected={editor.selected}
            partials={editor.partials}
            readonly={editor.readonly}
            idLocked={editor.idLocked}
            onIdChange={(value) => {
              ops.patch({ id: value, name: value });
            }}
            onPick={editor.pickPartial}
            onNew={editor.loadNew}
            onDelete={() => {
              setConfirmingDelete(true);
            }}
            onSave={editor.saveDraft}
            onDuplicate={editor.duplicateSelected}
            onBack={editor.goBack}
            t={t}
          />
        }
        dock={
          <ToolDock
            items={tools}
            active={editor.activeTool}
            onSelect={(id) => {
              dispatch({ type: 'selectTool', tool: id });
            }}
            ariaLabel={t('shell.tools')}
          />
        }
        panel={
          <>
            <PartialPanelSwitch
              activeTool={editor.activeTool}
              state={draftState}
              section={editor.selectedSection}
              partials={editor.partials}
              readonly={editor.readonly}
              idLocked={editor.idLocked}
              patch={ops.patch}
              patchSection={(p) => {
                ops.patchSection(sel.selectedIndex, p);
              }}
              selection={sectionSelection.state}
              onSelectElement={sectionSelection.selectElement}
              onDuplicate={editor.duplicateSelected}
            />
            {editor.error && (
              <p
                role="alert"
                className="border-t border-foreground/10 px-4 py-2 text-xs font-medium text-[var(--color-error)]"
              >
                {editor.error}
              </p>
            )}
          </>
        }
        monitor={
          <ProgramMonitor
            label={t('shell.preview')}
            meta={t(`orientationLabel.${draftState.orientation}`)}
            swapKey={String(sel.selectedIndex)}
          >
            <EditorMonitor
              state={draftState}
              section={editor.selectedSection}
              onPatchSection={(p) => {
                ops.patchSection(sel.selectedIndex, p);
              }}
              selection={sectionSelection.state}
              onSelectElement={sectionSelection.selectElement}
              onBeginEdit={sectionSelection.beginEdit}
              onEndEdit={sectionSelection.endEdit}
            />
          </ProgramMonitor>
        }
        timeline={
          <EditorSceneTimeline
            sections={draftState.sections}
            selectedIndex={sel.selectedIndex}
            onSelect={(i) => {
              dispatch({ type: 'selectScene', index: i });
            }}
            onAdd={editor.addEditorSection}
            onDuplicate={ops.duplicateSection}
            onDelete={ops.removeSection}
            onReorder={editor.reorderScenes}
            onTransition={ops.setTransition}
            sectionTitle={(section) => sectionTitle(section, t)}
            addKinds={EDITABLE_PARTIAL_KINDS}
          />
        }
      />
      <ConfirmDialog
        open={confirmingDelete}
        title={t('shell.partialDeleteDialog.title')}
        description={t('shell.partialDeleteDialog.description', { name: editor.selected?.id ?? '' })}
        cancelLabel={t('card.deleteDialog.cancel')}
        confirmLabel={t('shell.partialDeleteDialog.confirm')}
        onConfirm={() => {
          editor.deleteSelected();
          setConfirmingDelete(false);
        }}
        onCancel={() => {
          setConfirmingDelete(false);
        }}
        focusFallback={() => document.getElementById(PARTIAL_PICKER_ID)}
      />
    </ColorVariablesProvider>
  );
};
