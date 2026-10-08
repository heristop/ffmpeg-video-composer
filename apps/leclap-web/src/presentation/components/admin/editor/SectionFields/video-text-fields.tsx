// Text drawn over a video scene's footage: the lower-third band and the pinned captions (shown only
// once a transcription pinned words into the scene).
import { useTranslation } from 'react-i18next';
import { Type } from '@/presentation/components/icons';
import type { EditorSection } from '../../templateEditorModel';
import { SectionDisclosure } from '../SectionDisclosure';
import { LowerThirdField } from './LowerThirdField';
import { PinnedCaptionsField } from './pinned-captions-field';

type VideoSection = Extract<EditorSection, { kind: 'video' }>;

interface VideoTextFieldsProps {
  section: VideoSection;
  variables: string[];
  onChange: (p: Partial<EditorSection>) => void;
  inputCls: string;
}

export const VideoTextFields = ({ section, variables, onChange, inputCls }: VideoTextFieldsProps) => {
  const { t } = useTranslation('admin');

  return (
    <>
      <SectionDisclosure
        label={t('disclosure.lowerThird')}
        icon={<Type className="size-4 shrink-0 text-brand-500" aria-hidden />}
        summary={section.lowerThird?.title?.en ?? section.lowerThird?.badge?.en ?? t('lowerThird.summaryEmpty')}
      >
        <LowerThirdField
          lowerThird={section.lowerThird}
          onChange={(lowerThird) => {
            onChange({ lowerThird });
          }}
          variables={variables}
          inputCls={inputCls}
        />
      </SectionDisclosure>
      <PinnedCaptionsField
        subtitles={section.subtitles}
        onChange={(subtitles) => {
          onChange({ subtitles });
        }}
      />
    </>
  );
};
