// Two switches for the plan step: plan first (on by default: a small extra call that pitches three
// concepts and a beat sheet before any JSON is written), and whether to stop and review that plan
// or carry straight on. Review only means something when planning is on.
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Checkbox } from '@/presentation/components/ui';
import { FIELD_HELP, FIELD_LABEL } from './ai-form-styles';

interface PlanOptionsProps {
  planFirst: boolean;
  onPlanFirstChange: (value: boolean) => void;
  reviewPlan: boolean;
  onReviewPlanChange: (value: boolean) => void;
  disabled: boolean;
}

interface OptionProps {
  id: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled: boolean;
  label: string;
  hint: string;
}

const Option = ({ id, checked, onChange, disabled, label, hint }: OptionProps) => (
  <div className="flex items-start gap-3">
    <Checkbox
      id={id}
      checked={checked}
      disabled={disabled}
      aria-describedby={`${id}-hint`}
      className="size-5 rounded-[0.3rem] [&_svg]:size-3.5"
      onCheckedChange={(value) => {
        onChange(value === true);
      }}
    />
    <div className={disabled ? 'grid gap-1 pt-px opacity-60' : 'grid gap-1 pt-px'}>
      <label htmlFor={id} className="text-[0.8125rem] font-medium leading-tight text-foreground">
        {label}
      </label>
      <p id={`${id}-hint`} className={FIELD_HELP}>
        {hint}
      </p>
    </div>
  </div>
);

export const PlanOptions = (props: PlanOptionsProps) => {
  const { t } = useTranslation('ai');
  const id = useId();

  return (
    <fieldset className="grid gap-4">
      <legend className={FIELD_LABEL}>{t('plan.section')}</legend>
      <Option
        id={`${id}-plan`}
        checked={props.planFirst}
        onChange={props.onPlanFirstChange}
        disabled={props.disabled}
        label={t('plan.planFirst')}
        hint={t('plan.planFirstHint')}
      />
      <Option
        id={`${id}-review`}
        checked={props.planFirst && props.reviewPlan}
        onChange={props.onReviewPlanChange}
        disabled={props.disabled || !props.planFirst}
        label={t('plan.review')}
        hint={t('plan.reviewHint')}
      />
    </fieldset>
  );
};
