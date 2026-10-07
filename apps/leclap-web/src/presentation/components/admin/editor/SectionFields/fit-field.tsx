// Four-way source-footage fit control shared by video and image sections: how the clip / picked
// image maps into the output frame. 'cover' (default) fills and centre-crops, 'letterbox' keeps the
// whole frame visible with pad bars, 'blur' keeps it all visible over a blurred, dimmed copy, 'off'
// skips the conform scaling entirely. Emitted as the descriptor's forceAspectRatio /
// forceOriginalAspectRatio flags or `fit: 'blur'` (see the kit's sectionFitOptions).
import { useTranslation } from 'react-i18next';
import { SegmentedControl } from '../controls';
import { SECTION_FIT_MODES, type SectionFit } from '../../templateEditorModel';

interface FitFieldProps {
  fit: SectionFit | undefined;
  onChange: (fit: SectionFit | undefined) => void;
}

export const FitField = ({ fit, onChange }: FitFieldProps) => {
  const { t } = useTranslation('admin');

  const labels: Record<SectionFit, string> = {
    cover: t('fit.cover'),
    letterbox: t('fit.letterbox'),
    blur: t('fit.blur'),
    off: t('fit.off'),
  };

  return (
    <div>
      <SegmentedControl
        label={t('fit.label')}
        value={fit ?? 'cover'}
        onChange={(value) => {
          // The default cover fit is stored as an absent field so untouched sections stay clean.
          onChange(value === 'cover' ? undefined : value);
        }}
        options={SECTION_FIT_MODES.map((mode) => ({ value: mode, label: labels[mode] }))}
      />
      <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">{t('fit.hint')}</span>
    </div>
  );
};
