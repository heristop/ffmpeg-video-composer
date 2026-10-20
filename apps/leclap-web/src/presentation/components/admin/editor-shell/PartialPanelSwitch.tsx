import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Info } from '@/presentation/components/icons';
import { CopyIcon } from '@/presentation/components/icons/copy';
import { useIconHover } from '@/presentation/components/icons/useIconHover';
import { Button } from '@/presentation/components/ui';
import { SectionFields } from '../editor/SectionFields';
import { EDITOR_INPUT_CLASS } from '../editor/editorStyles';
import type { AvailablePartial } from '@/services/templatePartialService';
import { collectVariables, type EditorSection, type EditorState } from '../templateEditorModel';
import type { PartialToolId } from './usePartialEditorState';
import { addableKinds } from './AddElementMenu';
import { ElementBlock } from './ElementBlock';
import type { ElementRef, SectionSelectionState } from './useSectionSelection';
import { sectionLabelKey } from './section-label';
import { PanelFrame } from './panel-frame';

// True when the section owns any addable visual element, so the left panel hosts the unified Add menu
// + element list + inspector below the section-level fields.
const hasElements = (section: EditorSection): boolean => addableKinds(section).length > 0;

interface PartialPanelSwitchProps {
  activeTool: PartialToolId;
  state: EditorState;
  section: EditorSection | null;
  partials: AvailablePartial[];
  readonly: boolean;
  idLocked: boolean;
  patch: (p: Partial<EditorState>) => void;
  patchSection: (p: Partial<EditorSection>) => void;
  selection: SectionSelectionState;
  onSelectElement: (ref: ElementRef | null) => void;
  onDuplicate: () => void;
}

const PanelPlaceholder = ({ message }: { message: string }) => (
  <p className="text-sm text-muted-foreground">{message}</p>
);

// What a built-in shows instead of fields: why it can't be edited, and the way to a copy that can.
const ReadonlyNotice = ({ onDuplicate }: { onDuplicate: () => void }) => {
  const { t } = useTranslation('admin');
  const { ref, hoverProps } = useIconHover();

  return (
    <div className="rounded-xl border border-foreground/10 bg-surface-2/40 p-4">
      <p className="flex gap-2.5 text-sm leading-relaxed text-muted-foreground">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-brand-300" />
        <span className="text-pretty">{t('shell.partialReadonly')}</span>
      </p>
      <Button variant="secondary" size="sm" className="mt-3 min-h-10 w-full" onClick={onDuplicate} {...hoverProps}>
        <CopyIcon ref={ref} size={16} /> {t('card.duplicate')}
      </Button>
    </div>
  );
};

const PARTIAL_LABEL = 'mb-1 block text-xs font-semibold uppercase tracking-widest text-muted-foreground';

const PartialBasics = ({
  state,
  readonly,
  idLocked,
  patch,
}: Pick<PartialPanelSwitchProps, 'state' | 'readonly' | 'idLocked' | 'patch'>) => {
  const { t } = useTranslation('admin');
  const id = useId();

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor={`${id}-id`} className={PARTIAL_LABEL}>
          {t('shell.partialNameLabel')}
        </label>
        <input
          id={`${id}-id`}
          className={EDITOR_INPUT_CLASS}
          value={state.id}
          disabled={idLocked || readonly}
          placeholder="local:intro"
          spellCheck={false}
          onChange={(e) => {
            patch({ id: e.target.value, name: e.target.value });
          }}
        />
      </div>
      <div>
        <label htmlFor={`${id}-description`} className={PARTIAL_LABEL}>
          {t('shell.partialDescription')}
        </label>
        <input
          id={`${id}-description`}
          className={EDITOR_INPUT_CLASS}
          value={state.description}
          disabled={readonly}
          placeholder={t('shell.partialDescriptionPlaceholder')}
          onChange={(e) => {
            patch({ description: e.target.value });
          }}
        />
      </div>
    </div>
  );
};

// The partial editor's panel body. scenes → the selected section's fields (a built-in explains itself
// and offers a copy instead); basics → the partial id + description (id disabled once saved).
export const PartialPanelSwitch = ({
  activeTool,
  state,
  section,
  partials,
  readonly,
  idLocked,
  patch,
  patchSection,
  selection,
  onSelectElement,
  onDuplicate,
}: PartialPanelSwitchProps) => {
  const { t } = useTranslation('admin');

  if (activeTool === 'basics') {
    return (
      <PanelFrame title={t('shell.basics')}>
        <PartialBasics state={state} readonly={readonly} idLocked={idLocked} patch={patch} />
      </PanelFrame>
    );
  }

  if (!section) {
    return (
      <PanelFrame title={t('shell.scenes')}>
        <PanelPlaceholder message={t('shell.monitorEmpty')} />
      </PanelFrame>
    );
  }

  const title = t(sectionLabelKey(section.kind));

  if (readonly) {
    return (
      <PanelFrame title={title}>
        <ReadonlyNotice onDuplicate={onDuplicate} />
      </PanelFrame>
    );
  }

  return (
    <PanelFrame title={title}>
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
};
