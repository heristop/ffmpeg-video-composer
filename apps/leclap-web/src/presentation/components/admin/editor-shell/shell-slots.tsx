// The three self-contained slots of TemplateEditorShell's ShellChrome — the titlebar, the program
// monitor (edit canvas or playback), and the help / starter-preset / AI / agent-confirmation overlays
// (one at a time) —
// lifted out so the shell file stays under its dependency budget. Each is a thin presentational
// wrapper; the shell owns state.
import { useState, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { ProgramMonitor } from '@/presentation/components/editor-shell';
import type { EditorSection, EditorState } from '../templateEditorModel';
import { TestRenderButton } from '../editor/TestRenderButton';
import { EditorShellTitlebar } from './EditorShellTitlebar';
import { EditorMonitor } from './EditorMonitor';
import { ShortcutCheatSheet } from './ShortcutCheatSheet';
import { StarterPresetPicker } from './StarterPresetPicker';
import type { Segment } from './program-timeline.logic';
import type { ProgramClock } from './use-program-clock';
import { ProgramPlayer } from './program-player';
import { ProgramTransport } from './program-transport';
import type { ElementRef, SectionSelectionState } from './useSectionSelection';
import type { SaveFeedback } from './save-blocker.logic';
import { setModalOpen, type ShellModal } from './shell-modals.logic';
import { GenerateWithAiButton, LazyGenerateWithAiDialog } from '../ai-generate/AiAssist';
import { AgentActivity } from '../agent/AgentActivity';
import { AgentConfirmDialog } from '../agent/AgentConfirmDialog';
import type { BuilderAgent } from '../agent/use-builder-agent';

export { SceneRenderScope } from '../editor/scene-render-context';

interface ShellTitlebarProps {
  state: EditorState;
  onNameChange: (name: string) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onCancel: () => void;
  backLabel?: string;
  onSave: () => void;
  onSaveAndCompile?: () => void;
  feedback: SaveFeedback | null;
  nameInvalid: boolean;
  nameRef: Ref<HTMLInputElement>;
  // Opens Generate with AI; the titlebar shows its button only when given.
  onGenerate?: () => void;
  // Browser agents (WebMCP): the pill shows only when the browser can host tools.
  agent?: BuilderAgent;
}

export const ShellTitlebar = ({
  state,
  onNameChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onCancel,
  backLabel,
  onSave,
  onSaveAndCompile,
  feedback,
  nameInvalid,
  nameRef,
  onGenerate,
  agent,
}: ShellTitlebarProps) => {
  const { t } = useTranslation('admin');
  const { t: tAi } = useTranslation('ai');

  return (
    <EditorShellTitlebar
      name={state.name}
      onNameChange={onNameChange}
      canUndo={canUndo}
      canRedo={canRedo}
      onUndo={onUndo}
      onRedo={onRedo}
      onCancel={onCancel}
      backLabel={backLabel}
      onSave={onSave}
      onSaveAndCompile={onSaveAndCompile}
      feedback={feedback}
      nameInvalid={nameInvalid}
      nameRef={nameRef}
      preview={<TestRenderButton state={state} disabled={state.sections.length === 0} preview={agent?.preview} />}
      assist={onGenerate ? <GenerateWithAiButton onClick={onGenerate} t={tAi} /> : undefined}
      agent={agent ? <AgentActivity agent={agent} /> : undefined}
      t={t}
    />
  );
};

interface ShellMonitorProps {
  state: EditorState;
  selectedIndex: number;
  selectedSection: EditorSection | null;
  onPatchSection: (patch: Partial<EditorSection>) => void;
  selection: SectionSelectionState;
  onSelectElement: (ref: ElementRef | null) => void;
  onBeginEdit: () => void;
  onEndEdit: () => void;
  clock: ProgramClock;
  playTimeline: Segment[];
  playMode: boolean;
}

// Play mode swaps the WYSIWYG edit canvas for the playback surface; the transport only shows once
// there is a non-empty timeline to scrub.
export const ShellMonitor = ({
  state,
  selectedIndex,
  selectedSection,
  onPatchSection,
  selection,
  onSelectElement,
  onBeginEdit,
  onEndEdit,
  clock,
  playTimeline,
  playMode,
}: ShellMonitorProps) => {
  const { t } = useTranslation('admin');

  return (
    <ProgramMonitor
      label={playMode ? t('monitor.playing') : t('shell.preview')}
      meta={t(`orientationLabel.${state.orientation}`)}
      swapKey={playMode ? 'play' : String(selectedIndex)}
      transport={playTimeline.length > 0 ? <ProgramTransport clock={clock} timeline={playTimeline} /> : undefined}
    >
      {playMode ? (
        <ProgramPlayer state={state} clock={clock} timeline={playTimeline} />
      ) : (
        <EditorMonitor
          state={state}
          section={selectedSection}
          onPatchSection={onPatchSection}
          selection={selection}
          onSelectElement={onSelectElement}
          onBeginEdit={onBeginEdit}
          onEndEdit={onEndEdit}
        />
      )}
    </ProgramMonitor>
  );
};

export interface ShellModalState {
  // The one overlay showing (help, starter presets, the AI drawer or an agent confirmation), or null.
  active: ShellModal | null;
  // Shows `kind`, closing whichever overlay was up: overlays never stack.
  open: (kind: ShellModal) => void;
  // Closes `kind` if it is still the one showing.
  close: (kind: ShellModal) => void;
  // Controlled-component adapter for an overlay's onOpenChange.
  setOpen: (kind: ShellModal, open: boolean) => void;
  // Any overlay open: the editor's global shortcuts stand down so keys act on it.
  anyOpen: boolean;
}

export function useShellModals(presetsInitiallyOpen: boolean): ShellModalState {
  const [active, setActive] = useState<ShellModal | null>(presetsInitiallyOpen ? 'presets' : null);
  const setOpen = (kind: ShellModal, open: boolean): void => {
    setActive((current) => setModalOpen(current, kind, open));
  };

  return {
    active,
    open: (kind) => {
      setOpen(kind, true);
    },
    close: (kind) => {
      setOpen(kind, false);
    },
    setOpen,
    anyOpen: active !== null,
  };
}

interface ShellModalsProps {
  modals: ShellModalState;
  reset: (state: EditorState) => void;
  // The draft has edits: loading a generated template asks before replacing it.
  canUndo: boolean;
  // A browser agent's pending confirmation shows as the 'agent' overlay.
  agent?: Pick<BuilderAgent, 'confirm' | 'answer'>;
}

export const ShellModals = ({ modals, reset, canUndo, agent }: ShellModalsProps) => (
  <>
    <ShortcutCheatSheet
      open={modals.active === 'help'}
      onClose={() => {
        modals.close('help');
      }}
    />
    <StarterPresetPicker
      open={modals.active === 'presets'}
      onPick={(preset) => {
        reset(preset.build());
        modals.close('presets');
      }}
      onBlank={() => {
        modals.close('presets');
      }}
      onGenerate={() => {
        // Swaps the picker for the AI drawer (one overlay at a time).
        modals.open('ai');
      }}
    />
    <LazyGenerateWithAiDialog
      open={modals.active === 'ai'}
      onOpenChange={(open) => {
        modals.setOpen('ai', open);
      }}
      hasUnsavedWork={canUndo}
      onLoad={reset}
    />
    {agent ? <AgentConfirmDialog agent={agent} /> : null}
  </>
);
