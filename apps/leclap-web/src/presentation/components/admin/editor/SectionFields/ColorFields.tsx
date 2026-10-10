// Field block for a color_background section. Essentials (always visible): duration. The per-element
// editors (background layers, animations) now live in the left panel's element inspector; finishing
// controls (Effects, Section audio, Sound effects) live in collapsed disclosures that only appear in Advanced mode.
import { Type } from '@/presentation/components/icons';
import { SparklesIcon } from '@/presentation/components/icons/sparkles';
import { useTranslation } from 'react-i18next';
import type { EditorSection, Orientation } from '../../templateEditorModel';
import { SectionDisclosure } from '../SectionDisclosure';
import { useIsAdvanced } from '../useBuilderMode';
import { effectsSummary } from '../sectionHints';
import { MotionPanel } from '../MotionPanel';
import { NumberField } from './NumberField';
import { SectionSoundDisclosures } from './section-sound-disclosures';
import { TitleCardField } from './TitleCardField';
import { VisualEffects } from './VisualEffects';

type ColorSection = Extract<EditorSection, { kind: 'color' }>;

interface ColorFieldsProps {
  section: ColorSection;
  orientation: Orientation;
  variables: string[];
  onChange: (p: Partial<EditorSection>) => void;
  inputCls: string;
}

export const ColorFields = ({ section, variables, onChange, inputCls }: ColorFieldsProps) => {
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
      <SectionDisclosure
        label={t('disclosure.titleCard')}
        icon={<Type className="size-4 shrink-0 text-brand-500" aria-hidden />}
        summary={section.titleCard?.headline?.en ?? section.titleCard?.kicker?.en ?? t('titleCard.summaryEmpty')}
      >
        <TitleCardField
          titleCard={section.titleCard}
          onChange={(titleCard) => {
            onChange({ titleCard });
          }}
          variables={variables}
          inputCls={inputCls}
        />
      </SectionDisclosure>
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
