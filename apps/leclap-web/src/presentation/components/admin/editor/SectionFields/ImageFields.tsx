// Field block for an image_background section. Essentials (always visible): duration + the media
// picker (allowed images + upload). Finishing controls (Effects incl. Ken Burns motion, Section
// audio) live in collapsed disclosures that only appear in Advanced mode.
import { SparklesIcon } from '@/presentation/components/icons/sparkles';
import { useTranslation } from 'react-i18next';
import { Checkbox } from '@/presentation/components/ui';
import type { EditorSection, Orientation } from '../../templateEditorModel';
import { MediaPicker } from '../../MediaPicker';
import { MotionPanel } from '../MotionPanel';
import { SectionDisclosure } from '../SectionDisclosure';
import { useIsAdvanced } from '../useBuilderMode';
import { effectsSummary } from '../sectionHints';
import { NumberField } from './NumberField';
import { FitField } from './fit-field';
import { SectionSoundDisclosures } from './section-sound-disclosures';
import { VisualEffects } from './VisualEffects';

type ImageSection = Extract<EditorSection, { kind: 'image' }>;

interface ImageFieldsProps {
  section: ImageSection;
  orientation: Orientation;
  onChange: (p: Partial<EditorSection>) => void;
  inputCls: string;
}

export const ImageFields = ({ section, onChange, inputCls }: ImageFieldsProps) => {
  const { t } = useTranslation('admin');
  const advanced = useIsAdvanced();

  return (
    <div className="space-y-3">
      <div className="sm:w-40">
        <NumberField
          label={t('video.duration', { count: section.duration })}
          value={section.duration}
          onChange={(duration) => {
            onChange({ duration });
          }}
          inputCls={inputCls}
        />
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400">{t('image.pickImages')}</p>
      <MediaPicker
        kind="picture"
        selectedId={section.allowed.at(0) ?? null}
        onSelectId={(id) => {
          onChange({ allowed: id ? [id] : [] });
        }}
      />
      <label className="flex w-fit items-center gap-2 text-sm text-gray-700 cursor-pointer select-none dark:text-gray-200">
        <Checkbox
          checked={section.allowUpload}
          onCheckedChange={(c) => {
            onChange({ allowUpload: c === true });
          }}
        />
        {t('image.allowUpload')}
      </label>
      <FitField
        fit={section.fit}
        onChange={(fit) => {
          onChange({ fit });
        }}
      />
      {advanced && (
        <div className="space-y-2">
          <SectionDisclosure
            label={t('disclosure.effects')}
            icon={<SparklesIcon size={16} className="shrink-0 text-brand-500" aria-hidden />}
            summary={effectsSummary(t, section.look, section.motion, section.letterbox)}
          >
            <MotionPanel
              motion={section.motion}
              onChange={(motion) => {
                onChange({ motion });
              }}
            />
            <VisualEffects
              look={section.look}
              grade={section.grade}
              letterbox={section.letterbox}
              onLook={(look) => {
                onChange({ look });
              }}
              onGrade={(grade) => {
                onChange({ grade });
              }}
              onLetterbox={(letterbox) => {
                onChange({ letterbox });
              }}
            />
          </SectionDisclosure>
          <SectionSoundDisclosures section={section} onChange={onChange} inputCls={inputCls} />
        </div>
      )}
    </div>
  );
};
