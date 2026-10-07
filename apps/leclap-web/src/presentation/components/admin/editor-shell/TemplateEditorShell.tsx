import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Monitor } from '@/presentation/components/icons';
import { ShellChrome, ToolDock, type ViewTab } from '@/presentation/components/editor-shell';
import { ColorVariablesProvider } from '@/presentation/components/ui';
import type { Template } from '@/services/templateService';
import { userPartialService } from '@/services/userPartialService';
import { listAvailablePartials } from '@/services/templatePartialService';
import type { StoredTemplate } from '@/stores/userTemplateStore';
import { useEditorHistory } from '@/hooks/useEditorHistory';
import { useEditorShortcuts } from '@/hooks/useEditorShortcuts';
import { useEditorSectionOps } from '../editor/useEditorSectionOps';
import { toEditorState, type EditorSection } from '../templateEditorModel';
import { buildEditorTools, nextTool, prevTool } from './editorTools';
import { useEditorSelection, indexAfterReorder } from './useEditorSelection';
import { useSectionSelection } from './useSectionSelection';
import { EditorPanelSwitch } from './EditorPanelSwitch';
import { EditorSceneTimeline } from './EditorSceneTimeline';
import { useBuilderAgent, useProgramMonitor, useTemplatePersistence } from './use-template-editor-shell';
import { ShellTitlebar, ShellMonitor, ShellModals, useShellModals, SceneRenderScope } from './shell-slots';
import { sectionLabelKey, sectionTitle } from './section-label';

interface TemplateEditorShellProps {
  initial: Template | null;
  onSaved: (saved: StoredTemplate) => void;
  onCancel: () => void;
  // Where Back (onCancel) returns to, named in the titlebar; defaults to the templates list.
  backLabel?: string;
  // When provided, a "Save & film →" CTA is shown that saves the template and immediately
  // launches the Builder wizard — skipping the gallery entirely.
  onSaveAndCompile?: (saved: StoredTemplate) => void;
}

// The template-authoring editor re-housed inside the studio shell. Reuses the exact same state hooks as
// the legacy TemplateEditor (useEditorHistory + useEditorSectionOps), composing them — plus the shell's
// own program-monitor + persistence hooks — into the shared dock·panel·monitor·timeline frame.
// Phone surface tabs for the authoring shell: the editing panel, named for the tool it will show, and
// the program monitor. Built outside the component so it doesn't spend the shell's statement budget.
const buildViewTabs = (
  tools: ReturnType<typeof buildEditorTools>,
  activeTool: string,
  t: (key: string) => string
): [ViewTab, ViewTab] => {
  const active = tools.find((tool) => tool.id === activeTool) ?? tools[0];

  return [
    { id: 'panel', icon: active.icon, label: t(active.labelKey) },
    { id: 'monitor', icon: Monitor, label: t('shell.preview') },
  ];
};

export const TemplateEditorShell = ({
  initial,
  onSaved,
  onCancel,
  backLabel,
  onSaveAndCompile,
}: TemplateEditorShellProps) => {
  const { t } = useTranslation('admin');
  const history = useEditorHistory(toEditorState(initial));
  const { state, set, undo, redo, canUndo, canRedo, reset } = history;
  const ops = useEditorSectionOps(set);
  const { patch, patchSection, addSection, removeSection, duplicateSection, reorder, setTransition } = ops;
  const [localPartials] = useState(() => userPartialService.list());
  // Help, starter presets and Generate with AI. Cold start (building from scratch) opens the presets.
  const modals = useShellModals(initial === null);

  // Selection state for the shell (which tool + which scene), clamped to a valid section index; plus
  // the shared text-overlay selection threaded to both the canvas and the inspector, keyed by scene.
  const [sel, dispatch] = useEditorSelection({ activeTool: 'scenes', selectedIndex: 0 });
  const sectionSelection = useSectionSelection(String(sel.selectedIndex));
  const monitor = useProgramMonitor(state);
  // Browser agents (WebMCP): tools over this history/selection, an activity pill and its confirmations.
  const agent = useBuilderAgent({ history, selectedIndex: sel.selectedIndex, dispatch, modals, localPartials });
  const save = useTemplatePersistence({
    state,
    t,
    onSaved,
    onSaveAndCompile,
    onShowScene: (index) => {
      dispatch({ type: 'selectScene', index });
    },
  });

  useEffect(() => {
    dispatch({ type: 'clamp', count: state.sections.length });
  }, [state.sections.length, dispatch]);

  // All tools shown for now — the Simple/Advanced mode toggle isn't surfaced in the shell yet.
  const tools = buildEditorTools({ advanced: true });
  const selectedSection: EditorSection | null = state.sections[sel.selectedIndex] ?? null;

  const addEditorSection = (kind: EditorSection['kind']): void => {
    addSection(kind);
    dispatch({ type: 'selectScene', index: state.sections.length });
  };

  // Reorder keeps the section you were viewing selected (the preview must NOT jump to the dragged card):
  // re-point the selection at wherever that section lands after the move.
  const reorderScenes = (from: number, to: number): void => {
    reorder(from, to);
    dispatch({ type: 'selectScene', index: indexAfterReorder(sel.selectedIndex, from, to) });
  };

  const selectSceneClamped = (index: number): void => {
    const last = state.sections.length - 1;
    dispatch({ type: 'selectScene', index: Math.max(0, Math.min(index, last)) });
  };

  // Global editor keyboard shortcuts (see useEditorShortcuts). Disabled while the cheat sheet is open so
  // the dialog owns Escape and stray keys don't act on scenes behind it.
  useEditorShortcuts({
    onUndo: undo,
    onRedo: redo,
    onSave: save.handleSave,
    onDeleteScene: () => {
      // While a canvas element is selected, Delete/Backspace belongs to the element (its own focused
      // handlers act on it) — never nuke the whole scene out from under that intent.
      if (sectionSelection.state.element) return;
      removeSection(sel.selectedIndex);
    },
    onDuplicateScene: () => {
      duplicateSection(sel.selectedIndex);
    },
    onAddScene: () => {
      addEditorSection('video');
    },
    onNextScene: () => {
      selectSceneClamped(sel.selectedIndex + 1);
    },
    onPrevScene: () => {
      selectSceneClamped(sel.selectedIndex - 1);
    },
    onNextTool: () => {
      dispatch({ type: 'selectTool', tool: nextTool(tools, sel.activeTool) });
    },
    onPrevTool: () => {
      dispatch({ type: 'selectTool', tool: prevTool(tools, sel.activeTool) });
    },
    onTogglePlay: () => {
      monitor.clock.toggle();
    },
    onShowHelp: () => {
      modals.open('help');
    },
    // The help dialog closes itself on Escape (Radix); this fires with it closed — exit play mode.
    onDismissHelp: () => {
      if (monitor.playMode) monitor.exitPlayMode();
    },
    enabled: !modals.anyOpen,
  });

  return (
    // Colour fields anywhere in the shell (panels, inspectors, canvas) resolve and offer the
    // template's {{ variable }} colour tokens through this scope — including the palette's
    // 1-indexed {{ colorN }} slots, so the canvas previews mirror the engine's substitution.
    <ColorVariablesProvider variables={state.globalVariables} colorsList={state.colorsList}>
      <ShellChrome
        resizeLabel={t('shell.resizePanels')}
        viewTabs={buildViewTabs(tools, sel.activeTool, t)}
        viewTabsLabel={t('shell.mobileView')}
        panelFocusKey={`${sel.activeTool}:${String(sel.selectedIndex)}`}
        titlebar={
          <ShellTitlebar
            state={state}
            onNameChange={(value) => {
              patch({ name: value });
            }}
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={undo}
            onRedo={redo}
            onCancel={onCancel}
            backLabel={backLabel}
            onSave={save.handleSave}
            onSaveAndCompile={onSaveAndCompile ? save.handleSaveAndCompile : undefined}
            onGenerate={() => {
              modals.open('ai');
            }}
            feedback={save.feedback}
            nameInvalid={save.blocker?.kind === 'name'}
            nameRef={save.nameRef}
            agent={agent}
          />
        }
        dock={
          <ToolDock
            items={tools.map((tool) => ({ id: tool.id, icon: tool.icon, label: t(tool.labelKey) }))}
            active={sel.activeTool}
            onSelect={(id) => {
              dispatch({ type: 'selectTool', tool: id });
            }}
            ariaLabel={t('shell.tools')}
          />
        }
        panel={
          <SceneRenderScope state={state} sectionIndex={sel.selectedIndex} preview={agent.preview}>
            <EditorPanelSwitch
              activeTool={sel.activeTool}
              state={state}
              section={selectedSection}
              partials={listAvailablePartials(localPartials)}
              patch={patch}
              patchSection={(p) => {
                patchSection(sel.selectedIndex, p);
              }}
              onImport={reset}
              selection={sectionSelection.state}
              onSelectElement={sectionSelection.selectElement}
            />
          </SceneRenderScope>
        }
        monitor={
          <ShellMonitor
            state={state}
            selectedIndex={sel.selectedIndex}
            selectedSection={selectedSection}
            onPatchSection={(p) => {
              patchSection(sel.selectedIndex, p);
            }}
            selection={sectionSelection.state}
            onSelectElement={sectionSelection.selectElement}
            onBeginEdit={sectionSelection.beginEdit}
            onEndEdit={sectionSelection.endEdit}
            clock={monitor.clock}
            playTimeline={monitor.playTimeline}
            playMode={monitor.playMode}
          />
        }
        timeline={
          <EditorSceneTimeline
            sections={state.sections}
            selectedIndex={sel.selectedIndex}
            highlighted={agent.highlighted}
            onSelect={(i) => {
              // Picking a scene card returns to the edit canvas for that scene.
              if (monitor.playMode) monitor.exitPlayMode();
              dispatch({ type: 'selectScene', index: i });
            }}
            onAdd={addEditorSection}
            onDuplicate={duplicateSection}
            onDelete={removeSection}
            onReorder={reorderScenes}
            onTransition={setTransition}
            defaultTransition={state.defaultTransition}
            sectionTitle={(section) => sectionTitle(section, t)}
            sectionKindLabel={(section) => t(sectionLabelKey(section.kind))}
            onBrowsePresets={() => {
              modals.open('presets');
            }}
          />
        }
      />
      <ShellModals modals={modals} reset={reset} canUndo={canUndo} agent={agent} />
    </ColorVariablesProvider>
  );
};
