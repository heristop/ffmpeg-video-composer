// "Match a reference" inside Generate with AI: analyse a reference image or clip and attach its style
// guide, which the system prompt then carries as binding keep / avoid rules (palette and pacing only).
// Optional, so it sits behind a disclosure that starts collapsed; its summary says whether a style
// guide is attached without opening it.
import { useTranslation } from 'react-i18next';
import { Button } from '@/presentation/components/ui';
import type { ReferenceStyle } from '@/infrastructure/style/analyze-reference';
import { SectionDisclosure } from '../editor/SectionDisclosure';
import { ReferenceStylePanel } from '../style-reference/ReferenceStylePanel';
import { FIELD_HELP } from './ai-form-styles';

interface ReferenceStyleSectionProps {
  attached: boolean;
  onAttach: (style: ReferenceStyle) => void;
  onDetach: () => void;
  disabled: boolean;
}

export const ReferenceStyleSection = ({ attached, onAttach, onDetach, disabled }: ReferenceStyleSectionProps) => {
  const { t } = useTranslation('ai');

  return (
    <SectionDisclosure
      label={t('reference.label')}
      summary={attached ? t('reference.summaryAttached') : t('reference.summaryNone')}
      defaultOpen={attached}
    >
      <div className="grid gap-3">
        <p className={FIELD_HELP}>{t('reference.hint')}</p>
        <ReferenceStylePanel
          applyLabel={t('reference.use')}
          onApply={onAttach}
          disabled={disabled}
          footer={
            attached && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p role="status" className="text-xs text-pretty text-foreground">
                  {t('reference.attached')}
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="min-h-10"
                  disabled={disabled}
                  onClick={onDetach}
                >
                  {t('reference.detach')}
                </Button>
              </div>
            )
          }
        />
      </div>
    </SectionDisclosure>
  );
};
