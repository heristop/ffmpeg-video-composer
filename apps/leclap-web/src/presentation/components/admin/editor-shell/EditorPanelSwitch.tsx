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
import { PanelFrame } from './panel-frame';
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
        <PanelFrame title={t('shell.scenes')}>
          <PanelPlaceholder message={t('shell.monitorEmpty')} />
        </PanelFrame>
      );
    }

    return (
      <PanelFrame
        title={t(sectionLabelKey(section.kind))}
        meta={t('shell.sceneOf', { index: state.sections.indexOf(section) + 1, count: state.sections.length })}
      >
        <SectionFields
          section={section}
          sections={state.sections}
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
      <PanelFrame title={t('shell.basics')}>
        <BasicsPanel state={state} patch={patch} />
      </PanelFrame>
    );
  }

  if (activeTool === 'audio') {
    return (
      <PanelFrame title={t('shell.audio')}>
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
      <PanelFrame title={t('shell.variables')}>
        <GlobalVariablesEditor state={state} patch={patch} />
      </PanelFrame>
    );
  }

  return (
    <PanelFrame title={t('shell.advanced')}>
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
