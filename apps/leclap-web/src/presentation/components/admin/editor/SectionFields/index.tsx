// Per-kind section field dispatcher. Picks the matching field block and threads the section patch
// through. Per-element editors (layers, overlays, animations) live in the left panel's element
// inspector now, so this dispatcher only carries SECTION-LEVEL settings.
import type { EditorSection, EditorState } from '../../templateEditorModel';
import { VideoFields } from './VideoFields';
import { ColorFields } from './ColorFields';
import { ImageFields } from './ImageFields';
import { MusicFields } from './MusicFields';
import { FormFields } from './FormFields';
import { PartialFields } from './PartialFields';
import type { AvailablePartial } from '@/services/templatePartialService';

interface SectionFieldsProps {
  section: EditorSection;
  // The template's scenes (form fields show where each answer is used).
  sections?: EditorSection[];
  orientation: EditorState['orientation'];
  variables: string[];
  partials: AvailablePartial[];
  onChange: (p: Partial<EditorSection>) => void;
  inputCls: string;
}

export const SectionFields = ({
  section,
  sections,
  orientation,
  variables,
  partials,
  onChange,
  inputCls,
}: SectionFieldsProps) => {
  if (section.kind === 'partial') {
    return (
      <PartialFields
        section={section}
        partials={partials}
        variables={variables}
        onChange={onChange}
        inputCls={inputCls}
      />
    );
  }

  if (section.kind === 'video') {
    return (
      <VideoFields
        section={section}
        orientation={orientation}
        variables={variables}
        onChange={onChange}
        inputCls={inputCls}
      />
    );
  }

  if (section.kind === 'color') {
    return (
      <ColorFields
        section={section}
        orientation={orientation}
        variables={variables}
        onChange={onChange}
        inputCls={inputCls}
      />
    );
  }

  if (section.kind === 'image') {
    return <ImageFields section={section} orientation={orientation} onChange={onChange} inputCls={inputCls} />;
  }

  if (section.kind === 'music') {
    return <MusicFields section={section} onChange={onChange} />;
  }

  return (
    <FormFields section={section} onChange={onChange} inputCls={inputCls} sections={sections} variables={variables} />
  );
};
