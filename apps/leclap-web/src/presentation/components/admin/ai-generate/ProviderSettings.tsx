// Provider, model and key — tucked in a disclosure that starts open only while the chosen provider
// has no key (progressive disclosure: once set up, the brief is the whole dialog). Model ids are a
// select for providers with a fixed list and a free-text field with suggestions otherwise. The
// optional Jev key lives in its own group, explained as "picks, doesn't write".
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { TemplateModelProvider } from '@/application/usecases/ai-template/model-provider';
import { TEMPLATE_MODEL_PROVIDERS } from '@/infrastructure/ai/registry';
import { JEV_KEY_ID, JEV_KEY_URL } from '@/infrastructure/ai/typesafe-jev';
import { Input, Select, SelectItem, SelectTrigger, SelectValue } from '@/presentation/components/ui';
import { EditorSelectContent } from '../editor/editor-select-content';
import { SectionDisclosure } from '../editor/SectionDisclosure';
import { FIELD_HELP, FIELD_LABEL } from './ai-form-styles';
import { KeyField } from './KeyField';
import { useApiKey, useStoredKeyCount } from './use-api-key';

interface ProviderSettingsProps {
  provider: TemplateModelProvider;
  model: string;
  onProviderChange: (id: string) => void;
  onModelChange: (model: string) => void;
}

interface DisclosureProps {
  // The provider group's expansion, owned by the dialog so the footer's "Add key" can open it.
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // The id given to the provider key's input, so "Add key" can focus it.
  keyInputId: string;
}

const ModelField = ({ provider, model, onModelChange }: Omit<ProviderSettingsProps, 'onProviderChange'>) => {
  const { t } = useTranslation('ai');
  const id = useId();

  if (!provider.freeformModel) {
    return (
      <div>
        <span id={id} className={FIELD_LABEL}>
          {t('provider.model')}
        </span>
        <Select value={model} onValueChange={onModelChange}>
          <SelectTrigger aria-labelledby={id}>
            <SelectValue />
          </SelectTrigger>
          <EditorSelectContent>
            {provider.models.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </EditorSelectContent>
        </Select>
      </div>
    );
  }

  return (
    <div>
      <label htmlFor={id} className={FIELD_LABEL}>
        {t('provider.model')}
      </label>
      <Input
        id={id}
        value={model}
        list={`${id}-models`}
        spellCheck={false}
        autoComplete="off"
        aria-describedby={`${id}-hint`}
        className="h-10 text-sm"
        onChange={(event) => {
          onModelChange(event.target.value);
        }}
      />
      <datalist id={`${id}-models`}>
        {provider.models.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
      <p id={`${id}-hint`} className={`mt-1.5 ${FIELD_HELP}`}>
        {t('provider.modelFree')}
      </p>
    </div>
  );
};

const ForgetAll = () => {
  const { t } = useTranslation('ai');
  const { count, forgetAll } = useStoredKeyCount();

  if (count < 2) return null;

  return (
    <button
      type="button"
      onClick={forgetAll}
      className="tap justify-self-start rounded text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
    >
      {t('key.forgetAll')}
    </button>
  );
};

export const ProviderSettings = ({
  provider,
  model,
  onProviderChange,
  onModelChange,
  open,
  onOpenChange,
  keyInputId,
}: ProviderSettingsProps & DisclosureProps) => {
  const { t } = useTranslation('ai');
  const providerLabelId = useId();
  const { key } = useApiKey(provider.id);
  const jev = useApiKey(JEV_KEY_ID);
  const summary = `${t('provider.summary', { provider: provider.label, model })} · ${key ? t('provider.keySet') : t('provider.keyMissing')}`;

  return (
    <div className="grid gap-3">
      <SectionDisclosure label={t('provider.section')} summary={summary} open={open} onOpenChange={onOpenChange}>
        <div className="grid gap-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <span id={providerLabelId} className={FIELD_LABEL}>
                {t('provider.label')}
              </span>
              <Select value={provider.id} onValueChange={onProviderChange}>
                <SelectTrigger aria-labelledby={providerLabelId}>
                  <SelectValue />
                </SelectTrigger>
                <EditorSelectContent>
                  {TEMPLATE_MODEL_PROVIDERS.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label}
                    </SelectItem>
                  ))}
                </EditorSelectContent>
              </Select>
            </div>
            <ModelField provider={provider} model={model} onModelChange={onModelChange} />
          </div>
          <KeyField
            inputId={keyInputId}
            providerId={provider.id}
            providerLabel={provider.label}
            placeholder={provider.keyPlaceholder}
            keyUrl={provider.keyUrl}
            looksLikeKey={provider.looksLikeKey}
          />
          <ForgetAll />
        </div>
      </SectionDisclosure>
      <SectionDisclosure label={t('jev.section')} summary={jev.key ? t('provider.keySet') : t('jev.provider')}>
        <div className="grid gap-3">
          <p className={FIELD_HELP}>{t('jev.about')}</p>
          <KeyField providerId={JEV_KEY_ID} providerLabel={t('jev.provider')} placeholder="" keyUrl={JEV_KEY_URL} />
        </div>
      </SectionDisclosure>
    </div>
  );
};
