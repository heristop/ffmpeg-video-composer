import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { SectionFields } from '../editor/SectionFields';
import { AudioPanel } from '../editor/AudioPanel';
import { GlobalVariablesEditor } from '../editor/GlobalVariablesEditor';
import { PaletteAndTheme } from '../editor/palette-and-theme';
import { WholeVideoAnimations } from '../editor/WholeVideoAnimations';
import { WholeVideoLookGrade } from '../editor/whole-video-look-grade';
import { GlobalOverlaysField } from '../editor/GlobalOverlaysField';
import { GlobalWatermarkField } from '../editor/global-watermark-field';
import { EditorImportExport } from '../editor/EditorImportExport';
import { JsonEditorPanel } from '../editor/json-editor-panel';
import { EDITOR_INPUT_CLASS } from '../editor/editorStyles';
import type { AvailablePartial } from '@/services/templatePartialService';
import { collectVariables, renderableSectionNames, type EditorSection, type EditorState } from '../templateEditorModel';
import type { EditorToolId } from './editorTools';
import { addableKinds } from './AddElementMenu';
import { ElementBlock } from './ElementBlock';
import { sectionLabelKey } from './section-label';
import { BasicsPanel } from './basics-panel';
import type { ElementRef, SectionSelectionState } from './useSectionSelection';

// True when the section owns any addable visual element (video/color/image), so the left panel hosts
// the unified Add menu + element list + inspector below the section-level fields.
const hasElements = (section: EditorSection): boolean => addableKinds(section).length > 0;

interface EditorPanelSwitchProps {
  activeTool: EditorToolId;
  state: EditorState;
  section: EditorSection | null;
  partials: AvailablePartial[];
  patch: (p: Partial<EditorState>) => void;
  patchSection: (p: Partial<EditorSection>) => void;
  onImport: (next: EditorState) => void;
  selection: SectionSelectionState;
  onSelectElement: (ref: ElementRef | null) => void;
}

// A panel shell: an eyebrow + title header above a swap-animated body, matching the studio panel chrome.
// The header is pinned (shrink-0) and compacts on short viewports so the scrollable body keeps as much
// height as possible; overscroll stays contained so panel scroll never chains into the page.
const PanelFrame = ({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) => (
  <div className="flex min-h-0 flex-1 flex-col">
    <header className="shrink-0 border-b border-brand-500/20 bg-brand-500/10 px-4 py-3 [@media(max-height:700px)]:py-2">
      <span className="block text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-brand-600 dark:text-brand-300">
        {eyebrow}
      </span>
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
    </header>
    <div className="panel-swap min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 pb-6 [scrollbar-width:thin] motion-reduce:animate-none [@media(max-height:700px)]:p-3 [@media(max-height:700px)]:pb-5">
      {children}
    </div>
  </div>
);

// A muted placeholder body for panels whose authoring UI isn't wired into the shell yet.
const PanelPlaceholder = ({ message }: { message: string }) => (
  <p className="text-sm text-muted-foreground">{message}</p>
);

// The active tool's panel body. Early returns, no else: scenes → the selected section's fields; basics →
// name + orientation; audio → the global mix; variables/advanced → placeholders (refined later phase).
export const EditorPanelSwitch = ({
  activeTool,
  state,
  section,
  partials,
  patch,
  patchSection,
  onImport,
  selection,
  onSelectElement,
}: EditorPanelSwitchProps) => {
  const { t } = useTranslation('admin');

  if (activeTool === 'scenes') {
    if (!section) {
      return (
        <PanelFrame eyebrow={t('shell.tools')} title={t('shell.scenes')}>
          <PanelPlaceholder message={t('shell.monitorEmpty')} />
        </PanelFrame>
      );
    }

    return (
      <PanelFrame eyebrow={t('shell.scenes')} title={t(sectionLabelKey(section.kind))}>
        <SectionFields
          section={section}
          orientation={state.orientation}
          variables={collectVariables(state)}
          partials={partials}
          onChange={patchSection}
          inputCls={EDITOR_INPUT_CLASS}
        />
        {hasElements(section) && (
          <ElementBlock
            state={state}
            section={section}
            selection={selection}
            patchSection={patchSection}
            onSelectElement={onSelectElement}
          />
        )}
      </PanelFrame>
    );
  }

  if (activeTool === 'basics') {
    return (
      <PanelFrame eyebrow={t('shell.tools')} title={t('shell.basics')}>
        <BasicsPanel state={state} patch={patch} />
      </PanelFrame>
    );
  }

  if (activeTool === 'audio') {
    return (
      <PanelFrame eyebrow={t('shell.tools')} title={t('shell.audio')}>
        <AudioPanel
          audio={state.audio}
          onChange={(audio) => {
            patch({ audio });
          }}
        />
      </PanelFrame>
    );
  }

  if (activeTool === 'variables') {
    return (
      <PanelFrame eyebrow={t('shell.tools')} title={t('shell.variables')}>
        <GlobalVariablesEditor state={state} patch={patch} />
      </PanelFrame>
    );
  }

  return (
    <PanelFrame eyebrow={t('shell.tools')} title={t('shell.advanced')}>
      <div className="space-y-4">
        <PaletteAndTheme state={state} patch={patch} />
        <WholeVideoLookGrade state={state} patch={patch} />
        <WholeVideoAnimations state={state} patch={patch} />
        <GlobalWatermarkField watermark={state.watermark} patch={patch} />
        <GlobalOverlaysField
          overlays={state.globalOverlays}
          variables={collectVariables(state)}
          sectionNames={renderableSectionNames(state.sections)}
          patch={patch}
        />
        <EditorImportExport state={state} onImport={onImport} />
        <JsonEditorPanel state={state} onImport={onImport} />
      </div>
    </PanelFrame>
  );
};
